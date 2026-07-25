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
import { processThermalImage } from "../services/thermal-image.mjs";

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
test("Letter photos are processed as bounded thermal pixel attachments", async () => {
  const source = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="white"/><circle cx="210" cy="150" r="90" fill="black"/><path d="M80 340h480" stroke="black" stroke-width="40"/></svg>`);
  const photo = await processThermalImage(source, { profile: "letter" });
  assert.equal(photo.profile, "letter");
  assert.ok(photo.width <= 300);
  assert.ok(photo.height <= 150);
  assert.match(photo.previewDataUrl, /^data:image\/png;base64,/);

  const rendered = await renderThermalLetterBatches({
    subject: "带照片的信",
    body: "这是一封带有热敏像素照片的信。照片应该固定适配 58mm 热敏纸，不把单页撑爆。",
    sender: "林安",
    recipient: "Aiko",
    letterId: "photo-letter",
    attachmentImageDataUrl: photo.previewDataUrl,
    attachmentWidth: photo.width,
    attachmentHeight: photo.height,
    attachmentCaption: "MEMORY PHOTO"
  }, { rotate180: false });
  assert.ok(rendered.batches.every((batch) => batch.width === 384));
  assert.ok(rendered.batches.every((batch) => batch.height <= THERMAL_BATCH_MAX_HEIGHT));
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
