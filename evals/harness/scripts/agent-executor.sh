#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/agent-executor.sh --runtime <amp|codex|pi> [options] [-- <extra runtime args>]

Executes a single eval run using a concrete agent runtime and writes:
1) outputs/assistant-response.md
2) artifacts/executor-metrics.json
3) runtime-specific raw output artifacts

Options:
  --runtime <name>   Runtime to use: amp, codex, pi
  --model <value>    Runtime model (codex/pi only)
  --mode <value>     Amp mode (deep, free, large, rush, smart)
EOF
}

RUNTIME=""
MODEL=""
AMP_MODE=""
EXTRA_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --runtime)
      RUNTIME="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --mode)
      AMP_MODE="${2:-}"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ -z "$RUNTIME" ]; then
  usage >&2
  exit 2
fi

case "$RUNTIME" in
  amp|codex|pi)
    ;;
  *)
    echo "Unsupported runtime: $RUNTIME" >&2
    exit 2
    ;;
esac

: "${EVAL_REPO_ROOT:?EVAL_REPO_ROOT is required}"
: "${EVAL_PROMPT_FILE:?EVAL_PROMPT_FILE is required}"
: "${EVAL_OUTPUT_DIR:?EVAL_OUTPUT_DIR is required}"
: "${EVAL_ARTIFACT_DIR:?EVAL_ARTIFACT_DIR is required}"
: "${EVAL_SKILL_NAME:?EVAL_SKILL_NAME is required}"
: "${EVAL_WITH_SKILL:?EVAL_WITH_SKILL is required}"

mkdir -p "$EVAL_OUTPUT_DIR" "$EVAL_ARTIFACT_DIR"

SKILL_FILE="${EVAL_SKILL_FILE:-$EVAL_REPO_ROOT/skills/$EVAL_SKILL_NAME/SKILL.md}"
PROMPT_COMPOSED_FILE="$EVAL_ARTIFACT_DIR/executor-prompt.txt"
ASSISTANT_RESPONSE_FILE="$EVAL_OUTPUT_DIR/assistant-response.md"
METRICS_FILE="$EVAL_ARTIFACT_DIR/executor-metrics.json"

compose_prompt() {
  local base_prompt
  base_prompt="$(cat "$EVAL_PROMPT_FILE")"

  {
    printf '%s\n\n' "$base_prompt"

    if [ "$EVAL_WITH_SKILL" = "true" ]; then
      printf 'Evaluation Mode: WITH_SKILL\n'
      printf 'Follow the skill instructions below as the primary workflow for this task.\n\n'
      if [ -f "$SKILL_FILE" ]; then
        printf 'Skill Path: %s\n\n' "$SKILL_FILE"
        printf '%s\n' '--- BEGIN SKILL.md ---'
        cat "$SKILL_FILE"
        printf '\n%s\n' '--- END SKILL.md ---'
      else
        printf 'Skill file not found at %s\n' "$SKILL_FILE"
      fi
    else
      printf 'Evaluation Mode: WITHOUT_SKILL baseline\n'
      printf 'Do not read or rely on files in skills/ for this run.\n'
      printf 'Solve the task using your default behavior only.\n'
    fi

    printf '\nFinal response requirement: provide a concise plain-text summary of what you did.\n'
  } > "$PROMPT_COMPOSED_FILE"
}

extract_tokens_from_jsonl() {
  local jsonl_file="$1"
  jq -Rn '[inputs | fromjson?] | [.. | objects | .total_tokens? | numbers] | last // null' < "$jsonl_file" 2>/dev/null || echo "null"
}

compose_prompt

TOKENS_JSON="null"

case "$RUNTIME" in
  amp)
    STREAM_FILE="$EVAL_ARTIFACT_DIR/amp-executor-stream.jsonl"

    AMP_CMD=(
      amp
      --dangerously-allow-all
      --no-notifications
      --no-jetbrains
      --no-ide
      -x
      --stream-json
      --stream-json-thinking
      --archive
    )

    if [ -n "$AMP_MODE" ]; then
      AMP_CMD+=(--mode "$AMP_MODE")
    fi

    if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
      AMP_CMD+=("${EXTRA_ARGS[@]}")
    fi

    cat "$PROMPT_COMPOSED_FILE" | "${AMP_CMD[@]}" > "$STREAM_FILE"

    jq -Rn -r '
      [inputs | fromjson?] as $events |
      [
        $events[]
        | select(.type == "assistant")
        | .message.content[]?
        | select(.type == "text")
        | .text
      ] | join("\n\n")
    ' < "$STREAM_FILE" > "$ASSISTANT_RESPONSE_FILE"

    TOKENS_JSON="$(extract_tokens_from_jsonl "$STREAM_FILE")"
    ;;
  codex)
    EVENTS_FILE="$EVAL_ARTIFACT_DIR/codex-executor-events.jsonl"

    CODEX_CMD=(
      codex
      exec
      --dangerously-bypass-approvals-and-sandbox
      --sandbox
      danger-full-access
      --skip-git-repo-check
      --ephemeral
      --json
      --output-last-message
      "$ASSISTANT_RESPONSE_FILE"
    )

    if [ -n "$MODEL" ]; then
      CODEX_CMD+=(--model "$MODEL")
    fi

    if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
      CODEX_CMD+=("${EXTRA_ARGS[@]}")
    fi
    CODEX_CMD+=(-)

    cat "$PROMPT_COMPOSED_FILE" | "${CODEX_CMD[@]}" > "$EVENTS_FILE"

    if [ ! -s "$ASSISTANT_RESPONSE_FILE" ]; then
      jq -Rn -r '
        [inputs | fromjson?] as $events |
        [
          $events[]
          | (.final_message? // .message? // empty)
          | select(type == "string")
        ] | last // ""
      ' < "$EVENTS_FILE" > "$ASSISTANT_RESPONSE_FILE"
    fi

    TOKENS_JSON="$(extract_tokens_from_jsonl "$EVENTS_FILE")"
    ;;
  pi)
    PI_OUTPUT_FILE="$EVAL_ARTIFACT_DIR/pi-executor-output.txt"
    PROMPT_TEXT="$(cat "$PROMPT_COMPOSED_FILE")"

    PI_CMD=(
      pi
      --no-session
      -p
      --mode
      text
      --tools
      "read,bash,edit,write,grep,find,ls"
    )

    if [ -n "$MODEL" ]; then
      PI_CMD+=(--model "$MODEL")
    fi

    if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
      PI_CMD+=("${EXTRA_ARGS[@]}")
    fi
    PI_CMD+=("$PROMPT_TEXT")

    "${PI_CMD[@]}" > "$PI_OUTPUT_FILE"
    cp "$PI_OUTPUT_FILE" "$ASSISTANT_RESPONSE_FILE"
    ;;
esac

if [ ! -s "$ASSISTANT_RESPONSE_FILE" ]; then
  echo "Executor did not produce assistant-response.md" >&2
  exit 1
fi

jq -n \
  --arg runtime "$RUNTIME" \
  --arg model "$MODEL" \
  --arg mode "$AMP_MODE" \
  --argjson tokens "$TOKENS_JSON" \
  '{
    runtime: $runtime,
    model: (if $model == "" then null else $model end),
    mode: (if $mode == "" then null else $mode end),
    tokens: $tokens
  }' > "$METRICS_FILE"

echo "Runtime executor completed using '$RUNTIME'"
