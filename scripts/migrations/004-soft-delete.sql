-- 004-soft-delete: Add soft-delete support for sessions
-- deleted_at is NULL for active sessions, ISO 8601 timestamp for deleted ones.
-- Worker upsert ON CONFLICT does not include deleted_at, so re-ingest keeps deleted state.

ALTER TABLE sessions ADD COLUMN deleted_at TEXT DEFAULT NULL;

-- Partial index for Trash page queries (only indexes deleted sessions)
CREATE INDEX idx_sessions_deleted ON sessions(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
