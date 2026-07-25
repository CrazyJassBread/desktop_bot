import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import sharp from "sharp";
import { handleApiRequest } from "../api/mock-api.mjs";
import {
  buildThermalLetterSvg,
  paginatePlainThermalLetter,
  paginateThermalLetter,
  renderPlainThermalLetterBatches,
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
  processThermalImage,
  renderThermalImageBatches
} from "../services/thermal-image.mjs";

test("thermal Letter uses the 384px hardware contract and packs one bit per pixel", async () => {
  const input = {
    subject: "夏夜来信",
    body: "你好呀！\n这是一封来自 PrintPal 的实体信件。",
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

test("plain thermal Letters use receipt-style fields and support 58mm and 80mm paper", async () => {
  const input = {
    subject: "感谢信",
    body: "谢谢你今天帮我检查打印机，也谢谢你一直认真听我说话。".repeat(18),
    sender: "林安",
    recipient: "Mina",
    date: "2026-07-25"
  };
  const fiftyEight = paginatePlainThermalLetter({ ...input, paper: "58mm" });
  assert.equal(fiftyEight.width, 384);
  assert.match(fiftyEight.pages[0].svg, /收件人：Mina/);
  assert.match(fiftyEight.pages[0].svg, /正文：/);
  assert.match(fiftyEight.pages[0].svg, /署名：林安/);

  const eighty = await renderPlainThermalLetterBatches({ ...input, paper: "80mm" }, { rotate180: false });
  assert.equal(eighty.width, 576);
  assert.ok(eighty.batches.every((batch) => batch.height <= THERMAL_BATCH_MAX_HEIGHT));
  assert.ok(eighty.batches.every((batch) => batch.bitmap.length === Math.ceil(batch.width / 8) * batch.height));
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

test("camera and uploaded photos become recognizable 384px dither batches", async () => {
  const source = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
    <defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#f5e5c8"/><stop offset="1" stop-color="#4a6982"/></linearGradient></defs>
    <rect width="640" height="420" fill="url(#sky)"/>
    <circle cx="205" cy="165" r="88" fill="#d9b18c"/>
    <path d="M120 400c22-110 150-128 210 0" fill="#355064"/>
    <circle cx="175" cy="154" r="9" fill="#222"/><circle cx="235" cy="154" r="9" fill="#222"/>
    <path d="M170 205q35 25 70 0" fill="none" stroke="#222" stroke-width="8"/>
    <rect x="390" y="95" width="180" height="210" rx="18" fill="#efe6d8"/>
    <path d="M420 140h120M420 180h90M420 220h120M420 260h75" stroke="#3a4550" stroke-width="12"/>
  </svg>`);
  const photo = await processThermalImage(source, { profile: "print" });
  assert.equal(photo.width, 384);
  assert.ok(photo.height <= 752);
  assert.equal(photo.processing.pixelSize, 1);
  assert.equal(photo.processing.grayscaleLevels, 32);
  assert.equal(photo.processing.cannyLow, 0);
  assert.equal(photo.processing.cannyHigh, 0);
  assert.equal(photo.processing.detailMode, "natural");
  assert.equal(photo.processor, "thermal-image-photo-dither-v2");
  assert.equal(photo.processing.dither, "serpentine-floyd-steinberg");
  assert.match(photo.previewDataUrl, /^data:image\/png;base64,/);

  const preview = Buffer.from(photo.previewDataUrl.split(",")[1], "base64");
  const { data: previewPixels, info: previewInfo } = await sharp(preview)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const darkPixels = previewPixels.reduce((total, value) => total + Number(value < 128), 0);
  const darkRatio = darkPixels / previewPixels.length;
  assert.ok(darkRatio > 0.08 && darkRatio < 0.75);
  const rowSignatures = new Set();
  for (let y = 16; y < previewInfo.height - 16; y += 1) {
    let signature = 2166136261;
    for (let x = 0; x < previewInfo.width; x += 1) {
      signature ^= previewPixels[y * previewInfo.width + x];
      signature = Math.imul(signature, 16777619);
    }
    rowSignatures.add(signature >>> 0);
  }
  const contentRows = previewInfo.height - 32;
  assert.ok(rowSignatures.size > contentRows / (photo.processing.pixelSize * 2));

  const rendered = await renderThermalImageBatches(photo.previewDataUrl, {
    rotate180: false,
    maxBatchHeight: 256
  });
  assert.equal(rendered.width, 384);
  assert.ok(rendered.batches.length >= 1);
  assert.ok(rendered.batches.every((batch) => batch.height <= 256));
  assert.ok(rendered.batches.every((batch) => batch.bitmap.byteLength === 48 * batch.height));
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

