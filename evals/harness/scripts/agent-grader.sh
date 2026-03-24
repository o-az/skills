#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/agent-grader.sh --runtime <amp|codex|pi> [options] [-- <extra runtime args>]

Runs an independent grader model for a single eval run and writes grading.json.

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
: "${EVAL_EVAL_SPEC_FILE:?EVAL_EVAL_SPEC_FILE is required}"
: "${EVAL_CONTEXT_FILE:?EVAL_CONTEXT_FILE is required}"
: "${EVAL_FIXTURE_STATUS_FILE:?EVAL_FIXTURE_STATUS_FILE is required}"
: "${EVAL_LOG_DIR:?EVAL_LOG_DIR is required}"
: "${EVAL_OUTPUT_DIR:?EVAL_OUTPUT_DIR is required}"
: "${EVAL_ARTIFACT_DIR:?EVAL_ARTIFACT_DIR is required}"
: "${EVAL_GRADING_FILE:?EVAL_GRADING_FILE is required}"

mkdir -p "$(dirname "$EVAL_GRADING_FILE")" "$EVAL_ARTIFACT_DIR"

PROMPT_FILE="$EVAL_ARTIFACT_DIR/grader-prompt.txt"
RAW_RESPONSE_FILE="$EVAL_ARTIFACT_DIR/${RUNTIME}-grader-response.txt"
PARSED_JSON_FILE="$EVAL_ARTIFACT_DIR/${RUNTIME}-grader-response.json"
NORMALIZED_JSON_FILE="$EVAL_ARTIFACT_DIR/grading-normalized.json"

compose_prompt() {
  {
    printf 'You are an independent grader for a completed eval run.\n'
    printf 'Return ONLY a JSON object (no markdown fences).\n\n'

    printf 'Required output JSON shape:\n'
    cat <<'EOF'
{
  "overall": {
    "score": 0.0,
    "pass_rate": 0.0,
    "environment_failure": false,
    "grading_failure": false,
    "summary": "..."
  },
  "assertions": [
    {
      "text": "<assertion text>",
      "result": "pass|fail|not-applicable",
      "evidence": "<short evidence>"
    }
  ]
}
EOF

    printf '\nRules:\n'
    printf '1. Grade each assertion from the eval spec.\n'
    printf '2. Use exact assertion text in assertion entries.\n'
    printf '3. Use only evidence present in provided logs/artifacts.\n'
    printf '4. Mark environment_failure=true only for clear runtime/tool blockers.\n'
    printf '5. Do not include prose outside JSON.\n\n'

    printf 'Eval Spec JSON:\n'
    cat "$EVAL_EVAL_SPEC_FILE"
    printf '\n\nEval Context JSON:\n'
    cat "$EVAL_CONTEXT_FILE"
    printf '\n\nFixture Status JSON:\n'
    cat "$EVAL_FIXTURE_STATUS_FILE"

    printf '\n\nExecutor Exit Code:\n%s\n' "${EVAL_EXECUTOR_EXIT_CODE:-null}"

    printf '\nExecution Log (tail -n 300):\n'
    tail -n 300 "$EVAL_LOG_DIR/execution.log" 2>/dev/null || true

    printf '\n\nOutput Files:\n'
    (
      cd "$EVAL_OUTPUT_DIR"
      find . -type f | sort
    ) 2>/dev/null || true

    if [ -f "$EVAL_OUTPUT_DIR/assistant-response.md" ]; then
      printf '\n\nAssistant Response:\n'
      cat "$EVAL_OUTPUT_DIR/assistant-response.md"
    fi
  } > "$PROMPT_FILE"
}

