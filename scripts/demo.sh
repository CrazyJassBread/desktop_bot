#!/usr/bin/env bash
# Demo launcher: runs the bot runtime and the Paper Bridge web app side by side.
# Bot API: http://127.0.0.1:8090  ·  Web app: http://127.0.0.1:18000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT" && python -m app "$@") &
(cd "$ROOT/ui" && node --env-file-if-exists=.env.local server.mjs) &

wait
