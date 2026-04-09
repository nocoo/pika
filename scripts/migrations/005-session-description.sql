-- Migration 005: Add description column to sessions table
-- User-authored notes/annotations for sessions (distinct from AI-generated summary)

ALTER TABLE sessions ADD COLUMN description TEXT;
