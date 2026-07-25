#!/usr/bin/env bash
# End-to-end test launcher for everything except the bot firmware.
#
# Starts the web UI and the bot runtime in microphone-test mode, verifies
# each layer with health checks, then keeps both running for interactive
# voice testing (dictated letters land in the web UI database).
#
#   ./scripts/e2e_test.sh                 preflight + launch + health checks
#   ./scripts/e2e_test.sh --probe-letter  also POST a real test letter into
#                                         the UI database to prove the
#                                         delivery path end to end
#
# Bot API: http://127.0.0.1:8090  ·  Web app: http://127.0.0.1:18000
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

UI_URL="http://127.0.0.1:18000"
APP_URL="http://127.0.0.1:8090"
UI_LOG="$ROOT/logs/e2e-ui.log"
APP_LOG="$ROOT/logs/e2e-app.log"
PROBE_LETTER=0
[ "${1:-}" = "--probe-letter" ] && PROBE_LETTER=1

FAILURES=0
pass() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '\033[36m▸ %s\033[0m\n' "$1"; }

UI_PID=""
APP_PID=""
cleanup() {
  trap - INT TERM EXIT
  info "shutting down"
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
  [ -n "$UI_PID" ] && kill "$UI_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

wait_http() { # url, seconds
  local url="$1" seconds="$2" i
  for i in $(seq 1 "$seconds"); do
    if curl -sf --max-time 2 -o /dev/null "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

port_free() { # port
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# ---------------------------------------------------------------- preflight
info "preflight checks"

if "$PY" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"; then
  pass "python $("$PY" -c 'import platform; print(platform.python_version())')"
else
  fail "python >= 3.11 required at $PY"
fi

if "$PY" - <<'EOF' 2>/dev/null
import aiohttp, faster_whisper, sounddevice, yaml  # noqa: F401
EOF
then
  pass "python dependencies (aiohttp, faster-whisper, sounddevice, yaml)"
else
  fail "python dependencies missing; run: pip install -r requirements.txt"
fi

if [ -f "$ROOT/models/faster-whisper-small/model.bin" ]; then
  pass "local ASR model models/faster-whisper-small"
else
  fail "missing models/faster-whisper-small/model.bin"
fi

if "$PY" -c "from app.config import load_config; load_config('config')" 2>/dev/null; then
  pass "config/ directory loads and validates"
else
  fail "config/ failed to load; run: $PY -c \"from app.config import load_config; load_config('config')\""
fi

NODE_MAJOR="$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 22 ]; then
  pass "node $(node --version) (>= 22 for node:sqlite)"
else
  fail "node >= 22 required, found: $(node --version 2>/dev/null || echo none)"
fi

BOT_TOKEN="$(sed -n 's/^[[:space:]]*device_token:[[:space:]]*//p' "$ROOT/config/ui.yaml" | tr -d '"' | head -1)"
UI_TOKEN="$(sed -n 's/^DEVICE_API_TOKEN=//p' "$ROOT/ui/.env.local" | head -1)"
if [ -n "$BOT_TOKEN" ] && [ "$BOT_TOKEN" = "$UI_TOKEN" ]; then
  pass "device token matches between config/ui.yaml and ui/.env.local"
else
  fail "device token mismatch: config/ui.yaml='$BOT_TOKEN' ui/.env.local='$UI_TOKEN'"
fi

for port in 18000 8090; do
  if port_free "$port"; then
    pass "port $port is free"
  else
    fail "port $port already in use; stop the other process first"
  fi
done

if [ "$FAILURES" -gt 0 ]; then
  printf '\n\033[31mpreflight failed (%d problem(s)); not launching.\033[0m\n' "$FAILURES"
  exit 1
fi

# ----------------------------------------------------------------- start ui
info "starting web UI ($UI_URL, log: logs/e2e-ui.log)"
mkdir -p "$ROOT/logs"
(cd "$ROOT/ui" && exec node --env-file-if-exists=.env.local server.mjs) \
  >"$UI_LOG" 2>&1 &
UI_PID=$!

if wait_http "$UI_URL" 15; then
  pass "web UI is serving pages"
else
  fail "web UI did not come up; last log lines:"
  tail -5 "$UI_LOG" | sed 's/^/    /'
  exit 1
fi

# Auth must reject a bad device token without touching the database.
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Authorization: Bearer definitely-wrong-token' \
  -H 'Content-Type: application/json' -d '{}' \
  "$UI_URL/api/v1/device/letters")"
if [ "$STATUS" = "401" ]; then
  pass "device letter endpoint enforces token auth (401 on bad token)"
elif [ "$STATUS" = "503" ]; then
  fail "device letter intake disabled or device user missing (503)"
else
  fail "unexpected status $STATUS from device letter endpoint"
fi

if [ "$PROBE_LETTER" = "1" ]; then
  BODY="$(curl -s -X POST \
    -H "Authorization: Bearer $BOT_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"subject":"e2e probe","body":"scripts/e2e_test.sh delivery probe","rawTranscript":"e2e probe","sessionId":"e2e"}' \
    "$UI_URL/api/v1/device/letters")"
  if printf '%s' "$BODY" | grep -q '"letterId"'; then
    pass "probe letter stored in UI database: $BODY"
  else
    fail "probe letter rejected: $BODY"
  fi
fi

# ---------------------------------------------------------------- start app
info "starting bot runtime in mictest mode (log: logs/e2e-app.log)"
(cd "$ROOT" && exec "$PY" -m app mictest) >"$APP_LOG" 2>&1 &
APP_PID=$!

# Model loading can take a while on first start.
if wait_http "$APP_URL/api/health" 60; then
  pass "bot API is healthy ($APP_URL/api/health)"
else
  fail "bot runtime did not come up; last log lines:"
  tail -5 "$APP_LOG" | sed 's/^/    /'
  exit 1
fi

STATE="$(curl -sf "$APP_URL/api/state" 2>/dev/null || true)"
if [ -n "$STATE" ]; then
  pass "controller state: $STATE"
else
  fail "could not read $APP_URL/api/state"
fi

# ------------------------------------------------------------------ summary
printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf '\033[31m%d check(s) failed — see above.\033[0m\n\n' "$FAILURES"
else
  printf '\033[32mAll automated checks passed.\033[0m\n\n'
fi

cat <<EOF
Both services are running. Interactive checklist (speak into the mic):

  ASR         say anything            → logs/mictest/asr_results.jsonl
  Letter      "开始写信 … 结束写信"    → logs/mictest/llm_results.jsonl,
                                        then refresh $UI_URL letters page
  Q&A         "我有一个问题 … 问完了"  → llm_results.jsonl answer entry
  Language    "切换英文" / "切换中文"  → curl $APP_URL/api/state
  Events      live stream             → websocket $APP_URL/api/events

Not covered here (needs bot firmware): TCP audio (8081), camera upload
(8082), gestures, voice photo + thermal printing.

Press Ctrl+C to stop both services.
EOF

wait
