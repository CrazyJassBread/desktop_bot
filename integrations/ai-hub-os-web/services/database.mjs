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

function publicDraft(row) {
  return {
    id: row.id,
    subject: row.subject,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipient: row.recipient_user_id ? {
      id: row.recipient_user_id,
      email: row.recipient_email,
      displayName: row.recipient_name
    } : null
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

  listFriendships(userId) {
    const rows = this.connection.prepare(`
      SELECT
        f.requester_user_id,
        f.addressee_user_id,
        f.status,
        f.created_at,
        f.updated_at,
        u.id AS other_id,
        u.email AS other_email,
        u.display_name AS other_name,
        u.created_at AS other_created_at
      FROM friendships AS f
      JOIN users AS u ON u.id = CASE
        WHEN f.requester_user_id = ? THEN f.addressee_user_id
        ELSE f.requester_user_id
      END
      WHERE f.requester_user_id = ? OR f.addressee_user_id = ?
      ORDER BY f.updated_at DESC
    `).all(userId, userId, userId);
    const result = { friends: [], incoming: [], outgoing: [] };
    for (const row of rows) {
      const item = {
        user: {
          id: row.other_id,
          email: row.other_email,
          displayName: row.other_name,
          createdAt: row.other_created_at
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      if (row.status === "accepted") result.friends.push(item);
      else if (row.addressee_user_id === userId) result.incoming.push(item);
      else result.outgoing.push(item);
    }
    return result;
  }

  requestFriendship(requesterUserId, addresseeUserId, now) {
    const reverse = this.connection.prepare(`
      SELECT status FROM friendships
      WHERE requester_user_id = ? AND addressee_user_id = ?
    `).get(addresseeUserId, requesterUserId);
    if (reverse) {
      if (reverse.status === "pending") {
        this.connection.prepare(`
          UPDATE friendships SET status = 'accepted', updated_at = ?
          WHERE requester_user_id = ? AND addressee_user_id = ?
        `).run(now, addresseeUserId, requesterUserId);
      }
      return this.listFriendships(requesterUserId);
    }
    this.connection.prepare(`
      INSERT INTO friendships (
        requester_user_id, addressee_user_id, status, created_at, updated_at
      ) VALUES (?, ?, 'pending', ?, ?)
      ON CONFLICT(requester_user_id, addressee_user_id)
      DO UPDATE SET updated_at = excluded.updated_at
    `).run(requesterUserId, addresseeUserId, now, now);
    return this.listFriendships(requesterUserId);
  }

  acceptFriendship(userId, requesterUserId, now) {
    const result = this.connection.prepare(`
      UPDATE friendships SET status = 'accepted', updated_at = ?
      WHERE requester_user_id = ? AND addressee_user_id = ?
        AND status = 'pending'
    `).run(now, requesterUserId, userId);
    return result.changes > 0;
  }

  areFriends(leftUserId, rightUserId) {
    return Boolean(this.connection.prepare(`
      SELECT 1 FROM friendships
      WHERE status = 'accepted' AND (
        (requester_user_id = ? AND addressee_user_id = ?)
        OR (requester_user_id = ? AND addressee_user_id = ?)
      )
    `).get(leftUserId, rightUserId, rightUserId, leftUserId));
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

  registerGateway({ gatewayId, pairingCode, connected, updatedAt }) {
    this.connection.prepare(`
      INSERT INTO gateway_bindings (
        gateway_id, pairing_code, connected, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(gateway_id) DO UPDATE SET
        pairing_code = excluded.pairing_code,
        connected = excluded.connected,
        updated_at = excluded.updated_at
    `).run(
      gatewayId,
      pairingCode,
      connected ? 1 : 0,
      updatedAt,
      updatedAt
    );
    return this.gatewayById(gatewayId);
  }

  bindGateway(pairingCode, userId, updatedAt) {
    const gateway = this.connection.prepare(`
      SELECT gateway_id, connected
      FROM gateway_bindings
      WHERE pairing_code = ?
    `).get(pairingCode);
    if (!gateway) return null;
    if (!gateway.connected) {
      const error = new Error("GATEWAY_OFFLINE");
      error.code = "GATEWAY_OFFLINE";
      throw error;
    }
    this.connection.prepare(`
      UPDATE gateway_bindings
      SET bound_user_id = ?, updated_at = ?
      WHERE gateway_id = ?
    `).run(userId, updatedAt, gateway.gateway_id);
    return this.gatewayById(gateway.gateway_id);
  }

  unbindGatewaysForUser(userId, updatedAt) {
    this.connection.prepare(`
      UPDATE gateway_bindings
      SET bound_user_id = NULL, updated_at = ?
      WHERE bound_user_id = ?
    `).run(updatedAt, userId);
  }

  gatewayById(gatewayId) {
    const row = this.connection.prepare(`
      SELECT
        g.gateway_id,
        g.pairing_code,
        g.connected,
        g.created_at,
        g.updated_at,
        u.id AS user_id,
        u.email AS user_email,
        u.display_name AS user_name,
        u.created_at AS user_created_at
      FROM gateway_bindings AS g
      LEFT JOIN users AS u ON u.id = g.bound_user_id
      WHERE g.gateway_id = ?
    `).get(gatewayId);
    if (!row) return null;
    return {
      gatewayId: row.gateway_id,
      pairingCode: row.pairing_code,
      connected: Boolean(row.connected),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      user: row.user_id ? {
        id: row.user_id,
        email: row.user_email,
        displayName: row.user_name,
        createdAt: row.user_created_at
      } : null
    };
  }

  gatewaysForUser(userId) {
    return this.connection.prepare(`
      SELECT gateway_id, connected, updated_at
      FROM gateway_bindings
      WHERE bound_user_id = ?
      ORDER BY updated_at DESC
    `).all(userId).map((row) => ({
      gatewayId: row.gateway_id,
      connected: Boolean(row.connected),
      updatedAt: row.updated_at
    }));
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

  saveDraft({
    id,
    ownerUserId,
    recipientUserId,
    subject,
    content,
    createdAt,
    updatedAt
  }) {
    this.connection.prepare(`
      INSERT INTO drafts (
        id, owner_user_id, recipient_user_id, subject, content,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        recipient_user_id = excluded.recipient_user_id,
        subject = excluded.subject,
        content = excluded.content,
        updated_at = excluded.updated_at
      WHERE drafts.owner_user_id = excluded.owner_user_id
    `).run(
      id,
      ownerUserId,
      recipientUserId,
      subject,
      content,
      createdAt,
      updatedAt
    );
    return this.findDraft(id, ownerUserId);
  }

  findDraft(id, ownerUserId) {
    const row = this.connection.prepare(`
      SELECT
        d.*,
        recipient.email AS recipient_email,
        recipient.display_name AS recipient_name
      FROM drafts AS d
      LEFT JOIN users AS recipient ON recipient.id = d.recipient_user_id
      WHERE d.id = ? AND d.owner_user_id = ?
    `).get(id, ownerUserId);
    return row ? publicDraft(row) : null;
  }

  listDrafts(ownerUserId) {
    return this.connection.prepare(`
      SELECT
        d.*,
        recipient.email AS recipient_email,
        recipient.display_name AS recipient_name
      FROM drafts AS d
      LEFT JOIN users AS recipient ON recipient.id = d.recipient_user_id
      WHERE d.owner_user_id = ?
      ORDER BY d.updated_at DESC
    `).all(ownerUserId).map(publicDraft);
  }

  deleteDraft(id, ownerUserId) {
    return this.connection.prepare(
      "DELETE FROM drafts WHERE id = ? AND owner_user_id = ?"
    ).run(id, ownerUserId).changes > 0;
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
