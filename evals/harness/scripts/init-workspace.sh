#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/init-workspace.sh --skill <skill-name> --iteration <n> --runs <count>

Creates an iteration workspace with canonical run directories and metadata files.
EOF
}

SKILL=""
ITERATION=""
RUNS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skill)
      SKILL="${2:-}"
      shift 2
      ;;
    --iteration)
      ITERATION="${2:-}"
      shift 2
      ;;
    --runs)
      RUNS="${2:-}"
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

if [ -z "$SKILL" ] || [ -z "$ITERATION" ] || [ -z "$RUNS" ]; then
  usage >&2
  exit 2
fi

if ! [[ "$ITERATION" =~ ^[0-9]+$ ]] || [ "$ITERATION" -lt 1 ]; then
  echo "--iteration must be a positive integer." >&2
  exit 2
fi

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [ "$RUNS" -lt 1 ]; then
  echo "--runs must be a positive integer." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL_EVAL_FILE="$ROOT/evals/$SKILL/evals/evals.json"

if [ ! -f "$SKILL_EVAL_FILE" ]; then
  echo "Eval spec not found: $SKILL_EVAL_FILE" >&2
  exit 1
fi

ITER_DIR="$ROOT/evals/$SKILL/workspace/iteration-$ITERATION"
mkdir -p "$ITER_DIR"

EVAL_IDS="$({
  jq -r '.evals[].id' "$SKILL_EVAL_FILE"
} | sed '/^$/d')"

if [ -z "$EVAL_IDS" ]; then
  echo "No eval ids found in $SKILL_EVAL_FILE" >&2
  exit 1
fi

for eval_id in $EVAL_IDS; do
  EVAL_ENTRY_JSON="$(jq -c --arg id "$eval_id" '.evals[] | select(.id == $id)' "$SKILL_EVAL_FILE")"
  if [ -z "$EVAL_ENTRY_JSON" ] || [ "$EVAL_ENTRY_JSON" = "null" ]; then
    echo "Missing eval entry for id '$eval_id' in $SKILL_EVAL_FILE" >&2
    exit 1
  fi

  EVAL_PROMPT="$(jq -r '.prompt // ""' <<<"$EVAL_ENTRY_JSON")"
  EVAL_EXPECTED_OUTPUT="$(jq -r '.expected_output // ""' <<<"$EVAL_ENTRY_JSON")"
  EVAL_ASSERTIONS="$(jq -c '.assertions // []' <<<"$EVAL_ENTRY_JSON")"

  for run_idx in $(seq -w 1 "$RUNS"); do
    for config in with_skill without_skill; do
      RUN_DIR="$ITER_DIR/eval-$eval_id/run-$run_idx/$config"
      mkdir -p "$RUN_DIR/fixtures" "$RUN_DIR/outputs" "$RUN_DIR/logs" "$RUN_DIR/artifacts"
      : > "$RUN_DIR/prompt.txt"
      jq -n \
        --arg skill_name "$SKILL" \
        --arg eval_id "$eval_id" \
        --arg run "run-$run_idx" \
        --arg config "$config" \
        --arg prompt "$EVAL_PROMPT" \
        --arg expected_output "$EVAL_EXPECTED_OUTPUT" \
        --argjson assertions "$EVAL_ASSERTIONS" \
        '{
          skill_name: $skill_name,
          eval_id: $eval_id,
          run: $run,
          config: $config,
          prompt: $prompt,
          expected_output: $expected_output,
          assertions: $assertions
        }' > "$RUN_DIR/eval-context.json"
      cat > "$RUN_DIR/fixture-status.json" <<'EOF'
{
  "status": "pending",
  "items": []
}
EOF
      cat > "$RUN_DIR/timing.json" <<'EOF'
{
  "time_seconds": null,
  "tokens": null
}
EOF
    done
  done
done

jq -n \
  --arg skill "$SKILL" \
  --argjson iteration "$ITERATION" \
  --argjson runs "$RUNS" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg evals_file "evals/$SKILL/evals/evals.json" \
  --arg workspace_root "evals/$SKILL/workspace/iteration-$ITERATION" \
  --argjson eval_ids "$(jq -c '.evals | map(.id)' "$SKILL_EVAL_FILE")" \
  '{
    schema_version: "1.0.0",
    skill_name: $skill,
    iteration: $iteration,
    generated_at: $generated_at,
    evals_file: $evals_file,
    workspace_root: $workspace_root,
    runs_per_eval: $runs,
    configs: ["with_skill", "without_skill"],
    eval_ids: $eval_ids
  }' > "$ITER_DIR/run-plan.json"

echo "$ITER_DIR"
