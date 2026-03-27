-- Test marker table — ONLY applied to test databases.
-- Used by assertTestDatabase() to verify test isolation.
-- Do NOT apply this migration to production or development databases.

CREATE TABLE IF NOT EXISTS _test_marker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (id = 1)
);

INSERT OR IGNORE INTO _test_marker (id) VALUES (1);
