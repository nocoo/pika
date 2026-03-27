#!/usr/bin/env bash
# Setup test environment: apply migrations to D1-test database
# Run this after creating the D1-test database via wrangler

set -euo pipefail

DB_NAME="${1:-pika-db-test}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

echo "Applying migrations to D1 database: $DB_NAME"

for migration in "$MIGRATIONS_DIR"/*.sql; do
  if [ -f "$migration" ]; then
    name=$(basename "$migration")
    echo "  → $name"
    wrangler d1 execute "$DB_NAME" --remote --file "$migration"
  fi
done

echo "All migrations applied to $DB_NAME"

# Apply test marker (only for test DB)
echo "Applying test marker..."
wrangler d1 execute "$DB_NAME" --remote --command "
CREATE TABLE IF NOT EXISTS _test_marker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (id = 1)
);
INSERT OR IGNORE INTO _test_marker (id) VALUES (1);
"

echo "Test environment setup complete for $DB_NAME"
