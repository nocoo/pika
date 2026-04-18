#!/usr/bin/env bash
# Benchmark pre-commit + pre-push hook performance (excluding e2e which requires
# Cloudflare creds and a live worker — not part of the autoresearch loop).
#
# Mirrors the actual hook contents in .husky/pre-commit and .husky/pre-push as
# closely as possible while keeping each phase isolated for diagnostics.
set -uo pipefail

cd "$(dirname "$0")"

LOG_DIR=$(mktemp -d -t pika-ar-XXXXXX)
trap 'rm -rf "$LOG_DIR"' EXIT

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

run_phase() {
  local name="$1"; shift
  local t1 t2
  t1=$(now_ms)
  "$@" >"$LOG_DIR/$name.log" 2>&1
  local rc=$?
  t2=$(now_ms)
  local ms=$(( t2 - t1 ))
  echo "PHASE $name=${ms} rc=${rc}"
  if [ "$rc" -ne 0 ]; then
    echo "--- $name FAILED (last 40 lines) ---"
    tail -40 "$LOG_DIR/$name.log"
    echo "--- end $name ---"
    BENCH_FAILED=1
  fi
  eval "MS_${name}=$ms"
}

BENCH_FAILED=0

# --- pre-commit phases ---
run_phase test_coverage  bun run test:coverage
run_phase biome          bunx biome check packages/

PRECOMMIT_MS=$(( MS_test_coverage + MS_biome ))

# --- additional pre-push phases ---
run_phase build          bun run build
run_phase tsc            bun run lint
run_phase secrets        bun run lint:secrets
run_phase deps           bun run lint:deps
# e2e is intentionally skipped — requires cloudflare creds + live worker.

PREPUSH_MS=$(( PRECOMMIT_MS + MS_build + MS_tsc + MS_secrets + MS_deps ))
TOTAL_MS=$(( PRECOMMIT_MS + PREPUSH_MS ))

echo "METRIC total_ms=${TOTAL_MS}"
echo "METRIC precommit_ms=${PRECOMMIT_MS}"
echo "METRIC prepush_ms=${PREPUSH_MS}"
echo "METRIC test_coverage_ms=${MS_test_coverage}"
echo "METRIC biome_ms=${MS_biome}"
echo "METRIC build_ms=${MS_build}"
echo "METRIC tsc_ms=${MS_tsc}"
echo "METRIC secrets_ms=${MS_secrets}"
echo "METRIC deps_ms=${MS_deps}"

if [ "$BENCH_FAILED" -ne 0 ]; then
  echo "BENCH FAILED — one or more phases returned non-zero"
  exit 1
fi
