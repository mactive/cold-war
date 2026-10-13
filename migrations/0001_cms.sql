CREATE TABLE cms_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL CHECK(json_valid(data)),
  change_note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE cms_versions (
  revision INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  change_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER cms_version_after_insert AFTER INSERT ON cms_content BEGIN
 INSERT INTO cms_versions VALUES (NEW.revision,NEW.data,NEW.change_note,NEW.updated_at);
END;
CREATE TRIGGER cms_version_after_update AFTER UPDATE ON cms_content BEGIN
 INSERT INTO cms_versions VALUES (NEW.revision,NEW.data,NEW.change_note,NEW.updated_at);
END;
CREATE TABLE admin_sessions (
 token_hash TEXT PRIMARY KEY,
 csrf TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE admin_credentials (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
