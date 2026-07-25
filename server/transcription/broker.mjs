import { config } from "../config.mjs";

let waiting = null;

export class TranscriptionBusyError extends Error {
  constructor() { super("Another recording is already waiting for PCM audio"); this.code = "TRANSCRIPTION_BUSY"; }
}

export function waitForTcpRecording({ userId, language }) {
  if (waiting) throw new TranscriptionBusyError();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (waiting?.userId === userId) waiting = null;
      reject(Object.assign(new Error("Timed out waiting for the TCP audio connection"), { code: "AUDIO_TIMEOUT" }));
    }, config.transcription.requestTimeoutMs);
    timeout.unref();
    waiting = {
      userId,
      language,
      resolve: (result) => { clearTimeout(timeout); resolve(result); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    };
  });
}

export function claimWaitingRecording() {
  const task = waiting;
  waiting = null;
  return task;
}

export function hasWaitingRecording() {
  return Boolean(waiting);
}
