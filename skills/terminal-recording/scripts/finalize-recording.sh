#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/finalize-recording.sh <cast-path> [--upload-cast] [--upload-gif]

Renders a GIF with agg and prints JSON to stdout. Uploads are opt-in only.

Arguments:
  <cast-path>     Path to the .cast file to finalize
  --upload-cast   Upload the cast to asciinema.org
  --upload-gif    Upload the rendered GIF to imgbb

Output JSON fields:
  cast_path
  gif_path
  asciinema_url  Present only when --upload-cast is used
  gif_url        Present only when --upload-gif is used
EOF
}

if [ "${1:-}" = "--help" ] || [ $# -lt 1 ]; then
  usage
  exit $([ $# -lt 1 ] && echo 2 || echo 0)
fi

CAST_PATH="$1"
shift

UPLOAD_CAST=0
UPLOAD_GIF=0
while [ $# -gt 0 ]; do
  case "$1" in
    --upload-cast)
      UPLOAD_CAST=1
      shift
      ;;
    --upload-gif)
      UPLOAD_GIF=1
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [ $# -ne 0 ]; then
  echo "Error: unexpected arguments." >&2
  usage >&2
  exit 2
fi

RESOLVED_CAST_PATH="$(realpath "$CAST_PATH")" || exit 1
if [ ! -f "$RESOLVED_CAST_PATH" ]; then
  echo "Error: cast file not found: $CAST_PATH" >&2
  exit 1
fi
if [ -L "$CAST_PATH" ]; then
  echo "Error: refusing symlink cast path: $CAST_PATH" >&2
  exit 1
fi
case "$RESOLVED_CAST_PATH" in
  *$'\n'*|*$'\r'*) echo "Error: refusing cast path with control characters." >&2; exit 1 ;;
esac
case "$RESOLVED_CAST_PATH" in
  *.cast) ;;
  *) echo "Error: cast path must end in .cast" >&2; exit 1 ;;
esac

CAST_PATH="$RESOLVED_CAST_PATH"
GIF_PATH="${CAST_PATH%.cast}.gif"
TMP_DIR="$(mktemp -d "/tmp/terminal-recording-XXXXXX")"
TMP_PREFIX="$TMP_DIR/files"
UPLOAD_STDOUT_LOG="$TMP_PREFIX-upload.stdout.log"
UPLOAD_STDERR_LOG="$TMP_PREFIX-upload.stderr.log"
AGG_LOG="$TMP_PREFIX-agg.log"
GIF_UPLOAD_JSON="$TMP_PREFIX-gif-upload.json"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for cmd in agg jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd" >&2
    exit 1
  fi
done

if [ "$UPLOAD_GIF" -eq 1 ] && ! command -v curl >/dev/null 2>&1; then
  echo "Error: required command not found: curl" >&2
  exit 1
fi

ASCIINEMA_URL=""
if [ "$UPLOAD_CAST" -eq 1 ]; then
  if ! command -v asciinema >/dev/null 2>&1; then
    echo "Error: required command not found: asciinema" >&2
    exit 1
  fi

  echo "Uploading cast..." >&2
  asciinema upload "$CAST_PATH" >"$UPLOAD_STDOUT_LOG" 2>"$UPLOAD_STDERR_LOG"

  ASCIINEMA_URL="$(grep -Eo 'https://asciinema.org/a/[A-Za-z0-9]+' "$UPLOAD_STDOUT_LOG" | tail -n 1)"
  if [ -z "$ASCIINEMA_URL" ]; then
    ASCIINEMA_URL="$(grep -Eo 'https://asciinema.org/a/[A-Za-z0-9]+' "$UPLOAD_STDERR_LOG" | tail -n 1)"
  fi

  if [ -z "$ASCIINEMA_URL" ]; then
    echo "Error: could not extract asciinema URL from upload output. Refusing to print raw upload output." >&2
    exit 1
  fi
fi

echo "Rendering GIF..." >&2
agg "$CAST_PATH" "$GIF_PATH" >"$AGG_LOG" 2>&1

if [ "$UPLOAD_GIF" -eq 1 ]; then
  if [ -z "${IBB_API_KEY:-}" ]; then
    echo "Error: IBB_API_KEY is required for --upload-gif." >&2
    exit 1
  fi

  echo "Uploading GIF..." >&2
  curl -sS -X POST "https://api.imgbb.com/1/upload" \
    -F "key=$IBB_API_KEY" \
    -F "image=@${GIF_PATH}" > "$GIF_UPLOAD_JSON"

  GIF_URL="$(jq -r '.data.url // empty' "$GIF_UPLOAD_JSON")"
  if [ -z "$GIF_URL" ]; then
    echo "Error: GIF upload failed. Refusing to print raw upload response." >&2
    exit 1
  fi

fi

if [ "$UPLOAD_CAST" -eq 1 ] && [ "$UPLOAD_GIF" -eq 1 ]; then
  jq -n \
    --arg cast_path "$CAST_PATH" \
    --arg gif_path "$GIF_PATH" \
    --arg asciinema_url "$ASCIINEMA_URL" \
    --arg gif_url "$GIF_URL" \
    '{cast_path:$cast_path,gif_path:$gif_path,asciinema_url:$asciinema_url,gif_url:$gif_url}'
elif [ "$UPLOAD_CAST" -eq 1 ]; then
  jq -n \
    --arg cast_path "$CAST_PATH" \
    --arg gif_path "$GIF_PATH" \
    --arg asciinema_url "$ASCIINEMA_URL" \
    '{cast_path:$cast_path,gif_path:$gif_path,asciinema_url:$asciinema_url}'
elif [ "$UPLOAD_GIF" -eq 1 ]; then
  jq -n \
    --arg cast_path "$CAST_PATH" \
    --arg gif_path "$GIF_PATH" \
    --arg gif_url "$GIF_URL" \
    '{cast_path:$cast_path,gif_path:$gif_path,gif_url:$gif_url}'
else
  jq -n \
    --arg cast_path "$CAST_PATH" \
    --arg gif_path "$GIF_PATH" \
    '{cast_path:$cast_path,gif_path:$gif_path}'
fi
