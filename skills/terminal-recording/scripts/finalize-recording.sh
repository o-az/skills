#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/finalize-recording.sh <cast-path> [--upload-gif]

Uploads an asciinema cast, renders a GIF with agg, and prints JSON to stdout.

Arguments:
  <cast-path>    Path to the .cast file to finalize
  --upload-gif   Also upload the rendered GIF to imgbb

Output JSON fields:
  cast_path
  gif_path
  asciinema_url
  gif_url        Present only when --upload-gif is used
EOF
}

if [ "${1:-}" = "--help" ] || [ $# -lt 1 ]; then
  usage
  exit $([ $# -lt 1 ] && echo 2 || echo 0)
fi

CAST_PATH="$1"
shift

UPLOAD_GIF=0
if [ "${1:-}" = "--upload-gif" ]; then
  UPLOAD_GIF=1
  shift
fi

if [ $# -ne 0 ]; then
  echo "Error: unexpected arguments." >&2
  usage >&2
  exit 2
fi

if [ ! -f "$CAST_PATH" ]; then
  echo "Error: cast file not found: $CAST_PATH" >&2
  exit 1
fi

GIF_PATH="${CAST_PATH%.cast}.gif"
TMP_PREFIX="$(mktemp -u "/tmp/terminal-recording-XXXXXX")"
UPLOAD_STDOUT_LOG="$TMP_PREFIX-upload.stdout.log"
UPLOAD_STDERR_LOG="$TMP_PREFIX-upload.stderr.log"
AGG_LOG="$TMP_PREFIX-agg.log"
GIF_UPLOAD_JSON="$TMP_PREFIX-gif-upload.json"

cleanup() {
  rm -f "$UPLOAD_STDOUT_LOG" "$UPLOAD_STDERR_LOG" "$AGG_LOG" "$GIF_UPLOAD_JSON"
}
trap cleanup EXIT

for cmd in asciinema agg jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd" >&2
    exit 1
  fi
done

echo "Uploading cast..." >&2
asciinema upload "$CAST_PATH" >"$UPLOAD_STDOUT_LOG" 2>"$UPLOAD_STDERR_LOG"

ASCIINEMA_URL="$(grep -Eo 'https://asciinema.org/a/[A-Za-z0-9]+' "$UPLOAD_STDOUT_LOG" | tail -n 1)"
if [ -z "$ASCIINEMA_URL" ]; then
  ASCIINEMA_URL="$(grep -Eo 'https://asciinema.org/a/[A-Za-z0-9]+' "$UPLOAD_STDERR_LOG" | tail -n 1)"
fi

if [ -z "$ASCIINEMA_URL" ]; then
  echo "Error: could not extract asciinema URL from upload output." >&2
  cat "$UPLOAD_STDOUT_LOG" >&2
  cat "$UPLOAD_STDERR_LOG" >&2
  exit 1
fi

echo "Rendering GIF..." >&2
agg "$CAST_PATH" "$GIF_PATH" >"$AGG_LOG" 2>&1

if [ "$UPLOAD_GIF" -eq 1 ]; then
  if [ -z "${IBB_API_KEY:-}" ]; then
    echo "Error: IBB_API_KEY is required for --upload-gif." >&2
    exit 1
  fi

  echo "Uploading GIF..." >&2
  curl -s -X POST "https://api.imgbb.com/1/upload" \
    -F "key=$IBB_API_KEY" \
    -F "image=@$GIF_PATH" > "$GIF_UPLOAD_JSON"

  GIF_URL="$(jq -r '.data.url // empty' "$GIF_UPLOAD_JSON")"
  if [ -z "$GIF_URL" ]; then
    echo "Error: GIF upload failed." >&2
    cat "$GIF_UPLOAD_JSON" >&2
    exit 1
  fi

  jq -n \
    --arg cast_path "$CAST_PATH" \
    --arg gif_path "$GIF_PATH" \
    --arg asciinema_url "$ASCIINEMA_URL" \
    --arg gif_url "$GIF_URL" \
    '{cast_path:$cast_path,gif_path:$gif_path,asciinema_url:$asciinema_url,gif_url:$gif_url}'
  exit 0
fi

jq -n \
  --arg cast_path "$CAST_PATH" \
  --arg gif_path "$GIF_PATH" \
  --arg asciinema_url "$ASCIINEMA_URL" \
  '{cast_path:$cast_path,gif_path:$gif_path,asciinema_url:$asciinema_url}'
