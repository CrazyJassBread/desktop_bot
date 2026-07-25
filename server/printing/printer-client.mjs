import { config } from "../config.mjs";

export function printerConfigured() {
  return Boolean(config.printer.baseUrl);
}

export async function sendBitmap({ width, height, bitmap }, options = {}) {
  const baseUrl = options.baseUrl || config.printer.baseUrl;
  if (!baseUrl) throw new Error("ESP_PRINTER_BASE_URL is not configured");
  const url = new URL("/printer/image", `${baseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bitmap,
    signal: AbortSignal.timeout(options.timeoutMs || config.printer.timeoutMs)
  });
  if (!response.ok) throw new Error(`Printer returned HTTP ${response.status}`);
  return { status: response.status };
}
