import { resolve } from "node:path";

const baseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
export const config = Object.freeze({
  server: {
    host: process.env.HOST || "0.0.0.0",
    port: Number.parseInt(process.env.PORT || "18000", 10),
    publicUrl: baseUrl(process.env.PUBLIC_APP_URL)
  },
  database: {
    path: process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : resolve("data", "ai-hub.sqlite")
  },
  session: { cookieSecure: process.env.COOKIE_SECURE === "true" },
  transcription: {
    tcpHost: process.env.TRANSCRIPTION_TCP_HOST || "0.0.0.0",
    tcpPort: Number.parseInt(process.env.TRANSCRIPTION_TCP_PORT || "8080", 10),
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    baseUrl: baseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    maxSeconds: Number.parseInt(process.env.TRANSCRIPTION_MAX_SECONDS || "180", 10),
    idleTimeoutMs: Number.parseInt(process.env.TRANSCRIPTION_IDLE_TIMEOUT_MS || "15000", 10),
    requestTimeoutMs: Number.parseInt(process.env.TRANSCRIPTION_REQUEST_TIMEOUT_MS || "120000", 10),
    maxConcurrentRequests: Number.parseInt(process.env.TRANSCRIPTION_CONCURRENCY || "4", 10),
    vadThreshold: Number.parseInt(process.env.TRANSCRIPTION_VAD_THRESHOLD || "500", 10),
    vadSilenceMs: Number.parseInt(process.env.TRANSCRIPTION_VAD_SILENCE_MS || "1200", 10),
    stopGraceMs: Number.parseInt(process.env.TRANSCRIPTION_STOP_GRACE_MS || "2000", 10)
  },
  printer: {
    baseUrl: baseUrl(process.env.ESP_PRINTER_BASE_URL),
    autoSend: process.env.PRINTER_AUTO_SEND === "true",
    timeoutMs: Number.parseInt(process.env.PRINTER_TIMEOUT_MS || "30000", 10),
    rotate180: process.env.PRINTER_ROTATE_180 !== "false"
  },
  oled: {
    baseUrl: baseUrl(process.env.ESP_OLED_BASE_URL || process.env.ESP_PRINTER_BASE_URL),
    timeoutMs: Number.parseInt(process.env.OLED_TIMEOUT_MS || "5000", 10)
  }
});
