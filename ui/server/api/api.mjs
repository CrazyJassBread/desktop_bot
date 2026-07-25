import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { db, hashPassword, publicUser, tokenHash, verifyPassword } from "./database.mjs";
import { backendUrl, config } from "../config.mjs";
import { deepSeekChat, deepSeekConfig } from "../services/deepseek-client.mjs";
import { buildThermalLetterSvg } from "../services/thermal-letter.mjs";

const SESSION_COOKIE = "aihub_session";
const shortSessionMs = 24 * 60 * 60 * 1000;
const longSessionMs = 30 * shortSessionMs;
const generatedRoot = fileURLToPath(new URL("../../data/generated/", import.meta.url));

const demoTranscripts = {
  en: "Today I remembered our walk by the river. The weather was cool, and we talked about making more time for the people we care about. I would like to send a short letter to a friend about that peaceful afternoon.",
  zh: "今天我想起了我们沿着河边散步的下午。天气很凉爽，我们聊到应该多花时间陪伴在意的人。我想把这段安静的回忆写成一封短信寄给朋友。"
};

function fallbackSummary(transcript, language) {
  const clean = String(transcript).trim();
  const clipped = clean.length > 150 ? `${clean.slice(0, 147)}…` : clean;
  return language === "zh" ? `这段记录回顾了一段温暖安静的经历，并表达了珍惜朋友与陪伴的心情。${clipped ? ` 核心内容：${clipped}` : ""}` : `This memory reflects on a calm, meaningful experience and the value of friendship and time together.${clipped ? ` Key detail: ${clipped}` : ""}`;
}

function fallbackLetter(transcript, recipientName, senderName, language) {
  if (language === "zh") return { subject: "想与你分享的一段回忆", body: `${recipientName}：\n\n今天我想起了一段很安静的回忆，也想起了陪伴和友谊有多珍贵。${String(transcript).slice(0, 180)}\n\n希望你一切都好。\n\n${senderName}` };
  return { subject: "A memory I wanted to share", body: `Dear ${recipientName},\n\nI was thinking about a quiet memory today and how much friendship and time together matter. ${String(transcript).slice(0, 220)}\n\nI hope you are doing well.\n\n${senderName}` };
}

async function summarizeWithAi(record, user) {
  if (!deepSeekConfig().configured) return { summary: fallbackSummary(record.transcript, user.preferred_language), provider: "demo-fallback" };
  try {
    const result = await deepSeekChat({ userId: user.id, maxTokens: 280, temperature: 0.3, messages: [
      { role: "system", content: `Summarize the transcription clearly in ${user.preferred_language === "zh" ? "Simplified Chinese" : "English"}. Return only the summary.` },
      { role: "user", content: record.transcript }
    ] });
    return { summary: result.content, provider: result.model };
  } catch { return { summary: fallbackSummary(record.transcript, user.preferred_language), provider: "demo-fallback" }; }
}

async function generateLetterWithAi(record, recipient, user) {
  if (!deepSeekConfig().configured) return { ...fallbackLetter(record.transcript, recipient.display_name, user.display_name, user.preferred_language), provider: "demo-fallback" };
  try {
    const result = await deepSeekChat({ userId: user.id, json: true, maxTokens: 700, temperature: 0.7, messages: [
      { role: "system", content: `Write a warm personal letter in ${user.preferred_language === "zh" ? "Simplified Chinese" : "English"}. Return JSON with subject and body. Recipient: ${recipient.display_name}. Sender: ${user.display_name}.` },
      { role: "user", content: record.transcript }
    ] });
    return { subject: String(result.content.subject || "A letter").slice(0, 120), body: String(result.content.body || "").slice(0, 3000), provider: result.model };
  } catch { return { ...fallbackLetter(record.transcript, recipient.display_name, user.display_name, user.preferred_language), provider: "demo-fallback" }; }
}

