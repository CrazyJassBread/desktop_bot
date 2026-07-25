import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.mjs";

export const databasePath = config.database.path;
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [, salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'zh' CHECK (preferred_language IN ('zh','en')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending','accepted','blocked')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id <> friend_id)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (sender_id <> recipient_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_friend_request ON friend_requests(sender_id,recipient_id) WHERE status='pending';
  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    transcript TEXT NOT NULL DEFAULT '',
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('requested','recording','processing','ready','failed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS recording_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','recording','processing','ready','failed')),
    language TEXT NOT NULL DEFAULT 'zh' CHECK (language IN ('zh','en')),
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_recording_jobs_user ON recording_jobs(user_id, requested_at DESC);
  CREATE TABLE IF NOT EXISTS letters (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    image_path TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','queued','printed','failed')),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_letters_people ON letters(sender_id, recipient_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    letter_id TEXT NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','printed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('letter')),
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    letter_id TEXT REFERENCES letters(id) ON DELETE CASCADE,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);
`);

const seedUsers = [
  ["usr-lin", "hello@aihub.local", "Demo1234", "Lin An", "zh"],
  ["usr-aiko", "aiko@aihub.local", "Aiko1234", "Aiko", "en"],
  ["usr-mina", "mina@aihub.local", "Mina1234", "Mina", "en"],
  ["usr-noah", "noah@aihub.local", "Noah1234", "Noah", "en"]
];
const insertUser = db.prepare("INSERT OR IGNORE INTO users (id,email,password_hash,display_name,preferred_language) VALUES (?,?,?,?,?)");
for (const [id, email, password, name, language] of seedUsers) insertUser.run(id, email, hashPassword(password), name, language);

const insertFriend = db.prepare("INSERT OR IGNORE INTO friendships (user_id,friend_id,status) VALUES (?,?,'accepted')");
for (const friendId of ["usr-aiko", "usr-mina", "usr-noah"]) {
  insertFriend.run("usr-lin", friendId);
  insertFriend.run(friendId, "usr-lin");
}

db.prepare("INSERT OR IGNORE INTO records (id,user_id,title,transcript,summary,status,created_at) VALUES (?,?,?,?,?,'ready',?)")
  .run("rec-demo-1", "usr-lin", "A quiet Saturday", "Today I fixed the small printer and called my mother.", "A calm day spent repairing the printer and reconnecting with family.", "2026-07-24T10:30:00.000Z");
db.prepare("INSERT OR IGNORE INTO letters (id,sender_id,recipient_id,subject,body,status,sent_at,created_at) VALUES (?,?,?,?,?,'received',?,?)")
  .run("ltr-demo-1", "usr-aiko", "usr-lin", "Rain in Kyoto", "Lin,\n\nIt rained softly in Kyoto today. I thought you might enjoy this small note.\n\nAiko", "2026-07-23T03:18:00.000Z", "2026-07-23T03:18:00.000Z");

const legacyImages = db.prepare("SELECT id,image_path FROM letters WHERE image_path LIKE '%/%'").all();
for (const letter of legacyImages) db.prepare("UPDATE letters SET image_path=? WHERE id=?").run(basename(letter.image_path), letter.id);

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, preferredLanguage: row.preferred_language, createdAt: row.created_at };
}
