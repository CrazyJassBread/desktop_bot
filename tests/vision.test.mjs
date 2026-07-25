import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { cannyEdges, createPixelArt, GestureStabilizer, packPrinterBitmap, pixelate } from "../public/vision/processing.js";
import { printVisionCapture } from "../server/vision/print.mjs";
import { renderThermalLetterBatches } from "../server/services/thermal-letter.mjs";
import sharp from "sharp";

test("Victory stabilizer emits once and rearms after two missing frames", () => {
  const stabilizer = new GestureStabilizer();
  const sequence = [true, true, false, true, true, true, false, false, true, true, true, true, true];
  assert.equal(sequence.filter((present) => stabilizer.update(present)).length, 2);
});

test("Canny output finds a dark rectangle and pixelation preserves dimensions", () => {
  const width = 48;
  const height = 36;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 8; y < 28; y += 1) {
    for (let x = 10; x < 38; x += 1) {
      if (x > 11 && x < 36 && y > 9 && y < 26) continue;
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  const edges = cannyEdges({ data, width, height }, { lowThreshold: 40, highThreshold: 90 });
  const result = pixelate(edges, 2);
  assert.equal(result.width, width);
  assert.equal(result.height, height);
  assert.ok(result.data.some((value, index) => index % 4 !== 3 && value < 255));
  assert.equal(packPrinterBitmap(result).length, Math.ceil(width / 8) * height);
});

test("pixel-art conversion keeps four grayscale levels and adds thick black outlines", () => {
  const width = 48;
  const height = 36;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x < width / 2 ? 40 : 220;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const result = createPixelArt({ data, width, height });
  const values = new Set();
  for (let offset = 0; offset < result.data.length; offset += 4) values.add(result.data[offset]);
  assert.ok([...values].every((value) => [0, 85, 170, 255].includes(value)));
  const boundaryBlackPixels = [22, 23, 24, 25].filter((x) => result.data[(18 * width + x) * 4] === 0);
  assert.ok(boundaryBlackPixels.length >= 3);
});

test("processed Victory bitmap is forwarded to the configured printer", async () => {
  const received = [];
  const printer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ url: request.url, body: Buffer.concat(chunks) });
    response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  await new Promise((resolve) => printer.listen(0, "127.0.0.1", resolve));
  try {
    const bitmap = Buffer.alloc(48 * 4);
    bitmap[0] = 0x80;
    const result = await printVisionCapture({
      width: 384,
      height: 4,
      bitmap: bitmap.toString("base64")
    }, {
      baseUrl: `http://127.0.0.1:${printer.address().port}`,
      rotate180: false
    });
    assert.equal(result.printed, true);
    assert.equal(received[0].url, "/printer/image?width=384&height=4");
    assert.deepEqual(received[0].body, bitmap);
    assert.equal(received[1].url, "/printer/feed?lines=3");
  } finally {
    await new Promise((resolve) => printer.close(resolve));
  }
});

test("letter photo is placed into printer-safe batches", async () => {
  const photo = await sharp({
    create: { width: 384, height: 288, channels: 3, background: "#777777" }
  }).png().toBuffer();
  const output = await renderThermalLetterBatches({
    letterId: "photo-letter",
    subject: "A pixel memory",
    body: Array.from({ length: 18 }, (_, index) => `Memory line ${index + 1}`).join("\n"),
    sender: "Sender",
    recipient: "Recipient",
    attachmentImageDataUrl: `data:image/png;base64,${photo.toString("base64")}`
  }, { rotate180: false });
  assert.ok(output.pageCount > 1);
  assert.ok(output.batches.every((batch) => batch.height <= 800));
  assert.ok(output.batches.every((batch) => batch.bitmap.length === 48 * batch.height));
});
