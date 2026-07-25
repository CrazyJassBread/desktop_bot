import { resolve } from "node:path";

const baseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
const apiPath = (value, fallback) => {
  const path = String(value || fallback).trim();
  return path.startsWith("/") ? path : `/${path}`;
};

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
  backend: {
    baseUrl: baseUrl(process.env.BACKEND_BASE_URL),
    apiToken: String(process.env.BACKEND_API_TOKEN || "").trim(),
    transcribePath: apiPath(process.env.BACKEND_TRANSCRIBE_PATH, "/api/transcriptions"),
    printPath: apiPath(process.env.BACKEND_PRINT_PATH, "/api/print-jobs")
  },
  device: {
    apiToken: String(process.env.DEVICE_API_TOKEN || "").trim(),
    userEmail: String(process.env.DEVICE_USER_EMAIL || "hello@aihub.local").trim()
  }
});

export function backendUrl(path) {
  return config.backend.baseUrl ? `${config.backend.baseUrl}${apiPath(path, "/")}` : "";
}
