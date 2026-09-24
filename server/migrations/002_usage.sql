-- Bytes of document content per user (every document, including the trash).
-- Triggers keep it current, so the storage limit check does not have to read
-- every document on each save.
ALTER TABLE users ADD COLUMN content_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE users SET content_bytes =
  (SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) FROM documents WHERE user_id = users.id);

CREATE TRIGGER documents_bytes_ai AFTER INSERT ON documents BEGIN
  UPDATE users SET content_bytes = content_bytes + length(CAST(new.content AS BLOB)) WHERE id = new.user_id;
END;
CREATE TRIGGER documents_bytes_ad AFTER DELETE ON documents BEGIN
  UPDATE users SET content_bytes = content_bytes - length(CAST(old.content AS BLOB)) WHERE id = old.user_id;
END;
CREATE TRIGGER documents_bytes_au AFTER UPDATE OF content ON documents BEGIN
  UPDATE users SET content_bytes = content_bytes
    - length(CAST(old.content AS BLOB)) + length(CAST(new.content AS BLOB))
  WHERE id = new.user_id;
END;
