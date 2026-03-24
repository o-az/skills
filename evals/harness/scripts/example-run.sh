#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/example-run.sh --skill <skill-name> --iteration <n> --runs <count>

Bootstraps workspace, writes environment snapshot, and prepares fixtures for each run.
This script does not execute agent runs.
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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

ITER_DIR="$(bash "$ROOT/evals/harness/scripts/init-workspace.sh" --skill "$SKILL" --iteration "$ITERATION" --runs "$RUNS")"
bash "$ROOT/evals/harness/scripts/check-environment.sh" --skill "$SKILL" --output "$ITER_DIR/environment.json" >/dev/null

while IFS= read -r eval_id; do
  for run_idx in $(seq -w 1 "$RUNS"); do
    for config in with_skill without_skill; do
      RUN_DIR="$ITER_DIR/eval-$eval_id/run-$run_idx/$config"
      FIXTURE_DIR="$RUN_DIR/fixtures"

      bash "$ROOT/evals/harness/scripts/prepare-fixtures.sh" \
        --skill "$SKILL" \
        --eval-id "$eval_id" \
        --output-dir "$FIXTURE_DIR" >/dev/null

      cp "$FIXTURE_DIR/fixture-status.json" "$RUN_DIR/fixture-status.json"
      rm -f "$FIXTURE_DIR/fixture-status.json"

      prompt="$(jq -r --arg id "$eval_id" '.evals[] | select(.id == $id) | .prompt' "$ROOT/evals/$SKILL/evals/evals.json")"
      printf '%s\n' "$prompt" > "$RUN_DIR/prompt.txt"
    done
  done
done < <(jq -r '.evals[].id' "$ROOT/evals/$SKILL/evals/evals.json")

echo "$ITER_DIR"
