import { sendBitmap, sendFeed } from "../printing/printer-client.mjs";
import { config } from "../config.mjs";

export function decodeVisionPrintPayload(payload = {}) {
  const width = Number(payload.width);
  const height = Number(payload.height);
  if (width !== 384 || !Number.isInteger(height) || height < 1 || height > 1200) {
    const error = new Error("INVALID_PRINT_DIMENSIONS");
    error.statusCode = 422;
    throw error;
  }
  if (typeof payload.bitmap !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.bitmap)) {
    const error = new Error("INVALID_PRINT_BITMAP");
    error.statusCode = 422;
    throw error;
  }
  const bitmap = Buffer.from(payload.bitmap, "base64");
  const expectedBytes = Math.ceil(width / 8) * height;
  if (bitmap.length !== expectedBytes) {
    const error = new Error("INVALID_PRINT_BITMAP_LENGTH");
    error.statusCode = 422;
    throw error;
  }
  return { width, height, bitmap };
}

export async function printVisionCapture(payload, options = {}) {
  const image = decodeVisionPrintPayload(payload);
  if (options.rotate180 ?? config.printer.rotate180) {
    const rotated = Buffer.alloc(image.bitmap.length);
    const widthBytes = Math.ceil(image.width / 8);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const sourceByte = y * widthBytes + Math.floor(x / 8);
        if (!(image.bitmap[sourceByte] & (1 << (7 - (x % 8))))) continue;
        const targetX = image.width - 1 - x;
        const targetY = image.height - 1 - y;
        rotated[targetY * widthBytes + Math.floor(targetX / 8)] |= 1 << (7 - (targetX % 8));
      }
    }
    image.bitmap = rotated;
  }
  await sendBitmap(image, options);
  await sendFeed(3, options);
  return { printed: true, width: image.width, height: image.height };
}
