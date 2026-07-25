-- AI Hardware Community MVP schema baseline
-- PostgreSQL 17; application should generate UUIDv7.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended', 'deleted');
CREATE TYPE user_role AS ENUM ('member', 'moderator', 'admin');
CREATE TYPE content_type AS ENUM ('post', 'article', 'project', 'agent_listing');
CREATE TYPE content_status AS ENUM ('draft', 'pending_review', 'published', 'rejected', 'removed', 'archived');
CREATE TYPE visibility_type AS ENUM ('public', 'unlisted', 'followers', 'private');
CREATE TYPE file_status AS ENUM ('initiated', 'uploaded', 'scanning', 'ready', 'rejected', 'deleted');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  email_normalized varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status user_status NOT NULL DEFAULT 'pending',
  role user_role NOT NULL DEFAULT 'member',
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE file_objects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  bucket varchar(80) NOT NULL,
  object_key varchar(512) NOT NULL,
  original_name varchar(255) NOT NULL,
  declared_mime varchar(160),
  detected_mime varchar(160),
  size_bytes bigint CHECK (size_bytes >= 0),
  sha256 char(64),
  status file_status NOT NULL DEFAULT 'initiated',
  visibility visibility_type NOT NULL DEFAULT 'private',
  scan_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  width integer,
  height integer,
  duration_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (bucket, object_key)
);
CREATE INDEX file_objects_owner_created_idx ON file_objects(owner_id, created_at DESC);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username varchar(40) NOT NULL,
  username_normalized varchar(40) NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  bio varchar(500),
  avatar_file_id uuid REFERENCES file_objects(id),
  location varchar(100),
  website_url varchar(2048),
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  creator_status varchar(24) NOT NULL DEFAULT 'none',
  follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  following_count integer NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  content_count integer NOT NULL DEFAULT 0 CHECK (content_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_profiles_username_trgm_idx ON user_profiles USING gin (username gin_trgm_ops);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  token_family_id uuid NOT NULL,
  device_name varchar(160),
  ip_hash char(64),
  user_agent varchar(512),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id, created_at DESC);
CREATE INDEX auth_sessions_family_idx ON auth_sessions(token_family_id);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows(followee_id, created_at DESC);

CREATE TABLE categories (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES categories(id),
  name varchar(80) NOT NULL,
  slug varchar(100) NOT NULL UNIQUE,
  description varchar(500),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE tags (
  id uuid PRIMARY KEY,
  name varchar(60) NOT NULL,
  normalized_name varchar(60) NOT NULL UNIQUE,
  slug varchar(80) NOT NULL UNIQUE,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_name_trgm_idx ON tags USING gin (name gin_trgm_ops);

CREATE TABLE contents (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id),
  category_id uuid REFERENCES categories(id),
  type content_type NOT NULL,
  status content_status NOT NULL DEFAULT 'draft',
  visibility visibility_type NOT NULL DEFAULT 'public',
  title varchar(200),
  slug varchar(220),
  summary varchar(600),
  body_markdown text NOT NULL DEFAULT '',
  cover_file_id uuid REFERENCES file_objects(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  bookmark_count integer NOT NULL DEFAULT 0 CHECK (bookmark_count >= 0),
  download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_markdown, '')), 'C')
  ) STORED,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX contents_type_slug_unique_idx
  ON contents(type, slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX contents_feed_idx
  ON contents(status, published_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX contents_author_idx ON contents(author_id, status, created_at DESC);
CREATE INDEX contents_search_idx ON contents USING gin(search_vector);
CREATE INDEX contents_title_trgm_idx ON contents USING gin(title gin_trgm_ops);

CREATE TABLE project_details (
  content_id uuid PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
  repository_url varchar(2048),
  license_spdx varchar(80),
  hardware_platforms text[] NOT NULL DEFAULT '{}',
  difficulty varchar(24),
  compatibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (difficulty IS NULL OR difficulty IN ('beginner', 'intermediate', 'advanced'))
);

CREATE TABLE content_revisions (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  title varchar(200),
  body_markdown text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_id, revision_no)
);

CREATE TABLE content_tags (
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(content_id, tag_id)
);
CREATE INDEX content_tags_tag_idx ON content_tags(tag_id, content_id);

CREATE TABLE content_assets (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  purpose varchar(24) NOT NULL,
  display_name varchar(255),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_id, file_id, purpose)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid REFERENCES comments(id),
  root_id uuid REFERENCES comments(id),
  depth smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  body varchar(5000) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'visible',
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX comments_content_idx ON comments(content_id, created_at, id);
CREATE INDEX comments_root_idx ON comments(root_id, created_at);

CREATE TABLE content_reactions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  reaction_type varchar(24) NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, content_id, reaction_type)
);
CREATE INDEX content_reactions_content_idx ON content_reactions(content_id, created_at DESC);

CREATE TABLE bookmarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, content_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type varchar(60) NOT NULL,
  entity_type varchar(40),
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON notifications(recipient_id, created_at DESC);

CREATE TABLE reports (
  id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_type varchar(40) NOT NULL,
  target_id uuid NOT NULL,
  reason_code varchar(60) NOT NULL,
  description varchar(2000),
  status varchar(24) NOT NULL DEFAULT 'open',
  assignee_id uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue_idx ON reports(status, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  actor_type varchar(24) NOT NULL,
  actor_id uuid,
  action varchar(100) NOT NULL,
  target_type varchar(60),
  target_id uuid,
  result varchar(24) NOT NULL,
  reason varchar(1000),
  ip_hash char(64),
  request_id varchar(100),
  trace_id varchar(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs(target_type, target_id, created_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type varchar(160) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  trace_id varchar(64),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX outbox_unpublished_idx ON outbox_events(occurred_at) WHERE published_at IS NULL;

CREATE TABLE idempotency_keys (
  scope varchar(100) NOT NULL,
  key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope, key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys(expires_at);

