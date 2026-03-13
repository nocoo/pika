-- Migration 002: Tags
-- Adds user-defined tags that can be attached to sessions.

-- ── Tags ───────────────────────────────────────────────────────

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  color      TEXT,                              -- hex color: "#ff6b6b"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

-- ── Session ↔ Tag junction ─────────────────────────────────────

CREATE TABLE session_tags (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, tag_id)
);

-- ── Indexes ────────────────────────────────────────────────────

CREATE INDEX idx_session_tags_session ON session_tags(session_id);
CREATE INDEX idx_session_tags_tag     ON session_tags(tag_id);
