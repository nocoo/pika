#!/usr/bin/env bash
# Benchmark pre-commit + pre-push hook performance.
#
# Methodology
# -----------
# We measure the *real wall-clock* of each hook by running it directly. The
# hook scripts (.husky/pre-commit, .husky/pre-push) are the sources of truth.
# Per-phase timings are recovered from inside the hooks via PIKA_PHASE_LOG=1
# (each parallel gate writes its duration to $PIKA_PHASE_DIR/<name>.ms).
#
# E2E (`bun run test:e2e`) requires Cloudflare credentials and a live Worker,
# unavailable in the autoresearch loop. We pass PIKA_SKIP_E2E=1 so the e2e
# gate becomes a no-op; the rest of pre-push (Build + L1 + G1 tsc/Biome +
# G2 gitleaks/osv-scanner) still runs.
#
# Whenever the hook scripts gain or lose a gate, this script and the
# PIKA_PHASE_LOG plumbing in the hooks must be updated together.
set -uo pipefail

cd "$(dirname "$0")"

LOG_DIR=$(mktemp -d -t pika-ar-XXXXXX)
PHASE_DIR=$(mktemp -d -t pika-phases-XXXXXX)
trap 'rm -rf "$LOG_DIR" "$PHASE_DIR"' EXIT

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

# Number of repetitions; we report the median across runs to suppress system
# noise (CPU contention from background processes, FS cache effects, etc.).
REPS="${PIKA_BENCH_REPS:-2}"

median() {
  printf '%s\n' "$@" | sort -n | awk '
    { a[NR]=$1 }
    END {
      n = NR
      if (n == 0) { print 0; exit }
      if (n % 2 == 1) { print a[(n+1)/2] }
      else { print int((a[n/2] + a[n/2+1]) / 2) }
    }'
}

BENCH_FAILED=0

dump_on_fail() {
  local name="$1" rc="$2" log="$3"
  if [ "$rc" -ne 0 ]; then
    echo "--- $name FAILED (last 80 lines) ---"
    tail -80 "$log"
    echo "--- end $name ---"
    BENCH_FAILED=1
  fi
}

read_phase_ms() {
  local name="$1"
  cat "$PHASE_DIR/$name.ms" 2>/dev/null || echo 0
}

PRECOMMIT_MS_LIST=""
PREPUSH_MS_LIST=""
MS_TEST_COVERAGE_LIST=""
MS_BIOME_LIST=""
MS_BUILD_LIST=""
MS_TSC_LIST=""
MS_SECRETS_LIST=""
MS_DEPS_LIST=""

for rep in $(seq 1 "$REPS"); do
  # --- pre-commit ---
  t1=$(now_ms)
  PIKA_PHASE_DIR="$PHASE_DIR" .husky/pre-commit \
    >"$LOG_DIR/pre-commit-$rep.log" 2>&1
  PC_RC=$?
  t2=$(now_ms)
  PRECOMMIT_MS=$(( t2 - t1 ))
  echo "PHASE pre_commit_rep${rep}=${PRECOMMIT_MS} rc=${PC_RC}"
  dump_on_fail "pre_commit_rep${rep}" "$PC_RC" "$LOG_DIR/pre-commit-$rep.log"
  PRECOMMIT_MS_LIST="$PRECOMMIT_MS_LIST $PRECOMMIT_MS"
  MS_TEST_COVERAGE_LIST="$MS_TEST_COVERAGE_LIST $(read_phase_ms tests)"
  MS_BIOME_LIST="$MS_BIOME_LIST $(read_phase_ms biome)"

  # --- pre-push (e2e skipped, see header) ---
  t1=$(now_ms)
  PIKA_SKIP_E2E=1 PIKA_PHASE_DIR="$PHASE_DIR" .husky/pre-push \
    >"$LOG_DIR/pre-push-$rep.log" 2>&1
  PP_RC=$?
  t2=$(now_ms)
  PREPUSH_MS=$(( t2 - t1 ))
  echo "PHASE pre_push_rep${rep}=${PREPUSH_MS} rc=${PP_RC}"
  dump_on_fail "pre_push_rep${rep}" "$PP_RC" "$LOG_DIR/pre-push-$rep.log"
  PREPUSH_MS_LIST="$PREPUSH_MS_LIST $PREPUSH_MS"
  MS_BUILD_LIST="$MS_BUILD_LIST $(read_phase_ms build)"
  MS_TSC_LIST="$MS_TSC_LIST $(read_phase_ms tsc)"
  MS_SECRETS_LIST="$MS_SECRETS_LIST $(read_phase_ms secrets)"
  MS_DEPS_LIST="$MS_DEPS_LIST $(read_phase_ms deps)"
done

PRECOMMIT_MS=$(median $PRECOMMIT_MS_LIST)
PREPUSH_MS=$(median $PREPUSH_MS_LIST)
MS_test_coverage=$(median $MS_TEST_COVERAGE_LIST)
MS_biome=$(median $MS_BIOME_LIST)
MS_build=$(median $MS_BUILD_LIST)
MS_tsc=$(median $MS_TSC_LIST)
MS_secrets=$(median $MS_SECRETS_LIST)
MS_deps=$(median $MS_DEPS_LIST)

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
