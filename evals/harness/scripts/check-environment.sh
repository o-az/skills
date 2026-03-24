#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/check-environment.sh --skill <skill-name> --output <environment-json-path>

Captures runtime/tool availability used by eval runs.
EOF
}

SKILL=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skill)
      SKILL="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
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

if [ -z "$SKILL" ] || [ -z "$OUTPUT" ]; then
  usage >&2
  exit 2
fi

mkdir -p "$(dirname "$OUTPUT")"

required_by_skill() {
  case "$SKILL" in
    manipulating-video)
      printf '%s\n' ffmpeg ffprobe jq curl
      ;;
    screencast)
      printf '%s\n' agent-browser uv curl jq
      ;;
    terminal-recording)
      printf '%s\n' asciinema agg jq curl
      ;;
    upload-image)
      printf '%s\n' curl jq ffmpeg
      ;;
    template)
      printf '%s\n' jq
      ;;
    *)
      printf '%s\n' jq
      ;;
  esac
}

TOOLS_JSON='[]'
while IFS= read -r tool; do
  if [ -z "$tool" ]; then
    continue
  fi

  available=false
  path=""
  version=""
  if command -v "$tool" >/dev/null 2>&1; then
    available=true
    path="$(command -v "$tool")"
    version="$({ "$tool" --version 2>/dev/null || "$tool" -version 2>/dev/null || true; } | head -n 1 | tr -d '\r')"
  fi

  TOOLS_JSON="$(jq -c \
    --arg name "$tool" \
    --argjson available "$available" \
    --arg path "$path" \
    --arg version "$version" \
    '. + [{name:$name, available:$available, path:$path, version:$version}]' <<<"$TOOLS_JSON")"
done < <(required_by_skill)

HAS_IBB=false
if [ -n "${IBB_API_KEY:-}" ]; then
  HAS_IBB=true
fi

HAS_KITTY=false
if [ -n "${KITTY_PID:-}" ] || [[ "${TERM:-}" == *kitty* ]]; then
  HAS_KITTY=true
fi

jq -n \
  --arg schema_version "1.0.0" \
  --arg skill_name "$SKILL" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg os "$(uname -s)" \
  --arg arch "$(uname -m)" \
  --arg term "${TERM:-}" \
  --argjson has_ibb "$HAS_IBB" \
  --argjson has_kitty "$HAS_KITTY" \
  --argjson tools "$TOOLS_JSON" \
  '{
    schema_version: $schema_version,
    skill_name: $skill_name,
    generated_at: $generated_at,
    os: $os,
    arch: $arch,
    terminal: {
      term: $term,
      kitty: $has_kitty
    },
    env: {
      has_ibb_api_key: $has_ibb
    },
    tools: $tools
  }' > "$OUTPUT"

echo "$OUTPUT"
