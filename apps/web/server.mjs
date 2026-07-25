import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, startDailyBriefingScheduler, setBridgeInstance as setApiBridgeInstance, updateBridgeStatus, orchestrateTranscript, handleVoiceLetterTurn } from "./api/mock-api.mjs";
import { startDesktopBotBridge } from "./services/desktop-bot-bridge.mjs";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "18000", 10);
const host = process.env.HOST ?? "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(appRoot, safePath);
  if (!absolutePath.startsWith(appRoot)) return null;
  return absolutePath;
}

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  response.setHeader("X-Request-ID", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  response.on("finish", () => {
    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify({
        level: "info",
        method: request.method,
        path: request.url,
        status: response.statusCode,
        duration_ms: Date.now() - startedAt,
        request_id: requestId
      }));
    }
  });

  if (request.url === "/health") {
    return sendJson(response, 200, {
      status: "ok",
      service: "ai-hub-os-web-api-mvp",
      database: "not-configured",
      api: "/api/v1",
      uptime_seconds: Math.round(process.uptime()),
      request_id: requestId
    });
  }

  if (await handleApiRequest(request, response, requestId)) return;

  let filePath = resolveRequestPath(request.url ?? "/");
  const acceptsHtml = String(request.headers.accept ?? "").includes("text/html");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    if (acceptsHtml && request.method === "GET") {
      filePath = join(appRoot, "index.html");
    } else {
      return sendJson(response, 404, {
        error: {
          code: "NOT_FOUND",
          message: "页面或资源不存在",
          request_id: requestId
        }
      });
    }
  }

  const extension = extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
    // This MVP serves unhashed assets. Revalidate app code so a deployment never
    // leaves a user on an obsolete navigation or authentication bundle.
    "Cache-Control": [".html", ".js", ".css"].includes(extension) ? "no-cache" : "public, max-age=300",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  };

  response.writeHead(200, headers);
  createReadStream(filePath)
    .on("error", () => {
      if (!response.headersSent) sendJson(response, 500, { error: { code: "READ_FAILED", request_id: requestId } });
      else response.destroy();
    })
    .pipe(response);

});

server.listen(port, host, () => {
  console.log(`PrintPal Web + API MVP running at http://${host}:${port}`);
});

const dailyBriefingScheduler = startDailyBriefingScheduler();

const bridgeEnabled = process.env.DESKTOP_BOT_BRIDGE_ENABLED === "true";
const bridgeBaseUrl = process.env.DESKTOP_BOT_BASE_URL ?? "http://127.0.0.1:8090";
const bridgeWsPath = process.env.DESKTOP_BOT_WEBSOCKET_PATH ?? "/api/events";

let desktopBotBridge = null;
if (bridgeEnabled) {
  desktopBotBridge = startDesktopBotBridge({
    baseUrl: bridgeBaseUrl,
    wsPath: bridgeWsPath,
    enabled: bridgeEnabled,
    onEvent: async (event) => {
      console.log(JSON.stringify({ level: "info", source: "desktop-bot-bridge", event }));
      try {
        const HARDWARE_USER = "hardware-bot";
        switch (event.type) {
          case "speech_transcribed":
          case "chat_ask": {
            const transcript = event.transcript;
            if (transcript) {
              const decision = await orchestrateTranscript(transcript, { source: "desktop_bot" });
              console.log(JSON.stringify({ level: "info", source: "desktop-bot-bridge", result: "orchestrated", intent: decision?.intent }));
              if (decision?.intent === "WRITE_LETTER") {
                await handleVoiceLetterTurn(HARDWARE_USER, transcript, decision);
              }
            }
            break;
          }
          case "letter_compose":
          case "letter_event": {
            const transcript = event.transcript;
            if (transcript) {
              await handleVoiceLetterTurn(HARDWARE_USER, transcript);
            }
            break;
          }
          case "photo_captured": {
            console.log(JSON.stringify({ level: "info", source: "desktop-bot-bridge", photo: event.capture_id }));
            break;
          }
          default:
            break;
        }
      } catch (error) {
        console.error(JSON.stringify({ level: "error", source: "desktop-bot-bridge", error: error.message, eventType: event.type }));
      }
    },
    onStatus: (status) => {
      updateBridgeStatus(status);
      console.log(JSON.stringify({ level: "info", source: "desktop-bot-bridge", status }));
    }
  });
  setApiBridgeInstance(desktopBotBridge, desktopBotBridge.status());
}

function shutdown() {
  desktopBotBridge?.stop();
  dailyBriefingScheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
