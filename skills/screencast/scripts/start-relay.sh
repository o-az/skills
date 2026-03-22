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

Configuration is provided via environment variables:
  PORT        HTTP/WS port for the viewer (default: 3456)
  CDP_URL     Explicit Chrome DevTools websocket URL
  QUALITY     JPEG quality 1-100 (default: 40)
  MAX_WIDTH   Max frame width (default: 960)
  MAX_HEIGHT  Max frame height (default: 540)
  EVERY_NTH   Send every Nth frame (default: 1)
  WATCH       Directory to watch for file changes
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

if [ ! -f "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT not found" >&2
  exit 1
fi

# Kill any existing relay
pkill -f "server.py" 2>/dev/null || true
sleep 0.5

# Export config so setsid child inherits them
export PYTHONUNBUFFERED=1
for var in PORT CDP_URL QUALITY MAX_WIDTH MAX_HEIGHT EVERY_NTH WATCH; do
  [ -n "${!var:-}" ] && export "$var"
done

# Start relay as a fully detached process
nohup uv run "$SCRIPT" > "$LOG" 2>&1 &
disown

# Wait for it to become healthy
for i in 1 2 3 4 5 6; do
  sleep 1
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "Relay is running. Viewer URL: http://localhost:${PORT:-3456}"
    curl -s "$HEALTH_URL"
    exit 0
  fi
done

echo "ERROR: Relay failed to start. Log:" >&2
cat "$LOG" >&2
exit 1
