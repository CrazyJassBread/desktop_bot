import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createConnection } from "node:net";
import test from "node:test";
import { sendBitmap, sendFeed } from "../server/printing/printer-client.mjs";
import { waitForTcpRecording } from "../server/transcription/broker.mjs";
import { createPcmTcpServer } from "../server/transcription/tcp-server.mjs";
import { pcm16leToWav } from "../server/transcription/wav.mjs";
import { sendExpression } from "../server/device/oled-client.mjs";
import { shouldAutoPrintLetter } from "../server/printing/worker.mjs";

test("PCM16 LE is wrapped in a valid 16 kHz mono WAV", () => {
  const wav = pcm16leToWav(Buffer.alloc(3_200));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 3_200);
});

test("TCP connection maps raw PCM to the waiting transcription job", async () => {
  const tcp = createPcmTcpServer({ transcriber: async (pcm, options) => ({ transcript: `${options.language}:${pcm.length}`, provider: "test" }) });
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const pending = waitForTcpRecording({ userId: "test-user", language: "en" });
  const reply = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: tcp.address().port });
    const chunks = [];
    socket.on("connect", () => socket.end(Buffer.alloc(3_200)));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  assert.equal((await pending).transcript, "en:3200");
  assert.equal(JSON.parse(reply).ok, true);
  await new Promise((resolve) => tcp.close(resolve));
});

test("ESP audio sent before the web request is discarded", async () => {
  const tcp = createPcmTcpServer({ transcriber: async (pcm) => ({ transcript: `received:${pcm.length}`, provider: "test" }) });
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const socket = createConnection({ host: "127.0.0.1", port: tcp.address().port });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.write(Buffer.alloc(1_600));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const pending = waitForTcpRecording({ userId: "late-web-user", language: "en" });
  const replyPromise = new Promise((resolve, reject) => {
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  socket.end(Buffer.alloc(3_200));
  assert.equal((await pending).transcript, "received:3200");
  assert.equal(JSON.parse(await replyPromise).ok, true);
  await new Promise((resolve) => tcp.close(resolve));
});

test("continuous ESP stream is finalized after voiced PCM followed by silence", async () => {
  const tcp = createPcmTcpServer({ transcriber: async (pcm) => ({ transcript: `vad:${pcm.length}`, provider: "test" }) });
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const pending = waitForTcpRecording({ userId: "vad-user", language: "en" });
  const socket = createConnection({ host: "127.0.0.1", port: tcp.address().port });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const voiced = Buffer.alloc(6_400);
  for (let offset = 0; offset < voiced.length; offset += 2) voiced.writeInt16LE(2_000, offset);
  socket.write(voiced);
  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.write(Buffer.alloc(40_000));
  const reply = await new Promise((resolve, reject) => {
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  assert.match((await pending).transcript, /^vad:/);
  assert.equal(JSON.parse(reply).ok, true);
  socket.destroy();
  await new Promise((resolve) => tcp.close(resolve));
});

test("printer transport sends packed bitmap bytes with width and height", async () => {
  let received;
  const printer = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { url: request.url, type: request.headers["content-type"], body: Buffer.concat(chunks) };
    response.writeHead(200).end("ok");
  });
  await new Promise((resolve) => printer.listen(0, "127.0.0.1", resolve));
  const bitmap = Buffer.alloc(48 * 10, 0xaa);
  await sendBitmap({ width: 384, height: 10, bitmap }, { baseUrl: `http://127.0.0.1:${printer.address().port}` });
  assert.equal(received.url, "/printer/image?width=384&height=10");
  assert.equal(received.type, "application/octet-stream");
  assert.deepEqual(received.body, bitmap);
  await new Promise((resolve) => printer.close(resolve));
});

test("printer feed advances three blank lines after content", async () => {
  let received;
  const printer = createHttpServer((request, response) => {
    received = { url: request.url, method: request.method };
    response.writeHead(200).end("ok");
  });
  await new Promise((resolve) => printer.listen(0, "127.0.0.1", resolve));
  await sendFeed(3, { baseUrl: `http://127.0.0.1:${printer.address().port}` });
  assert.deepEqual(received, { url: "/printer/feed?lines=3", method: "POST" });
  await new Promise((resolve) => printer.close(resolve));
});

test("OLED transport posts the requested expression", async () => {
  let received;
  const oled = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { url: request.url, type: request.headers["content-type"], body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200).end("ok");
  });
  await new Promise((resolve) => oled.listen(0, "127.0.0.1", resolve));
  await sendExpression("happy", { baseUrl: `http://127.0.0.1:${oled.address().port}` });
  assert.equal(received.url, "/oled/expression");
  assert.equal(received.type, "application/json");
  assert.deepEqual(received.body, { expression: "happy" });
  await new Promise((resolve) => oled.close(resolve));
});

test("self-addressed letters auto-print even when general auto-send is disabled", () => {
  assert.equal(shouldAutoPrintLetter("usr-self", "usr-self", false), true);
  assert.equal(shouldAutoPrintLetter("usr-sender", "usr-recipient", false), false);
  assert.equal(shouldAutoPrintLetter("usr-sender", "usr-recipient", true), true);
});
