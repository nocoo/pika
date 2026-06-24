#!/usr/bin/env sh
# ensure-tools.sh — sourced by git hooks to verify required CLI tools.
#
# Pass tool keywords as positional args; only those are checked. Each hook
# declares its own deps (pre-commit only needs bun + gitleaks; pre-push
# additionally needs osv-scanner and npx). Without scoping, a machine
# missing osv-scanner couldn't commit even though commit never invokes it.

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required tool: $1"
    echo "   Install: $2"
    exit 1
  fi
}

for tool in "$@"; do
  case "$tool" in
    bun)         require_tool bun         "https://bun.sh" ;;
    gitleaks)    require_tool gitleaks    "brew install gitleaks" ;;
    osv-scanner) require_tool osv-scanner "brew install osv-scanner" ;;
    npx)         require_tool npx         "ships with Node.js — https://nodejs.org" ;;
    *)           echo "ensure-tools.sh: unknown tool '$tool'"; exit 2 ;;
  esac
done
