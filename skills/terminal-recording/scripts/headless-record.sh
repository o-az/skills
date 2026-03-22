#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/headless-record.sh <cast-path> -- <command...>

Records a non-interactive command into an asciinema cast and prints JSON to stdout.

Examples:
  bash scripts/headless-record.sh /tmp/demo/demo.cast -- sh -lc 'echo hello; sleep 1; echo done'
EOF
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -lt 3 ]; then
  usage
  exit 2
fi

CAST_PATH="$1"
shift

if [ "$1" != "--" ]; then
  echo "Error: expected -- before the command." >&2
  usage >&2
  exit 2
fi
shift

mkdir -p "$(dirname "$CAST_PATH")"

asciinema rec --overwrite --headless --command "$*" "$CAST_PATH" >/tmp/terminal-recording-headless.log 2>&1

jq -n --arg cast_path "$CAST_PATH" '{cast_path:$cast_path}'
