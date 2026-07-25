import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./server/api/api.mjs";
import { config } from "./server/config.mjs";

const appRoot = fileURLToPath(new URL("./public/", import.meta.url));
const port = config.server.port;
const host = config.server.host;

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
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
      service: "paper-bridge-mvp",
      database: "sqlite",
      backend_configured: Boolean(config.backend.baseUrl),
      api: "/api/v1",
      uptime_seconds: Math.round(process.uptime()),
      request_id: requestId
    });
  }

  if (await handleApiRequest(request, response, requestId)) return;

  if (String(request.url || "").startsWith("/data/")) {
    return sendJson(response, 404, { error: { code: "NOT_FOUND", request_id: requestId } });
  }

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
  console.log(`AI Hub OS Web + API MVP running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
