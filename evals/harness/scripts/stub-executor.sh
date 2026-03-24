#!/usr/bin/env bash
set -euo pipefail

: "${EVAL_OUTPUT_DIR:?EVAL_OUTPUT_DIR is required}"
: "${EVAL_PROMPT_FILE:?EVAL_PROMPT_FILE is required}"
: "${EVAL_ARTIFACT_DIR:?EVAL_ARTIFACT_DIR is required}"

mkdir -p "$EVAL_OUTPUT_DIR" "$EVAL_ARTIFACT_DIR"

PROMPT_TEXT="$(cat "$EVAL_PROMPT_FILE")"

cat > "$EVAL_OUTPUT_DIR/assistant-response.md" <<EOF
# Stub Executor Output

This is a harness smoke-test response.

- Skill: ${EVAL_SKILL_NAME:-unknown}
- Eval: ${EVAL_EVAL_ID:-unknown}
- Run: ${EVAL_RUN_ID:-unknown}
- Config: ${EVAL_CONFIG:-unknown}

Prompt:

${PROMPT_TEXT}
EOF

jq -n '{tokens: 0}' > "$EVAL_ARTIFACT_DIR/executor-metrics.json"

echo "Stub executor finished for ${EVAL_SKILL_NAME:-unknown}/${EVAL_EVAL_ID:-unknown}/${EVAL_RUN_ID:-unknown}/${EVAL_CONFIG:-unknown}"