extract_json_object() {
  local input_file="$1"
  local output_file="$2"

  if jq -e . "$input_file" >/dev/null 2>&1; then
    cp "$input_file" "$output_file"
    return 0
  fi

  awk '
    {
      line = tolower($0)
      if (!in_json && line ~ /^```json[[:space:]]*$/) {
        in_json = 1
        next
      }

      if (in_json && line ~ /^```[[:space:]]*$/) {
        exit
      }

      if (in_json) {
        print
      }
    }
  ' "$input_file" > "$output_file"
  if [ -s "$output_file" ] && jq -e . "$output_file" >/dev/null 2>&1; then
    return 0
  fi

  awk '
    {
      line = tolower($0)
      if (!in_fence && line ~ /^```[a-z0-9_-]*[[:space:]]*$/) {
        in_fence = 1
        next
      }

      if (in_fence && line ~ /^```[[:space:]]*$/) {
        exit
      }

      if (in_fence) {
        print
      }
    }
  ' "$input_file" > "$output_file"
  if [ -s "$output_file" ] && jq -e . "$output_file" >/dev/null 2>&1; then
    return 0
  fi

  awk '
    {
      text = $0 ORS

      for (i = 1; i <= length(text); i++) {
        c = substr(text, i, 1)

        if (!started) {
          if (c == "{") {
            started = 1
            depth = 1
            out = "{"
          }
          continue
        }

        out = out c

        if (escaped) {
          escaped = 0
          continue
        }

        if (c == "\\" && in_string) {
          escaped = 1
          continue
        }

        if (c == "\"") {
          in_string = !in_string
          continue
        }

        if (!in_string) {
          if (c == "{") {
            depth++
          } else if (c == "}") {
            depth--
            if (depth == 0) {
              print out
              exit
            }
          }
        }
      }
    }
  ' "$input_file" > "$output_file"
  if [ -s "$output_file" ] && jq -e . "$output_file" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

normalize_grading_json() {
  local raw_json_file="$1"
  local output_json_file="$2"

  local spec_assertions_json
  spec_assertions_json="$(jq -c '.assertions // []' "$EVAL_EVAL_SPEC_FILE")"

  jq -n \
    --slurpfile raw "$raw_json_file" \
    --argjson spec_assertions "$spec_assertions_json" \
    '
      ($raw[0] // {}) as $raw |

      def num_or_null(v):
        if v == null then null
        elif (v | type) == "number" then v
        elif (v | type) == "string" then (try (v | tonumber) catch null)
        else null
        end;

      def normalize_result(v):
        ((v // "" | tostring | ascii_downcase)) as $r |
        if $r == "pass" then "pass"
        elif $r == "fail" then "fail"
        elif $r == "not-applicable" or $r == "not applicable" or $r == "na" then "not-applicable"
        else "not-applicable"
        end;

      def assertion_for(text):
        (($raw.assertions // []) | map(select((.text // .assertion // "") == text)) | first) as $a |
        if $a == null then
          {
            text: text,
            result: "not-applicable",
            evidence: "Grader output did not include this assertion"
          }
        else
          {
            text: text,
            result: normalize_result($a.result // $a.status),
            evidence: (($a.evidence // $a.reason // $a.notes // "") | tostring)
          }
        end;

      {
        overall: {
          score: num_or_null($raw.overall.score // $raw.score // $raw.overall.pass_rate // $raw.pass_rate),
          pass_rate: num_or_null($raw.overall.pass_rate // $raw.pass_rate // $raw.overall.score // $raw.score),
          environment_failure: (($raw.overall.environment_failure // $raw.environment_failure // false) == true),
          grading_failure: false,
          summary: (($raw.overall.summary // $raw.summary // "No summary provided") | tostring)
        },
        assertions: ($spec_assertions | map(assertion_for(.)))
      }
    ' > "$output_json_file"
}

compose_prompt

case "$RUNTIME" in
  amp)
    STREAM_FILE="$EVAL_ARTIFACT_DIR/amp-grader-stream.jsonl"

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

    cat "$PROMPT_FILE" | "${AMP_CMD[@]}" > "$STREAM_FILE"

    jq -Rn -r '
      [inputs | fromjson?] as $events |
      [
        $events[]
        | select(.type == "assistant")
        | .message.content[]?
        | select(.type == "text")
        | .text
      ] | join("\n\n")
    ' < "$STREAM_FILE" > "$RAW_RESPONSE_FILE"
    ;;
  codex)
    EVENTS_FILE="$EVAL_ARTIFACT_DIR/codex-grader-events.jsonl"
    SCHEMA_FILE="$EVAL_REPO_ROOT/evals/harness/grading-output-schema.json"

    CODEX_CMD=(
      codex
      exec
      --dangerously-bypass-approvals-and-sandbox
      --sandbox
      danger-full-access
      --skip-git-repo-check
      --ephemeral
      --json
      --output-schema
      "$SCHEMA_FILE"
      --output-last-message
      "$RAW_RESPONSE_FILE"
    )

    if [ -n "$MODEL" ]; then
      CODEX_CMD+=(--model "$MODEL")
    fi

    if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
      CODEX_CMD+=("${EXTRA_ARGS[@]}")
    fi
    CODEX_CMD+=(-)

    CODEX_EXIT=0
    cat "$PROMPT_FILE" | "${CODEX_CMD[@]}" > "$EVENTS_FILE" || CODEX_EXIT=$?

    if [ ! -s "$RAW_RESPONSE_FILE" ] && [ -s "$EVENTS_FILE" ]; then
      jq -Rn -r '
        [inputs | fromjson?] as $events |
        [
          $events[]
          | (.final_message? // .message? // empty)
          | select(type == "string")
        ] | last // ""
      ' < "$EVENTS_FILE" > "$RAW_RESPONSE_FILE"
    fi

    if [ "$CODEX_EXIT" -ne 0 ] && [ ! -s "$RAW_RESPONSE_FILE" ]; then
      echo "Codex grader command failed with exit code $CODEX_EXIT" >&2
      exit "$CODEX_EXIT"
    fi

    if [ "$CODEX_EXIT" -ne 0 ] && [ -s "$RAW_RESPONSE_FILE" ]; then
      echo "Codex grader exited with code $CODEX_EXIT but produced a response; continuing." >&2
    fi
    ;;
  pi)
    PROMPT_TEXT="$(cat "$PROMPT_FILE")"

    PI_CMD=(
      pi
      --no-session
      -p
      --mode
      text
    )

    if [ -n "$MODEL" ]; then
      PI_CMD+=(--model "$MODEL")
    fi

    if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
      PI_CMD+=("${EXTRA_ARGS[@]}")
    fi
    PI_CMD+=("$PROMPT_TEXT")

    "${PI_CMD[@]}" > "$RAW_RESPONSE_FILE"
    ;;
esac

if [ ! -s "$RAW_RESPONSE_FILE" ]; then
  echo "Grader runtime produced empty response" >&2
  exit 1
fi

if ! extract_json_object "$RAW_RESPONSE_FILE" "$PARSED_JSON_FILE"; then
  echo "Grader runtime did not return valid JSON" >&2
  exit 1
fi

normalize_grading_json "$PARSED_JSON_FILE" "$NORMALIZED_JSON_FILE"
cp "$NORMALIZED_JSON_FILE" "$EVAL_GRADING_FILE"

echo "Runtime grader completed using '$RUNTIME'"
