#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/prepare-fixtures.sh --skill <skill-name> --eval-id <eval-id> --output-dir <fixtures-dir>

Creates fixture files needed by a specific eval case.
EOF
}

SKILL=""
EVAL_ID=""
OUTPUT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skill)
      SKILL="${2:-}"
      shift 2
      ;;
    --eval-id)
      EVAL_ID="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$SKILL" ] || [ -z "$EVAL_ID" ] || [ -z "$OUTPUT_DIR" ]; then
  usage >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"

FIXTURE_ITEMS='[]'

record_fixture() {
  local path="$1"
  local type="$2"
  FIXTURE_ITEMS="$(jq -c --arg path "$path" --arg type "$type" '. + [{path:$path, type:$type}]' <<<"$FIXTURE_ITEMS")"
}

make_upload_image_fixtures() {
  local base="$1"

  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required to generate upload-image fixtures" >&2
    exit 1
  fi

  ffmpeg -v error -y -f lavfi -i color=c=orange:s=320x240:d=1 -frames:v 1 "$base/diagram.png"
  record_fixture "diagram.png" "generated:png"

  cat > "$base/logo.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#111827"/>
  <circle cx="100" cy="120" r="48" fill="#10b981"/>
  <rect x="150" y="72" width="96" height="96" rx="16" fill="#f59e0b"/>
</svg>
EOF
  record_fixture "logo.svg" "generated:svg"

  ffmpeg -v error -y \
    -f lavfi -i color=c=red:s=160x120:d=0.25 \
    -f lavfi -i color=c=blue:s=160x120:d=0.25 \
    -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
    -loop 0 "$base/test-animation.gif"
  record_fixture "test-animation.gif" "generated:animated-gif"
}

make_manipulating_video_fixtures() {
  local base="$1"

  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required to generate manipulating-video fixtures" >&2
    exit 1
  fi

  ffmpeg -v error -y \
    -f lavfi -i testsrc=duration=5:size=640x360:rate=30 \
    -f lavfi -i sine=frequency=440:duration=5 \
    -c:v libx264 -c:a aac "$base/input.mov"
  record_fixture "input.mov" "generated:video:with-audio"

  ffmpeg -v error -y \
    -f lavfi -i testsrc=duration=6:size=854x480:rate=30 \
    -f lavfi -i sine=frequency=660:duration=6 \
    -c:v libx264 -c:a aac "$base/screen-recording.mp4"
  record_fixture "screen-recording.mp4" "generated:video:with-audio"

  ffmpeg -v error -y \
    -f lavfi -i testsrc=duration=4:size=640x360:rate=30 \
    -c:v libx264 -an "$base/no-audio-source.mp4"
  record_fixture "no-audio-source.mp4" "generated:video:no-audio"
}

make_screencast_fixtures() {
  local base="$1"

  mkdir -p "$base/demo"
  cat > "$base/demo/index.html" <<'EOF'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Screencast Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; background: #f5f5f5; }
      .card { padding: 1rem; background: white; border-radius: 0.75rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Local Screencast Fixture</h1>
      <p>Edit this file while watching the relay.</p>
    </div>
  </body>
</html>
EOF
  record_fixture "demo/index.html" "generated:html"
}

make_terminal_recording_fixtures() {
  local base="$1"

  mkdir -p "$base"
  if command -v asciinema >/dev/null 2>&1; then
    asciinema rec --overwrite --headless --command "sh -lc 'echo setup; sleep 0.1; echo done'" "$base/sample.cast" >/dev/null 2>&1 || true
    if [ -f "$base/sample.cast" ]; then
      record_fixture "sample.cast" "generated:cast"
      return
    fi
  fi

  cat > "$base/sample.cast" <<'EOF'
{"version": 2, "width": 80, "height": 24, "timestamp": 0, "env": {"TERM": "xterm-256color", "SHELL": "/bin/sh"}}
[0.1, "o", "setup\r\n"]
[0.2, "o", "done\r\n"]
EOF
  record_fixture "sample.cast" "generated:cast:fallback"
}

case "$SKILL:$EVAL_ID" in
  upload-image:*)
    make_upload_image_fixtures "$OUTPUT_DIR"
    ;;
  manipulating-video:*)
    make_manipulating_video_fixtures "$OUTPUT_DIR"
    ;;
  screencast:*)
    make_screencast_fixtures "$OUTPUT_DIR"
    ;;
  terminal-recording:*)
    make_terminal_recording_fixtures "$OUTPUT_DIR"
    ;;
  template:*)
    :
    ;;
  *)
    echo "No fixture generator defined for $SKILL / $EVAL_ID" >&2
    ;;
esac

jq -n \
  --arg skill_name "$SKILL" \
  --arg eval_id "$EVAL_ID" \
  --arg output_dir "$OUTPUT_DIR" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson items "$FIXTURE_ITEMS" \
  '{
    status: "ready",
    skill_name: $skill_name,
    eval_id: $eval_id,
    generated_at: $generated_at,
    output_dir: $output_dir,
    items: $items
  }' > "$OUTPUT_DIR/fixture-status.json"

echo "$OUTPUT_DIR"
