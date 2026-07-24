import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleApiRequest } from "../api/mock-api.mjs";
import {
  buildThermalLetterSvg,
  paginateThermalLetter,
  renderThermalLetterBatches,
  renderThermalLetterBitmap,
  THERMAL_BATCH_MAX_HEIGHT,
  THERMAL_PRINTER_WIDTH
} from "../services/thermal-letter.mjs";
import {
  paginateThermalContent,
  renderThermalContentBatches,
  THERMAL_CONTENT_MAX_HEIGHT,
  THERMAL_CONTENT_WIDTH
} from "../services/thermal-content.mjs";
import {
  acceptPerceptionEvent,
  getPerceptionStatus,
  listPerceptionEvents
} from "../services/perception-gateway.mjs";
import { DesktopBotBridge } from "../services/desktop-bot-bridge.mjs";

test("thermal Letter uses the 384px hardware contract and packs one bit per pixel", async () => {
  const input = {
    subject: "夏夜来信",
    body: "你好呀！\n这是一封来自 AI Hub OS 的实体信件。",
    sender: "林安",
    recipient: "Aiko",
    letterId: "letter-test"
  };
  const template = buildThermalLetterSvg(input);
  assert.equal(template.width, THERMAL_PRINTER_WIDTH);
  assert.match(template.svg, /PAPER LETTER/);
  assert.match(template.svg, /夏夜来信/);

  const rendered = await renderThermalLetterBitmap(input, { rotate180: false });
  assert.equal(rendered.bitmap.length, Math.ceil(rendered.width / 8) * rendered.height);
  assert.ok(rendered.bitmap.some((byte) => byte !== 0));
});

test("long thermal Letters are split into bounded sequential batches", async () => {
  const rendered = await renderThermalLetterBatches({
    subject: "一封很长的信",
    body: "这是用于验证 ESP32 分批打印的长文本内容。".repeat(180),
    sender: "林安",
    recipient: "Aiko",
    letterId: "long-letter"
  }, { rotate180: false });
  assert.ok(rendered.height > 1_200);
  assert.ok(rendered.batches.length > 1);
  assert.ok(rendered.batches.every((batch) => batch.height <= THERMAL_BATCH_MAX_HEIGHT));
  assert.equal(rendered.batches.reduce((height, batch) => height + batch.height, 0), rendered.height);
});

test("unbroken English is hard-wrapped inside the 384px printable area", () => {
  const continuousEnglish = "hiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii";
  const paginated = paginateThermalLetter({
    subject: "AdventureX",
    body: continuousEnglish,
    sender: "Lin",
    recipient: "Aiko",
    letterId: "english-wrap"
  });
  const lines = paginated.pages.flatMap((page) => page.bodyLines);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(""), continuousEnglish);
  assert.ok(lines.every((line) => line.length < continuousEnglish.length));
});

test("chat, todo and word content share safe 384px thermal pagination", async () => {
  for (const kind of ["chat", "todo", "word", "story", "note"]) {
    const input = {
      kind,
      title: `Template ${kind}`,
      content: `${"ContinuousEnglishWithoutSpaces".repeat(12)}\n${"复习内容。".repeat(80)}`
    };
    const pagination = paginateThermalContent(input);
    assert.ok(pagination.pageCount > 1);
    assert.ok(pagination.pages.every((page) => page.width === THERMAL_CONTENT_WIDTH));
    const rendered = await renderThermalContentBatches(input, { rotate180: false });
    assert.ok(rendered.batches.every((batch) => batch.height <= THERMAL_CONTENT_MAX_HEIGHT));
    assert.ok(rendered.batches.every((batch) => batch.bitmap.length === 48 * batch.height));
  }
});

test("perception gateway accepts the desktop_bot event contract", () => {
  const timestampMs = Date.now();
  const accepted = acceptPerceptionEvent({
    event_type: "feature.write_letter",
    source: "audio",
    timestamp_ms: timestampMs,
    session_id: "bot",
    payload: { transcript: "小A，帮我写信" }
  });
  assert.equal(accepted.eventType, "feature.write_letter");
  assert.equal(listPerceptionEvents(timestampMs - 1).at(-1).payload.transcript, "小A，帮我写信");
  assert.equal(getPerceptionStatus().channels.audio.connected, true);
});

test("desktop_bot bridge consumes command events once and posts AI results back", async () => {
  const events = [];
  const results = [];
  const bridge = new DesktopBotBridge({
    baseUrl: "http://desktop-bot.test:8090",
    onEvent: (event) => events.push(event),
    orchestrate: async (question) => ({
      intent: "CHAT",
      reply: `AI:${question}`,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      requiresConfirmation: true,
      printable: { kind: "chat", title: "对话", content: `AI:${question}` }
    }),
    fetchImpl: async (url, options) => {
      results.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      return new Response(JSON.stringify({ status: "accepted", event_id: "result-1" }), { status: 202, headers: { "Content-Type": "application/json" } });
    },
    WebSocketImpl: null
  });
  const command = {
    event_id: "event-chat-1",
    sequence: 18,
    schema_version: 1,
    event_type: "command.chat.ask",
    source: "controller",
    timestamp_ms: Date.now(),
    session_id: "bot",
    payload: { parameters: { question: "为什么天空是蓝色的？", language: "zh" } }
  };
  await bridge.consume(command);
  await bridge.consume(command);
  assert.equal(events.length, 1);
  assert.equal(results.length, 1);
  assert.match(results[0].url, /\/api\/results$/);
  assert.equal(results[0].body.event_type, "chat.completed");
  assert.equal(results[0].body.payload.requires_confirmation, true);
  assert.equal(bridge.status().lastSequence, 18);
});

