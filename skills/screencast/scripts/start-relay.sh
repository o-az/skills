#!/usr/bin/env bash
# Starts the screencast relay server as a detached background process.
# Usage: ./start-relay.sh <skill_dir>
#
# This script exists because AI agents consistently fail to append "&"
# to background long-running processes. This script handles all of that
# internally so the agent's Bash tool call returns immediately.

set -euo pipefail

SKILL_DIR="${1:?Usage: start-relay.sh <skill_dir>}"
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
