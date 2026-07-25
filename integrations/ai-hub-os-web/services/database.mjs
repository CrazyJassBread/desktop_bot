import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function publicLetter(row, viewerId) {
  return {
    id: row.id,
    subject: row.subject,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    box: row.sender_user_id === viewerId ? "sent" : "inbox",
    sender: {
      id: row.sender_user_id,
      email: row.sender_email,
      displayName: row.sender_name
    },
    recipient: {
      id: row.recipient_user_id,
      email: row.recipient_email,
      displayName: row.recipient_name
    }
  };
}

export class LetterDatabase {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec(readFileSync(schemaPath, "utf8"));
  }

  close() {
    this.connection.close();
  }

  createUser({ id, email, displayName, passwordHash, passwordSalt, createdAt }) {
    this.connection.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, password_salt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, displayName, passwordHash, passwordSalt, createdAt);
    return this.findUserById(id);
  }

  findUserById(id) {
    return publicUser(
      this.connection.prepare(
        "SELECT id, email, display_name, created_at FROM users WHERE id = ?"
      ).get(id)
    );
  }

  findUserWithPassword(email) {
    return this.connection.prepare(`
      SELECT id, email, display_name, password_hash, password_salt, created_at
      FROM users
      WHERE email = ? COLLATE NOCASE
    `).get(email);
  }

  findUserByEmail(email) {
    return publicUser(
      this.connection.prepare(`
        SELECT id, email, display_name, created_at
        FROM users
        WHERE email = ? COLLATE NOCASE
      `).get(email)
    );
  }

  resolveRecipient(value) {
    const normalized = value.trim();
    if (normalized.includes("@")) {
      return this.findUserByEmail(normalized);
    }
    const rows = this.connection.prepare(`
      SELECT id, email, display_name, created_at
      FROM users
      WHERE display_name = ? COLLATE NOCASE
      ORDER BY created_at ASC
      LIMIT 2
    `).all(normalized);
    if (rows.length > 1) {
      const error = new Error("RECIPIENT_AMBIGUOUS");
      error.code = "RECIPIENT_AMBIGUOUS";
      throw error;
    }
    return publicUser(rows[0]);
  }

  createSession({ tokenHash, userId, expiresAt, createdAt }) {
    this.connection.prepare(
      "DELETE FROM sessions WHERE expires_at <= ?"
    ).run(createdAt);
    this.connection.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, userId, expiresAt, createdAt);
  }

  sessionUser(tokenHash, now) {
    return publicUser(
      this.connection.prepare(`
        SELECT u.id, u.email, u.display_name, u.created_at
        FROM sessions AS s
        JOIN users AS u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `).get(tokenHash, now)
    );
  }

  deleteSession(tokenHash) {
    this.connection.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).run(tokenHash);
  }

  saveLetter({
    id,
    senderUserId,
    recipientUserId,
    subject,
    content,
    source,
    sourceEventId,
    createdAt
  }) {
    if (sourceEventId) {
      const existing = this.connection.prepare(
        "SELECT id FROM letters WHERE source_event_id = ?"
      ).get(sourceEventId);
      if (existing) {
        return {
          letter: this.findLetterForViewer(existing.id, senderUserId),
          replayed: true
        };
      }
    }
    this.connection.prepare(`
      INSERT INTO letters (
        id, sender_user_id, recipient_user_id, subject, content,
        source, source_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      senderUserId,
      recipientUserId,
      subject,
      content,
      source,
      sourceEventId,
      createdAt
    );
    return {
      letter: this.findLetterForViewer(id, senderUserId),
      replayed: false
    };
  }

  findLetterForViewer(id, viewerId) {
    const row = this.connection.prepare(`
      SELECT
        l.*,
        sender.email AS sender_email,
        sender.display_name AS sender_name,
        recipient.email AS recipient_email,
        recipient.display_name AS recipient_name
      FROM letters AS l
      JOIN users AS sender ON sender.id = l.sender_user_id
      JOIN users AS recipient ON recipient.id = l.recipient_user_id
      WHERE l.id = ?
        AND (l.sender_user_id = ? OR l.recipient_user_id = ?)
    `).get(id, viewerId, viewerId);
    return row ? publicLetter(row, viewerId) : null;
  }

  listLetters(viewerId, box = "all") {
    const condition = (
      box === "inbox"
        ? "l.recipient_user_id = ?"
        : box === "sent"
          ? "l.sender_user_id = ?"
          : "(l.sender_user_id = ? OR l.recipient_user_id = ?)"
    );
    const parameters = box === "all" ? [viewerId, viewerId] : [viewerId];
    const rows = this.connection.prepare(`
      SELECT
        l.*,
        sender.email AS sender_email,
        sender.display_name AS sender_name,
        recipient.email AS recipient_email,
        recipient.display_name AS recipient_name
      FROM letters AS l
      JOIN users AS sender ON sender.id = l.sender_user_id
      JOIN users AS recipient ON recipient.id = l.recipient_user_id
      WHERE ${condition}
      ORDER BY l.created_at DESC
    `).all(...parameters);
    return rows.map((row) => publicLetter(row, viewerId));
  }
}
