-- Initial schema (spec §4). All timestamps are Unix epoch milliseconds.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,              -- JSON array of strings
  scope TEXT NOT NULL DEFAULT 'all',   -- 'all' or JSON array of media IDs
  on_comment INTEGER NOT NULL DEFAULT 1,
  on_story_reply INTEGER NOT NULL DEFAULT 0,
  public_replies TEXT NOT NULL DEFAULT '[]',
  opening_text TEXT NOT NULL,
  button_label TEXT NOT NULL,
  follow_gate INTEGER NOT NULL DEFAULT 0,
  not_following_text TEXT NOT NULL DEFAULT '',
  link_text TEXT NOT NULL DEFAULT '',
  link_button_label TEXT NOT NULL DEFAULT 'Open',
  link_id INTEGER REFERENCES links(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE contacts (
  igsid TEXT PRIMARY KEY,
  username TEXT,
  name TEXT,
  follows_me INTEGER,
  follows_checked_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_inbound_at INTEGER
);

CREATE TABLE processed_events (
  event_key TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE TABLE triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rules(id),
  contact_igsid TEXT NOT NULL,
  media_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('comment', 'story_reply')),
  comment_id TEXT,
  comment_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (rule_id, contact_igsid, media_id)
);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('private_reply', 'public_reply', 'dm')),
  trigger_id INTEGER REFERENCES triggers(id),
  contact_igsid TEXT NOT NULL,
  payload TEXT NOT NULL,               -- JSON ActionPayload
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dropped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at INTEGER,
  sent_at INTEGER,
  sent_mid TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX actions_due ON actions (status, send_at);

CREATE TABLE messages (
  mid TEXT PRIMARY KEY,
  contact_igsid TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'bot', 'creator_app', 'creator_dms')),
  text TEXT,
  attachments TEXT,
  is_trigger INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_contact ON messages (contact_igsid, created_at);

CREATE TABLE conversations (
  contact_igsid TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('needs_reply', 'answered', 'skipped')),
  last_inbound_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  contact_igsid TEXT,
  clicked_at INTEGER NOT NULL
);
CREATE INDEX clicks_link ON clicks (link_id);
