#!/usr/bin/env sh
# ensure-tools.sh — sourced by git hooks to verify required CLI tools.

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required tool: $1"
    echo "   Install: $2"
    exit 1
  fi
}

require_tool bun "https://bun.sh"
require_tool gitleaks "brew install gitleaks"
require_tool osv-scanner "brew install osv-scanner"
require_tool npx "ships with Node.js — https://nodejs.org"
