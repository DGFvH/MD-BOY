-- Read-only share links: /s/<share_token>. NULL means not shared.
ALTER TABLE documents ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX documents_share_token ON documents(share_token) WHERE share_token IS NOT NULL;
