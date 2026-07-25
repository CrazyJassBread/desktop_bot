PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_bindings (
  gateway_id TEXT PRIMARY KEY,
  pairing_code TEXT NOT NULL UNIQUE,
  bound_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  connected INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('app_voice', 'web')),
  source_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (requester_user_id, addressee_user_id),
  CHECK (requester_user_id <> addressee_user_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS letters_sender_created_idx
  ON letters(sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS letters_recipient_created_idx
  ON letters(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sessions_user_idx
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS gateway_bindings_user_idx
  ON gateway_bindings(bound_user_id);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx
  ON friendships(addressee_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS drafts_owner_updated_idx
  ON drafts(owner_user_id, updated_at DESC);
