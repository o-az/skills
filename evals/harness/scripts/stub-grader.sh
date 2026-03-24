#!/usr/bin/env bash
set -euo pipefail

: "${EVAL_GRADING_FILE:?EVAL_GRADING_FILE is required}"
: "${EVAL_EVAL_SPEC_FILE:?EVAL_EVAL_SPEC_FILE is required}"
: "${EVAL_OUTPUT_DIR:?EVAL_OUTPUT_DIR is required}"

mkdir -p "$(dirname "$EVAL_GRADING_FILE")"

RESULT="pass"
SUMMARY="Stub grader: execution artifacts found."
SCORE="1"

if [ ! -f "$EVAL_OUTPUT_DIR/assistant-response.md" ]; then
  RESULT="fail"
  SUMMARY="Stub grader: expected output artifact missing (assistant-response.md)."
  SCORE="0"
fi

ASSERTIONS_JSON="$(jq -c --arg result "$RESULT" --arg evidence "$SUMMARY" '.assertions // [] | map({text: ., result: $result, evidence: $evidence})' "$EVAL_EVAL_SPEC_FILE")"

jq -n \
  --arg summary "$SUMMARY" \
  --argjson score "$SCORE" \
  --argjson assertions "$ASSERTIONS_JSON" \
  '{
    overall: {
      score: $score,
      pass_rate: $score,
      environment_failure: false,
      grading_failure: false,
      summary: $summary
    },
    assertions: $assertions
  }' > "$EVAL_GRADING_FILE"

echo "Stub grader wrote $EVAL_GRADING_FILE"
