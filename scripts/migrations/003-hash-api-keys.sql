-- 003-hash-api-keys.sql
--
-- Invalidate all existing plaintext API keys.
-- After this migration, the api_key column stores SHA-256 hex digests.
-- All users must re-authenticate via `pika login` to receive a new key.
--
-- This is a one-way migration — plaintext keys cannot be recovered.

UPDATE users SET api_key = NULL WHERE api_key IS NOT NULL;
