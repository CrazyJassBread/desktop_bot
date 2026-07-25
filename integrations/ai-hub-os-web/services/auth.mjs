import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "aihub_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [
          part.slice(0, separator),
          decodeURIComponent(part.slice(separator + 1))
        ];
      })
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

export async function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return (
    actual.length === expected.length
    && timingSafeEqual(actual, expected)
  );
}

export function createSession(database, userId) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_SECONDS * 1_000
  );
  database.createSession({
    tokenHash: tokenHash(token),
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: createdAt.toISOString()
  });
  return token;
}

export function sessionCookie(token, secure = false) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie(secure = false) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function requestSession(request, database) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return { token: null, user: null };
  return {
    token,
    user: database.sessionUser(
      tokenHash(token),
      new Date().toISOString()
    )
  };
}

export function deleteRequestSession(request, database) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (token) database.deleteSession(tokenHash(token));
}

export function newUserId() {
  return randomUUID();
}
