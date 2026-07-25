import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  clearSessionCookie,
  createSession,
  deleteRequestSession,
  hashPassword,
  newUserId,
  requestSession,
  sessionCookie,
  verifyPassword
} from "./services/auth.mjs";
import { LetterDatabase } from "./services/database.mjs";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const defaultDatabasePath = fileURLToPath(
  new URL("./data/letters.sqlite", import.meta.url)
);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function problem(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

async function readJson(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("BODY_TOO_LARGE");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("INVALID_JSON");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanText(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeTokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(appRoot, safePath);
  return absolutePath.startsWith(appRoot) ? absolutePath : null;
}

export function createWebServer(options = {}) {
  const database = new LetterDatabase(
    options.databasePath
      ?? process.env.DATABASE_PATH
      ?? defaultDatabasePath
  );
  const bridgeToken = (
    options.bridgeToken
    ?? process.env.AI_HUB_BRIDGE_TOKEN
    ?? ""
  );
  const secureCookies = (
    options.secureCookies
    ?? process.env.NODE_ENV === "production"
  );

  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/health") {
        return sendJson(response, 200, {
          status: "ok",
          service: "ai-hub-letter-space",
          database: "sqlite"
        });
      }

      if (request.method === "POST" && path === "/api/v1/auth/register") {
        const body = await readJson(request);
        const email = normalizeEmail(body.email);
        const displayName = cleanText(body.displayName, 40);
        const password = String(body.password ?? "");
        if (!EMAIL_PATTERN.test(email)) {
          return problem(response, 422, "EMAIL_INVALID", "请输入有效邮箱");
        }
        if (!displayName) {
          return problem(response, 422, "DISPLAY_NAME_REQUIRED", "请输入昵称");
        }
        if (password.length < 8 || password.length > 128) {
          return problem(
            response,
            422,
            "PASSWORD_INVALID",
            "密码长度应为 8–128 位"
          );
        }
        if (database.findUserByEmail(email)) {
          return problem(response, 409, "EMAIL_EXISTS", "该邮箱已注册");
        }
        const credentials = await hashPassword(password);
        const user = database.createUser({
          id: newUserId(),
          email,
          displayName,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          createdAt: new Date().toISOString()
        });
        const token = createSession(database, user.id);
        return sendJson(
          response,
          201,
          { user },
          { "Set-Cookie": sessionCookie(token, secureCookies) }
        );
      }

      if (request.method === "POST" && path === "/api/v1/auth/login") {
        const body = await readJson(request);
        const email = normalizeEmail(body.email);
        const password = String(body.password ?? "");
        const credentials = database.findUserWithPassword(email);
        const valid = (
          credentials
          && await verifyPassword(
            password,
            credentials.password_salt,
            credentials.password_hash
          )
        );
        if (!valid) {
          return problem(
            response,
            401,
            "LOGIN_FAILED",
            "邮箱或密码不正确"
          );
        }
        const user = database.findUserById(credentials.id);
        const token = createSession(database, user.id);
        return sendJson(
          response,
          200,
          { user },
          { "Set-Cookie": sessionCookie(token, secureCookies) }
        );
      }

      if (request.method === "POST" && path === "/api/v1/auth/logout") {
        deleteRequestSession(request, database);
        return sendJson(
          response,
          200,
          { status: "signed_out" },
          { "Set-Cookie": clearSessionCookie(secureCookies) }
        );
      }

      if (request.method === "GET" && path === "/api/v1/auth/session") {
        const { user } = requestSession(request, database);
        if (!user) {
          return problem(response, 401, "AUTH_REQUIRED", "请先登录");
        }
        return sendJson(response, 200, { user });
      }

      if (request.method === "GET" && path === "/api/v1/letters") {
        const { user } = requestSession(request, database);
        if (!user) {
          return problem(response, 401, "AUTH_REQUIRED", "请先登录");
        }
        const requestedBox = url.searchParams.get("box");
        const box = ["all", "inbox", "sent"].includes(requestedBox)
          ? requestedBox
          : "all";
        return sendJson(response, 200, {
          letters: database.listLetters(user.id, box),
          box
        });
      }

      if (
        request.method === "POST"
        && path === "/api/v1/app/voice-letters"
      ) {
        const authorization = String(request.headers.authorization ?? "");
        const suppliedToken = authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : "";
        if (!safeTokenMatches(suppliedToken, bridgeToken)) {
          return problem(
            response,
            401,
            "BRIDGE_UNAUTHORIZED",
            "App 同步凭据无效"
          );
        }
        const body = await readJson(request);
        const sender = database.findUserByEmail(
          normalizeEmail(body.senderEmail)
        );
        if (!sender) {
          return problem(
            response,
            404,
            "SENDER_NOT_FOUND",
            "App 对应用户尚未注册"
          );
        }
        const recipientValue = cleanText(body.recipient, 120);
        let recipient;
        try {
          recipient = database.resolveRecipient(recipientValue);
        } catch (error) {
          if (error.code === "RECIPIENT_AMBIGUOUS") {
            return problem(
              response,
              409,
              error.code,
              "存在同名用户，请在语音中使用收件人邮箱"
            );
          }
          throw error;
        }
        if (!recipient) {
          return problem(
            response,
            404,
            "RECIPIENT_NOT_FOUND",
            "收件人尚未注册"
          );
        }
        const content = cleanText(body.content, 20_000);
        if (!content) {
          return problem(
            response,
            422,
            "LETTER_CONTENT_REQUIRED",
            "信件正文不能为空"
          );
        }
        const result = database.saveLetter({
          id: randomUUID(),
          senderUserId: sender.id,
          recipientUserId: recipient.id,
          subject: (
            cleanText(body.subject, 120)
            || `来自${sender.displayName}的语音信件`
          ),
          content,
          source: "app_voice",
          sourceEventId: cleanText(body.eventId, 128) || null,
          createdAt: new Date().toISOString()
        });
        return sendJson(
          response,
          result.replayed ? 200 : 201,
          result
        );
      }

      if (path.startsWith("/api/")) {
        return problem(response, 404, "NOT_FOUND", "接口不存在");
      }

      let filePath = resolveRequestPath(request.url ?? "/");
      const acceptsHtml = String(request.headers.accept ?? "").includes(
        "text/html"
      );
      if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
        if (acceptsHtml && request.method === "GET") {
          filePath = join(appRoot, "index.html");
        } else {
          return problem(response, 404, "NOT_FOUND", "资源不存在");
        }
      }
      const extension = extname(filePath).toLowerCase();
      response.writeHead(200, {
        "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
        "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=300",
        "Content-Security-Policy": [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "img-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'"
        ].join("; ")
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE") {
        return problem(response, 413, error.code, "请求内容过大");
      }
      if (error.code === "INVALID_JSON") {
        return problem(response, 400, error.code, "请求格式无效");
      }
      if (String(error.code).startsWith("SQLITE_CONSTRAINT_UNIQUE")) {
        return problem(response, 409, "CONFLICT", "数据已存在");
      }
      console.error(error);
      if (!response.headersSent) {
        return problem(response, 500, "INTERNAL_ERROR", "服务暂时不可用");
      }
      response.destroy();
    }
  });

  return {
    server,
    database,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        database.close();
        if (error) reject(error);
        else resolve();
      });
    })
  };
}

function isMainModule() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const application = createWebServer();
  const port = Number.parseInt(process.env.PORT ?? "18000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  application.server.listen(port, host, () => {
    console.log(`AI Hub Letter Space running at http://${host}:${port}`);
  });
  const shutdown = () => {
    application.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
