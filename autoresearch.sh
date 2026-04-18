#!/usr/bin/env bash
# Benchmark pre-commit + pre-push hook performance.
#
# We measure the *real wall-clock* of each hook (minus `test:e2e`, which needs
# Cloudflare credentials and a live Worker, unavailable in the autoresearch
# loop). The hook bodies are copied inline below so the bench captures the
# effects of parallelization, caching, and reordering — not just the sum of
# phase times.
#
# Whenever .husky/pre-commit or .husky/pre-push changes, this script must be
# updated in the same commit so the bench stays representative.
set -uo pipefail

cd "$(dirname "$0")"

LOG_DIR=$(mktemp -d -t pika-ar-XXXXXX)
trap 'rm -rf "$LOG_DIR"' EXIT

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

BENCH_FAILED=0

dump_on_fail() {
  local name="$1" rc="$2" log="$3"
  if [ "$rc" -ne 0 ]; then
    echo "--- $name FAILED (last 60 lines) ---"
    tail -60 "$log"
    echo "--- end $name ---"
    BENCH_FAILED=1
  fi
}

# --- Per-phase diagnostics (sequential, isolated) ---------------------------
# These tell us where wall-clock is going on every iteration. They do NOT
# define the primary metric — the gate timings below do.
phase() {
  local name="$1"; shift
  local t1 t2
  t1=$(now_ms)
  bash -c "$*" >"$LOG_DIR/$name.log" 2>&1
  local rc=$?
  t2=$(now_ms)
  local ms=$(( t2 - t1 ))
  echo "PHASE $name=${ms} rc=${rc}"
  dump_on_fail "$name" "$rc" "$LOG_DIR/$name.log"
  eval "MS_${name}=$ms"
}

phase test_coverage  "bun run test:coverage"
phase biome          "bunx biome check packages/"
phase build          "bun run build"
phase tsc            "bun run lint"
phase secrets        "bun run lint:secrets"
phase deps           "bun run lint:deps"

# --- Real pre-commit gate ---------------------------------------------------
# Mirrors .husky/pre-commit verbatim.
t1=$(now_ms)
{
  bun run test:coverage
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then exit 1; fi

  bunx biome check packages/
  BIOME_EXIT=$?
  if [ $BIOME_EXIT -ne 0 ]; then exit 1; fi
} >"$LOG_DIR/pre-commit.log" 2>&1
PC_RC=$?
t2=$(now_ms)
PRECOMMIT_MS=$(( t2 - t1 ))
echo "PHASE pre_commit=${PRECOMMIT_MS} rc=${PC_RC}"
dump_on_fail "pre_commit" "$PC_RC" "$LOG_DIR/pre-commit.log"

# --- Real pre-push gate (minus test:e2e) ------------------------------------
# Mirrors .husky/pre-push verbatim, with the `bun run test:e2e` step removed
# because it requires Cloudflare credentials. The metric still reflects every
# other step (Build + L1 + G1 tsc/Biome + G2 gitleaks/osv-scanner) which is
# where ~95% of pre-push time lives.
t1=$(now_ms)
{
  bun run build
  BUILD_EXIT=$?
  if [ $BUILD_EXIT -ne 0 ]; then exit 1; fi

  bun run test:coverage
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then exit 1; fi

  bun run lint
  LINT_EXIT=$?
  if [ $LINT_EXIT -ne 0 ]; then exit 1; fi

  bunx biome check packages/
  BIOME_EXIT=$?
  if [ $BIOME_EXIT -ne 0 ]; then exit 1; fi

  bun run lint:secrets
  SECRETS_EXIT=$?
  if [ $SECRETS_EXIT -ne 0 ]; then exit 1; fi

  bun run lint:deps
  DEPS_EXIT=$?
  if [ $DEPS_EXIT -ne 0 ]; then exit 1; fi
} >"$LOG_DIR/pre-push.log" 2>&1
PP_RC=$?
t2=$(now_ms)
PREPUSH_MS=$(( t2 - t1 ))
echo "PHASE pre_push=${PREPUSH_MS} rc=${PP_RC}"
dump_on_fail "pre_push" "$PP_RC" "$LOG_DIR/pre-push.log"

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
