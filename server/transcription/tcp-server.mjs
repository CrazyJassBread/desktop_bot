import { createServer } from "node:net";
import { config } from "../config.mjs";
import { claimWaitingRecording, hasWaitingRecording } from "./broker.mjs";
import { transcribePcm } from "./openai-transcriber.mjs";
import { clearActiveRecording, isStopPending, registerActiveRecording } from "./control.mjs";
import { beginOledActivity } from "../device/oled-client.mjs";

const bytesPerSecond = 16_000 * 1 * 2;
const maxBytes = bytesPerSecond * config.transcription.maxSeconds;
const silenceBytesRequired = Math.round(bytesPerSecond * config.transcription.vadSilenceMs / 1000);
let activeTranscriptions = 0;
const concurrencyWaiters = [];
const log = (message) => { if (process.env.NODE_ENV !== "test") console.log(`[PCM] ${message}`); };

async function acquireSlot() {
  if (activeTranscriptions < config.transcription.maxConcurrentRequests) { activeTranscriptions += 1; return; }
  await new Promise((resolve) => concurrencyWaiters.push(resolve));
  activeTranscriptions += 1;
}

function releaseSlot() {
  activeTranscriptions -= 1;
  concurrencyWaiters.shift()?.();
}

async function runTranscription(pcm, task, transcriber) {
  await acquireSlot();
  const endOledActivity = beginOledActivity("happy");
  try { return await transcriber(pcm, { language: task.language }); }
  finally { endOledActivity(); releaseSlot(); }
}

export function createPcmTcpServer({ transcriber = transcribePcm } = {}) {
  return createServer({ allowHalfOpen: true }, (socket) => {
    const remote = `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0}`;
    log(`connected: ${remote}`);
    socket.setNoDelay(true);
    socket.setTimeout(config.transcription.idleTimeoutMs);
    let task = null;
    const chunks = [];
    let size = 0;
    let completed = false;
    let speechStarted = false;
    let silentBytes = 0;
    const fail = (error) => {
      if (completed) return;
      completed = true;
      clearActiveRecording(finishAudio);
      task?.reject(error);
      log(`error: ${error.code || "TRANSCRIPTION_FAILED"} - ${error.message}`);
      if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, code: error.code || "TRANSCRIPTION_FAILED", message: error.message })}\n`);
    };
    const finishAudio = async () => {
      if (completed) return;
      clearActiveRecording(finishAudio);
      if (size < 3_200 || size % 2 !== 0) return fail(Object.assign(new Error("PCM audio is empty, too short, or contains a partial sample"), { code: "INVALID_PCM" }));
      task = claimWaitingRecording();
      if (!task) {
        completed = true;
        log("error: NO_PENDING_JOB - request transcription in the web app before recording ends");
        socket.end(`${JSON.stringify({ ok: false, code: "NO_PENDING_JOB", message: "Open the web app and request transcription before the recording ends" })}\n`);
        return;
      }
      completed = true;
      socket.pause();
      try {
        const result = await runTranscription(Buffer.concat(chunks, size), task, transcriber);
        task.resolve(result);
        log(`transcription: ${result.transcript}`);
        if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: true, transcript: result.transcript })}\n`);
      } catch (error) {
        task.reject(error);
        log(`error: OPENAI_TRANSCRIPTION_FAILED - ${error.message}`);
        if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, code: "OPENAI_TRANSCRIPTION_FAILED", message: error.message })}\n`);
      }
    };
    if (!registerActiveRecording(finishAudio)) {
      completed = true;
      socket.end(`${JSON.stringify({ ok: false, code: "DEVICE_BUSY" })}\n`);
      return;
    }
    socket.on("data", (chunk) => {
      if (completed) return;
      // The ESP may stream continuously. Audio is intentionally discarded until
      // a signed-in user explicitly requests a recording from the web app.
      if (!hasWaitingRecording()) return;
      size += chunk.length;
      if (size > maxBytes) return fail(Object.assign(new Error("Audio exceeds configured duration limit"), { code: "AUDIO_TOO_LARGE" }));
      chunks.push(chunk);
      let voiced = false;
      const sampleBytes = chunk.length - (chunk.length % 2);
      for (let offset = 0; offset < sampleBytes; offset += 2) {
        if (Math.abs(chunk.readInt16LE(offset)) >= config.transcription.vadThreshold) { voiced = true; break; }
      }
      if (voiced) {
        speechStarted = true;
        silentBytes = 0;
      } else if (speechStarted) {
        silentBytes += chunk.length;
        if (silentBytes >= silenceBytesRequired && !isStopPending(finishAudio)) finishAudio();
      }
    });
    socket.on("timeout", () => fail(Object.assign(new Error("Audio connection was idle for too long"), { code: "AUDIO_IDLE_TIMEOUT" })));
    socket.on("error", fail);
    socket.on("end", finishAudio);
  });
}

export function startPcmTcpServer() {
  const server = createPcmTcpServer();
  server.listen(config.transcription.tcpPort, config.transcription.tcpHost, () => {
    console.log(`PCM transcription TCP server listening on ${config.transcription.tcpHost}:${config.transcription.tcpPort}`);
  });
  return server;
}