async function requestBackendTranscript(user, language) {
  const endpoint = backendUrl(config.backend.transcribePath);
  if (!endpoint) return { transcript: demoTranscripts[language], provider: "demo-device" };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.backend.apiToken ? { Authorization: `Bearer ${config.backend.apiToken}` } : {}) },
    body: JSON.stringify({ user: publicUser(user), language }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error("RECORDING_BACKEND_FAILED");
  const payload = await response.json();
  const transcript = String(payload.transcript || "").trim();
  if (!transcript) throw new Error("EMPTY_TRANSCRIPT");
  return { transcript: transcript.slice(0, 10_000), provider: payload.provider || "recording-backend" };
}

async function renderLetterImage(letter) {
  const rendered = buildThermalLetterSvg({ letterId: letter.id, sender: letter.sender_name, recipient: letter.recipient_name, subject: letter.subject, body: letter.body, date: new Date().toISOString().slice(0, 10) });
  await mkdir(generatedRoot, { recursive: true });
  const fileName = `${letter.id}.png`;
  await writeFile(join(generatedRoot, fileName), await sharp(Buffer.from(rendered.svg)).flatten({ background: "#ffffff" }).png().toBuffer());
  db.prepare("UPDATE letters SET image_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(fileName, letter.id);
  return rendered;
}

function letterPayload(row) {
  return { id: row.id, senderId: row.sender_id, recipientId: row.recipient_id, senderName: row.sender_name, recipientName: row.recipient_name, sourceRecordId: row.source_record_id, subject: row.subject, body: row.body, imageUrl: row.image_path ? `/api/v1/letters/${encodeURIComponent(row.id)}/image` : null, status: row.status, createdAt: row.created_at, sentAt: row.sent_at };
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
  return true;
}

function problem(response, status, code, message, requestId) {
  return json(response, status, { code, title: message, requestId });
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 256_000) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value));
}

