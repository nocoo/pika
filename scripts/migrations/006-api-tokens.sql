-- 006-api-tokens: CLI/programmatic API tokens (replaces users.api_key)
--
-- Schema sourced from docs/17 §身份模型 #6. The token is stored as a SHA-256
-- hash; the raw `pk_*` value is shown to the user once at create time.
-- `user_id` is the primary association (pika data is partitioned by userId);
-- `email` is denormalized for ops/audit queries.

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  token_prefix TEXT,
  hashed TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_email ON api_tokens(email);
