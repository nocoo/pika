CREATE TABLE IF NOT EXISTS _test_marker (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO _test_marker (key, value)
  VALUES ('created_at', datetime('now'));
