#!/usr/bin/env bash
# Starts the screencast relay server as a detached background process.
# Run from the skill root: bash scripts/start-relay.sh

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/start-relay.sh

Starts the screencast relay in the background, waits for /health, then prints:
- a human-readable viewer URL
- the JSON /health response

The script also attempts an initial page reload (via agent-browser) and waits briefly
for the first screencast frame so viewers do not stay on "waiting for frames...".

Configuration is provided via environment variables:
  PORT        HTTP/WS port for the viewer (default: 3456)
  BIND_HOST   Bind host for relay HTTP/WS server (default: 127.0.0.1)
  CDP_URL     Explicit Chrome DevTools websocket URL
  QUALITY     JPEG quality 1-100 (default: 40)
  MAX_WIDTH   Max frame width (default: 960)
  MAX_HEIGHT  Max frame height (default: 540)
  EVERY_NTH   Send every Nth frame (default: 1)
  WATCH       Directory to watch for file changes
  FORCE_INITIAL_RELOAD  Set to 0 to skip the automatic first-frame reload
EOF
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -ne 0 ]; then
  echo "ERROR: unexpected arguments." >&2
  usage >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$SKILL_DIR/scripts/server.py"
LOG="/tmp/screencast-relay.log"
HEALTH_URL="http://localhost:${PORT:-3456}/health"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 1
  fi
}

extract_frames() {
  sed -n 's/.*"frames"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

if [ ! -f "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT not found" >&2
  exit 1
fi

require_cmd uv
require_cmd curl

if [ -z "${CDP_URL:-}" ]; then
  require_cmd agent-browser
  if ! agent-browser get cdp-url >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: Could not discover an active Chrome DevTools target from agent-browser.
Run this first:
  AGENT_BROWSER_STREAM_PORT=9223 agent-browser open <URL>
EOF
    exit 1
  fi
fi

# Kill any existing relay
pkill -f "server.py" 2>/dev/null || true
sleep 0.5

# Export config so the detached child inherits them
export PYTHONUNBUFFERED=1
for var in PORT BIND_HOST CDP_URL QUALITY MAX_WIDTH MAX_HEIGHT EVERY_NTH WATCH IDLE_TIMEOUT; do
  [ -n "${!var:-}" ] && export "$var"
done

# Start relay as a fully detached process
nohup uv run "$SCRIPT" > "$LOG" 2>&1 &
disown

# Wait for health endpoint
HEALTH_JSON=""
for i in 1 2 3 4 5 6; do
  sleep 1
  HEALTH_JSON="$(curl -sf "$HEALTH_URL" 2>/dev/null || true)"
  if [ -n "$HEALTH_JSON" ]; then
    break
  fi
done

if [ -z "$HEALTH_JSON" ]; then
  echo "ERROR: Relay failed to start. Log:" >&2
  cat "$LOG" >&2
  exit 1
fi

if [ "${FORCE_INITIAL_RELOAD:-1}" != "0" ] && command -v agent-browser >/dev/null 2>&1; then
  if agent-browser eval "location.reload()" >/dev/null 2>&1; then
    echo "Triggered initial page reload to push first frame."
  else
    echo "WARN: Could not trigger initial reload via agent-browser." >&2
  fi
fi

FRAMES="$(printf '%s' "$HEALTH_JSON" | extract_frames)"
if [ -z "$FRAMES" ]; then
  FRAMES=0
fi

if [ "$FRAMES" -le 0 ]; then
  for _ in 1 2 3 4 5 6; do
    sleep 0.5
    HEALTH_JSON="$(curl -sf "$HEALTH_URL" 2>/dev/null || true)"
    FRAMES="$(printf '%s' "$HEALTH_JSON" | extract_frames)"
    if [ -n "$FRAMES" ] && [ "$FRAMES" -gt 0 ]; then
      break
    fi
  done
fi

echo "Relay is running. Viewer URL: http://localhost:${PORT:-3456}"
printf '%s\n' "$HEALTH_JSON"

if [ -z "$FRAMES" ] || [ "$FRAMES" -le 0 ]; then
  echo 'WARN: Relay is healthy but has not received frames yet. Run: agent-browser eval "location.reload()"' >&2
fi

exit 0
