import { createServer } from "node:http";

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

export function createVisionHttpServer(frameStore) {
  return createServer(async (request, response) => {
    const requestId = crypto.randomUUID();
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    response.setHeader("X-Request-ID", requestId);
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (request.method === "POST" && ["/upload", "/vision/upload"].includes(requestUrl.pathname)) {
      try {
        const frame = await frameStore.accept(request);
        return sendJson(response, 202, {
          status: "accepted",
          bytes: frame.image.length,
          frame_id: frame.id,
          dropped_stale_frame: false
        });
      } catch (error) {
        return sendJson(response, error.statusCode || 400, {
          error: { code: error.message || "INVALID_FRAME", request_id: requestId }
        });
      }
    }

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      return sendJson(response, 200, { status: "ok", ...frameStore.status() });
    }

    return sendJson(response, 404, {
      error: { code: "NOT_FOUND", request_id: requestId }
    });
  });
}

export function startVisionHttpServer(frameStore, options) {
  const server = createVisionHttpServer(frameStore);
  server.listen(options.port, options.host, () => {
    console.log(`Vision JPEG receiver listening on http://${options.host}:${options.port}/upload`);
  });
  return server;
}

