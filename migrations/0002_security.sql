CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  hit_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
ALTER TABLE participants ADD COLUMN token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_token_hash ON participants(token_hash) WHERE token_hash IS NOT NULL;