test("desktop_bot microphone buffers a Letter and over sends it exactly once", async () => {
  const results = [];
  const deliveries = [];
  const bridge = new DesktopBotBridge({
    baseUrl: "http://desktop-bot.test:8090",
    onEvent: () => {},
    deliverLetter: async (payload) => {
      deliveries.push(payload);
      return {
        letterId: "ltr-voice-1",
        status: "SENT",
        delivery: { status: "RECEIVED" },
        printJob: { id: "pj-voice-1", status: "WAITING_DEVICE" },
        recipient: { id: "usr-mom", displayName: "妈妈" },
        provider: "deepseek"
      };
    },
    fetchImpl: async (url, options) => {
      results.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      return new Response(JSON.stringify({ status: "accepted" }), { status: 202, headers: { "Content-Type": "application/json" } });
    },
    WebSocketImpl: null
  });
  const speech = (id, transcript, sequence) => ({
    event_id: id,
    event_type: "speech.transcribed",
    source: "audio",
    session_id: "bot",
    sequence,
    schema_version: 1,
    timestamp_ms: Date.now(),
    payload: { transcript, matched_event: null }
  });

  await bridge.consume(speech("voice-start", "我要给妈妈写一封信", 1));
  await bridge.consume(speech("voice-body", "最近天气变化大，你要记得照顾身体。", 2));
  await bridge.consume(speech("voice-end", "over", 3));
  await bridge.consume(speech("voice-end-duplicate", "结束", 4));

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].recipient, "妈妈");
  assert.match(deliveries[0].body, /照顾身体/);
  assert.ok(results.some((entry) => entry.body?.event_type === "letter.listening"));
  assert.ok(results.some((entry) => entry.body?.event_type === "letter.content_buffered"));
  assert.ok(results.some((entry) => entry.body?.event_type === "letter.sent"));
  assert.ok(results.some((entry) => entry.body?.payload?.idempotent_replay === true));
});

test("Letter printer feeds, sends bounded batches and replays idempotently", async () => {
  const imageCalls = [];
  const feedCalls = [];
  const printer = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (url.pathname === "/printer/feed") {
      feedCalls.push(Number(url.searchParams.get("lines")));
    } else if (url.pathname === "/printer/image") {
      imageCalls.push({
        width: Number(url.searchParams.get("width")),
        height: Number(url.searchParams.get("height")),
        bytes: Buffer.concat(chunks).length
      });
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"success":true}');
  });
  await new Promise((resolve) => printer.listen(0, "127.0.0.1", resolve));
  const priorPrinterUrl = process.env.ESP_PRINTER_BASE_URL;
  process.env.ESP_PRINTER_BASE_URL = `http://127.0.0.1:${printer.address().port}`;

  const apiServer = createServer(async (request, response) => {
    await handleApiRequest(request, response, crypto.randomUUID());
  });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${apiServer.address().port}/api/v1/printer/letter`;
  const contentEndpoint = `http://127.0.0.1:${apiServer.address().port}/api/v1/printer/content`;
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "print-job-test-1" },
    body: JSON.stringify({
      subject: "Batch test",
      body: "A short Letter that still spans safe ESP32 bitmap batches.",
      sender: "Lin",
      recipient: "Aiko",
      letterId: "test-1"
    })
  };

  try {
    const first = await fetch(endpoint, options);
    const firstBody = await first.json();
    assert.equal(first.status, 202);
    assert.ok(firstBody.batchCount >= 1);
    assert.deepEqual(feedCalls, [3, 4]);
    assert.equal(imageCalls.length, firstBody.batchCount);
    assert.ok(imageCalls.every((call) => call.width === 384 && call.height <= THERMAL_BATCH_MAX_HEIGHT));
    assert.ok(imageCalls.every((call) => call.bytes === 48 * call.height));

    const replay = await fetch(endpoint, options);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotent-replayed"), "true");
    assert.equal(imageCalls.length, firstBody.batchCount);
    assert.deepEqual(feedCalls, [3, 4]);

    const contentResponse = await fetch(contentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "content-job-test-1" },
      body: JSON.stringify({ kind: "todo", title: "今日计划", content: "[ ] 09:00 复习单词\n[ ] 14:00 阅读", jobId: "content-1" })
    });
    const contentBody = await contentResponse.json();
    assert.equal(contentResponse.status, 202);
    assert.equal(contentBody.width, 384);
    assert.ok(contentBody.pageCount >= 1);
    assert.deepEqual(feedCalls, [3, 4, 3, 4]);
  } finally {
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => printer.close(resolve));
    if (priorPrinterUrl === undefined) delete process.env.ESP_PRINTER_BASE_URL;
    else process.env.ESP_PRINTER_BASE_URL = priorPrinterUrl;
  }
});
