#!/usr/bin/env bash
# Demo launcher: runs the bot runtime and the web demo side by side.
# Bot API: http://127.0.0.1:8090  ·  Web demo: http://127.0.0.1:18000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Export DEEPSEEK_API_KEY etc. for the bot's LLM sessions.
if [ -f "$ROOT/integrations/ai-hub-os-web/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/integrations/ai-hub-os-web/.env"
  set +a
fi

cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT" && python -m app "$@") &
(cd "$ROOT/integrations/ai-hub-os-web" && node server.mjs) &

wait
