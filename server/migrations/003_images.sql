-- Images pasted or uploaded into documents. The random id in the URL is what
-- grants access, so shared pages can show them without signing in.
CREATE TABLE images (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX images_user ON images(user_id);

-- Images count toward the same storage limit as document text.
CREATE TRIGGER images_bytes_ai AFTER INSERT ON images BEGIN
  UPDATE users SET content_bytes = content_bytes + new.bytes WHERE id = new.user_id;
END;
CREATE TRIGGER images_bytes_ad AFTER DELETE ON images BEGIN
  UPDATE users SET content_bytes = content_bytes - old.bytes WHERE id = old.user_id;
END;