function sessionCookie(token, maxAge) {
  const secure = config.session.cookieSecure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${secure}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function currentUser(request) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > ?`).get(tokenHash(token), new Date().toISOString());
  if (row) db.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(row.session_id);
  return row || null;
}

function issueSession(userId, remember) {
  const token = randomBytes(32).toString("base64url");
  const ttl = remember ? longSessionMs : shortSessionMs;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
    .run(randomUUID(), userId, tokenHash(token), new Date(Date.now() + ttl).toISOString());
  return { token, ttl };
}

function requireUser(request, response, requestId) {
  const user = currentUser(request);
  if (!user) problem(response, 401, "AUTH_REQUIRED", "Please sign in to continue.", requestId);
  return user;
}

export async function handleApiRequest(request, response, requestId) {
  const url = new URL(request.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/v1/")) return false;
  const path = url.pathname.slice(7);
  const method = request.method || "GET";
  try {
    if (method === "GET" && path === "/auth/session") {
      return json(response, 200, { authenticated: Boolean(currentUser(request)), user: publicUser(currentUser(request)) });
    }
    if (method === "POST" && path === "/auth/login") {
      const body = await readJson(request);
      const user = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(String(body.email || "").trim());
      if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) return problem(response, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.", requestId);
      const session = issueSession(user.id, body.remember === true);
      return json(response, 200, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(session.token, session.ttl) });
    }
    if (method === "POST" && path === "/auth/register") {
      const body = await readJson(request);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.displayName || "").trim();
      const password = String(body.password || "");
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return problem(response, 422, "INVALID_INPUT", "Use a name, valid email, and password of at least 8 characters.", requestId);
      if (db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").get(email)) return problem(response, 409, "EMAIL_EXISTS", "An account already uses this email.", requestId);
      const id = `usr-${randomUUID()}`;
      db.prepare("INSERT INTO users (id,email,password_hash,display_name,preferred_language) VALUES (?,?,?,?,?)")
        .run(id, email, hashPassword(password), name, body.preferredLanguage === "en" ? "en" : "zh");
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
      const session = issueSession(id, false);
      return json(response, 201, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(session.token, session.ttl) });
    }
    if (method === "POST" && path === "/auth/logout") {
      const token = cookies(request)[SESSION_COOKIE];
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
      return json(response, 200, { success: true }, { "Set-Cookie": clearCookie() });
    }

    if (method === "POST" && path === "/device/letters") {
      if (!config.device.apiToken) return problem(response, 503, "DEVICE_DISABLED", "Device letter intake is not configured.", requestId);
      const auth = String(request.headers.authorization || "");
      if (auth !== `Bearer ${config.device.apiToken}`) return problem(response, 401, "INVALID_DEVICE_TOKEN", "Device token is missing or incorrect.", requestId);
      const sender = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(config.device.userEmail);
      if (!sender) return problem(response, 503, "DEVICE_USER_MISSING", "The device user account does not exist.", requestId);
      const body = await readJson(request);
      const content = String(body.body || "").trim().slice(0, 3000);
      if (!content) return problem(response, 422, "INVALID_LETTER", "Letter body is required.", requestId);
      const subject = String(body.subject || "").trim().slice(0, 120) || (sender.preferred_language === "zh" ? "语音信件" : "A voice letter");
      const rawTranscript = String(body.rawTranscript || "").trim().slice(0, 10_000);
      let recordId = null;
      if (rawTranscript) {
        recordId = `rec-${randomUUID()}`;
        const title = sender.preferred_language === "zh" ? `设备口述 ${new Date().toLocaleDateString("zh-CN")}` : `Device dictation ${new Date().toLocaleDateString("en")}`;
        db.prepare("INSERT INTO records (id,user_id,title,transcript,status) VALUES (?,?,?,?,'ready')").run(recordId, sender.id, title, rawTranscript);
      }
      const wantedName = String(body.recipientName || "").trim().toLowerCase();
      const recipient = wantedName ? db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='accepted'`).all(sender.id)
        .find((friend) => String(friend.display_name).trim().toLowerCase() === wantedName) : null;
      const letterId = `ltr-${randomUUID()}`;
      db.prepare("INSERT INTO letters (id,sender_id,recipient_id,source_record_id,subject,body,status) VALUES (?,?,?,?,?,?,'draft')").run(letterId, sender.id, recipient ? recipient.id : null, recordId, subject, content);
      if (!recipient) return json(response, 201, { letterId, status: "draft", matchedRecipient: null });
      const letter = db.prepare("SELECT l.*,s.display_name sender_name,r.display_name recipient_name FROM letters l JOIN users s ON s.id=l.sender_id LEFT JOIN users r ON r.id=l.recipient_id WHERE l.id=?").get(letterId);
      await renderLetterImage(letter);
      const printJobId = `print-${randomUUID()}`;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE letters SET status='queued',sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(letterId);
        db.prepare("INSERT INTO print_jobs (id,letter_id,user_id,status) VALUES (?,?,?,'queued')").run(printJobId, letterId, recipient.id);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return json(response, 201, { letterId, status: "queued", matchedRecipient: recipient.display_name });
    }

    const user = requireUser(request, response, requestId);
    if (!user) return true;

    if (method === "GET" && path === "/dashboard") {
      const counts = {
        records: db.prepare("SELECT COUNT(*) count FROM records WHERE user_id=?").get(user.id).count,
        friends: db.prepare("SELECT COUNT(*) count FROM friendships WHERE user_id=? AND status='accepted'").get(user.id).count,
        letters: db.prepare("SELECT COUNT(*) count FROM letters WHERE sender_id=? OR recipient_id=?").get(user.id, user.id).count
      };
      return json(response, 200, { counts });
    }
    if (method === "GET" && path === "/friends") {
      const items = db.prepare(`SELECT u.id,u.display_name,u.preferred_language,
        (SELECT COUNT(*) FROM letters l WHERE (l.sender_id=? AND l.recipient_id=u.id) OR (l.sender_id=u.id AND l.recipient_id=?)) letter_count
        FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='accepted' ORDER BY u.display_name`).all(user.id, user.id, user.id)
        .map((row) => ({ id: row.id, displayName: row.display_name, preferredLanguage: row.preferred_language, letterCount: row.letter_count }));
      return json(response, 200, { items });
    }
    if (method === "GET" && path === "/records") {
      return json(response, 200, { items: db.prepare("SELECT id,title,transcript,summary,status,created_at AS createdAt FROM records WHERE user_id=? ORDER BY created_at DESC").all(user.id) });
    }
    if (method === "POST" && path === "/recordings/start") {
      const body = await readJson(request);
      const language = body.language === "en" ? "en" : "zh";
      const jobId = `job-${randomUUID()}`;
      db.prepare("INSERT INTO recording_jobs (id,user_id,status,language) VALUES (?,?,'recording',?)").run(jobId, user.id, language);
      try {
        const result = await requestBackendTranscript(user, language);
        const recordId = `rec-${randomUUID()}`;
        const title = language === "zh" ? `语音记录 ${new Date().toLocaleDateString("zh-CN")}` : `Voice record ${new Date().toLocaleDateString("en")}`;
        db.prepare("INSERT INTO records (id,user_id,title,transcript,status) VALUES (?,?,?,?,'ready')").run(recordId, user.id, title, result.transcript);
        db.prepare("UPDATE recording_jobs SET record_id=?,status='ready',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(recordId, jobId);
        return json(response, 201, { job: { id: jobId, status: "ready", recordId, provider: result.provider } });
      } catch (error) {
        db.prepare("UPDATE recording_jobs SET status='failed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(jobId);
        return problem(response, 502, "TRANSCRIPTION_FAILED", "The recording backend could not return a transcription.", requestId);
      }
    }
    const recordingMatch = path.match(/^\/recordings\/([^/]+)$/);
    if (method === "GET" && recordingMatch) {
      const job = db.prepare("SELECT id,record_id,status,language,requested_at,completed_at FROM recording_jobs WHERE id=? AND user_id=?").get(recordingMatch[1], user.id);
      if (!job) return problem(response, 404, "NOT_FOUND", "Recording job not found.", requestId);
      return json(response, 200, { job: { id: job.id, recordId: job.record_id, status: job.status, language: job.language, requestedAt: job.requested_at, completedAt: job.completed_at } });
    }
    const recordMatch = path.match(/^\/records\/([^/]+)$/);
    if (method === "GET" && recordMatch) {
      const record = db.prepare("SELECT id,title,transcript,summary,status,created_at AS createdAt FROM records WHERE id=? AND user_id=?").get(recordMatch[1], user.id);
      if (!record) return problem(response, 404, "NOT_FOUND", "Record not found.", requestId);
      return json(response, 200, { record });
    }
    const summarizeMatch = path.match(/^\/records\/([^/]+)\/summarize$/);
    if (method === "POST" && summarizeMatch) {
      const record = db.prepare("SELECT * FROM records WHERE id=? AND user_id=?").get(summarizeMatch[1], user.id);
      if (!record) return problem(response, 404, "NOT_FOUND", "Record not found.", requestId);
      const result = await summarizeWithAi(record, user);
      db.prepare("UPDATE records SET summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.summary, record.id);
      return json(response, 200, { summary: result.summary, provider: result.provider });
    }
    const generateMatch = path.match(/^\/records\/([^/]+)\/generate-letter$/);
    if (method === "POST" && generateMatch) {
      const body = await readJson(request);
      const record = db.prepare("SELECT * FROM records WHERE id=? AND user_id=?").get(generateMatch[1], user.id);
      const recipient = db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.friend_id=? AND f.status='accepted'`).get(user.id, String(body.recipientId || ""));
      if (!record) return problem(response, 404, "NOT_FOUND", "Record not found.", requestId);
      if (!recipient) return problem(response, 422, "INVALID_RECIPIENT", "Choose someone from your social circle.", requestId);
      const generated = await generateLetterWithAi(record, recipient, user);
      const letterId = `ltr-${randomUUID()}`;
      db.prepare("INSERT INTO letters (id,sender_id,recipient_id,source_record_id,subject,body,status) VALUES (?,?,?,?,?,?,'draft')").run(letterId, user.id, recipient.id, record.id, generated.subject, generated.body);
      return json(response, 201, { letter: { id: letterId, recipientId: recipient.id, recipientName: recipient.display_name, subject: generated.subject, body: generated.body, status: "draft" }, provider: generated.provider });
    }
    if (method === "GET" && path === "/letters") {
      const friendId = url.searchParams.get("friendId");
      let rows;
      if (friendId) rows = db.prepare(`SELECT l.*,s.display_name sender_name,r.display_name recipient_name FROM letters l JOIN users s ON s.id=l.sender_id LEFT JOIN users r ON r.id=l.recipient_id
        WHERE (l.sender_id=? AND l.recipient_id=?) OR (l.sender_id=? AND l.recipient_id=?) ORDER BY l.created_at DESC`).all(user.id, friendId, friendId, user.id);
      else rows = db.prepare(`SELECT l.*,s.display_name sender_name,r.display_name recipient_name FROM letters l JOIN users s ON s.id=l.sender_id LEFT JOIN users r ON r.id=l.recipient_id
        WHERE l.sender_id=? OR l.recipient_id=? ORDER BY l.created_at DESC`).all(user.id, user.id);
      return json(response, 200, { items: rows.map(letterPayload) });
    }
    if (method === "POST" && path === "/letters") {
      const body = await readJson(request);
      const recipient = db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.friend_id=? AND f.status='accepted'`).get(user.id, String(body.recipientId || ""));
      const subject = String(body.subject || "").trim().slice(0, 120);
      const content = String(body.body || "").trim().slice(0, 3000);
      if (!recipient || !subject || !content) return problem(response, 422, "INVALID_LETTER", "Choose a friend and complete the subject and letter.", requestId);
      const id = `ltr-${randomUUID()}`;
      db.prepare("INSERT INTO letters (id,sender_id,recipient_id,subject,body,status) VALUES (?,?,?,?,?,'draft')").run(id, user.id, recipient.id, subject, content);
      return json(response, 201, { letter: { id, recipientId: recipient.id, recipientName: recipient.display_name, subject, body: content, status: "draft" } });
    }
    const letterUpdateMatch = path.match(/^\/letters\/([^/]+)$/);
    if (method === "PATCH" && letterUpdateMatch) {
      const body = await readJson(request);
      const letter = db.prepare("SELECT * FROM letters WHERE id=? AND sender_id=? AND status='draft'").get(letterUpdateMatch[1], user.id);
      if (!letter) return problem(response, 404, "NOT_FOUND", "Editable draft not found.", requestId);
      const subject = String(body.subject || letter.subject).trim().slice(0, 120);
      const content = String(body.body || letter.body).trim().slice(0, 3000);
      if (!subject || !content) return problem(response, 422, "INVALID_LETTER", "Subject and letter body are required.", requestId);
      let recipientId = letter.recipient_id;
      if (body.recipientId !== undefined && body.recipientId !== null && String(body.recipientId) !== String(letter.recipient_id || "")) {
        const recipient = db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.friend_id=? AND f.status='accepted'`).get(user.id, String(body.recipientId));
        if (!recipient) return problem(response, 422, "INVALID_RECIPIENT", "Choose someone from your social circle.", requestId);
        recipientId = recipient.id;
      }
      db.prepare("UPDATE letters SET subject=?,body=?,recipient_id=?,image_path=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(subject, content, recipientId, letter.id);
      return json(response, 200, { letter: { id: letter.id, recipientId, subject, body: content, status: "draft" } });
    }
    const renderMatch = path.match(/^\/letters\/([^/]+)\/render$/);
    if (method === "POST" && renderMatch) {
      const letter = db.prepare(`SELECT l.*,s.display_name sender_name,r.display_name recipient_name FROM letters l JOIN users s ON s.id=l.sender_id LEFT JOIN users r ON r.id=l.recipient_id WHERE l.id=? AND l.sender_id=?`).get(renderMatch[1], user.id);
      if (!letter) return problem(response, 404, "NOT_FOUND", "Letter not found.", requestId);
      if (!letter.recipient_id) return problem(response, 409, "RECIPIENT_REQUIRED", "Choose a recipient before rendering.", requestId);
      const rendered = await renderLetterImage(letter);
      return json(response, 200, { imageUrl: `/api/v1/letters/${encodeURIComponent(letter.id)}/image`, width: rendered.width, height: rendered.height });
    }
    const imageMatch = path.match(/^\/letters\/([^/]+)\/image$/);
    if (method === "GET" && imageMatch) {
      const letter = db.prepare("SELECT image_path FROM letters WHERE id=? AND image_path IS NOT NULL AND (sender_id=? OR recipient_id=?)").get(imageMatch[1], user.id, user.id);
      if (!letter) return problem(response, 404, "NOT_FOUND", "Letter image not found.", requestId);
      const bytes = await readFile(join(generatedRoot, letter.image_path));
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
      response.end(bytes);
      return true;
    }
    const sendMatch = path.match(/^\/letters\/([^/]+)\/send$/);
    if (method === "POST" && sendMatch) {
      const letter = db.prepare("SELECT * FROM letters WHERE id=? AND sender_id=? AND status='draft'").get(sendMatch[1], user.id);
      if (!letter) return problem(response, 404, "NOT_FOUND", "Draft letter not found.", requestId);
      if (!letter.recipient_id) return problem(response, 409, "RECIPIENT_REQUIRED", "Choose a recipient before sending.", requestId);
      if (!letter.image_path) return problem(response, 409, "RENDER_REQUIRED", "Render the letter before sending.", requestId);
      const printJobId = `print-${randomUUID()}`;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE letters SET status='queued',sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(letter.id);
        db.prepare("INSERT INTO print_jobs (id,letter_id,user_id,status) VALUES (?,?,?,'queued')").run(printJobId, letter.id, letter.recipient_id);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return json(response, 200, { letterId: letter.id, status: "queued", printJob: { id: printJobId, status: "queued", recipientId: letter.recipient_id } });
    }
    if (method === "GET" && path === "/print-jobs") {
      const items = db.prepare(`SELECT p.id,p.letter_id,p.status,p.attempts,p.created_at,l.subject,l.image_path,s.display_name sender_name FROM print_jobs p JOIN letters l ON l.id=p.letter_id JOIN users s ON s.id=l.sender_id WHERE p.user_id=? ORDER BY p.created_at DESC`).all(user.id)
        .map((row) => ({ id: row.id, letterId: row.letter_id, status: row.status, attempts: row.attempts, createdAt: row.created_at, subject: row.subject, imageUrl: row.image_path ? `/api/v1/letters/${encodeURIComponent(row.letter_id)}/image` : null, senderName: row.sender_name }));
      return json(response, 200, { items });
    }
    const printStatusMatch = path.match(/^\/print-jobs\/([^/]+)\/status$/);
    if (method === "POST" && printStatusMatch) {
      const body = await readJson(request);
      const status = ["printing", "printed", "failed"].includes(body.status) ? body.status : null;
      const job = db.prepare("SELECT * FROM print_jobs WHERE id=? AND user_id=?").get(printStatusMatch[1], user.id);
      if (!job || !status) return problem(response, 422, "INVALID_PRINT_JOB", "Print job or status is invalid.", requestId);
      db.prepare("UPDATE print_jobs SET status=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, job.id);
      db.prepare("UPDATE letters SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status === "printed" ? "printed" : status === "failed" ? "failed" : "queued", job.letter_id);
      return json(response, 200, { printJob: { id: job.id, status } });
    }
    if (method === "GET" && path === "/account") return json(response, 200, { user: publicUser(user) });
    if (method === "PATCH" && path === "/account") {
      const body = await readJson(request);
      const name = String(body.displayName || user.display_name).trim().slice(0, 80);
      const language = body.preferredLanguage === "en" ? "en" : "zh";
      if (!name) return problem(response, 422, "INVALID_INPUT", "Display name is required.", requestId);
      db.prepare("UPDATE users SET display_name=?,preferred_language=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name, language, user.id);
      return json(response, 200, { user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(user.id)) });
    }
    return problem(response, 404, "NOT_FOUND", "API endpoint not found.", requestId);
  } catch (error) {
    console.error(error);
    problem(response, error.message === "PAYLOAD_TOO_LARGE" ? 413 : 500, "SERVER_ERROR", "The request could not be completed.", requestId);
  }
  return true;
}
