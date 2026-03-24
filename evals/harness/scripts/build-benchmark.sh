#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/build-benchmark.sh --skill <skill-name> --iteration <n> [--validate-schema] [--schema <path>]

Aggregates run-level grading/timing files into canonical benchmark.json.
EOF
}

SKILL=""
ITERATION=""
VALIDATE_SCHEMA=false
SCHEMA_PATH=""

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
    --validate-schema)
      VALIDATE_SCHEMA=true
      shift
      ;;
    --schema)
      SCHEMA_PATH="${2:-}"
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

if [ -z "$SKILL" ] || [ -z "$ITERATION" ]; then
  usage >&2
  exit 2
fi

if ! [[ "$ITERATION" =~ ^[0-9]+$ ]] || [ "$ITERATION" -lt 1 ]; then
  echo "--iteration must be a positive integer." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ITER_DIR="$ROOT/evals/$SKILL/workspace/iteration-$ITERATION"
PLAN_FILE="$ITER_DIR/run-plan.json"
OUTPUT_FILE="$ITER_DIR/benchmark.json"

if [ ! -f "$PLAN_FILE" ]; then
  echo "Missing run plan: $PLAN_FILE" >&2
  exit 1
fi

EVAL_IDS_JSON="$(jq -c '.eval_ids' "$PLAN_FILE")"
RUNS_PER_EVAL="$(jq -r '.runs_per_eval' "$PLAN_FILE")"
RUNS_PER_EVAL_NUM=$((10#$RUNS_PER_EVAL))

to_number_or_null() {
  local value="$1"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "null"
  else
    echo "$value"
  fi
}

subtract_or_null() {
  local a="$1"
  local b="$2"
  if [ "$a" = "null" ] || [ "$b" = "null" ]; then
    echo "null"
    return
  fi
  jq -n --argjson a "$a" --argjson b "$b" '$a - $b'
}

clamp_missing() {
  local expected="$1"
  local observed="$2"
  local value=$((expected - observed))
  if [ "$value" -lt 0 ]; then
    value=0
  fi
  echo "$value"
}

extract_run_index_from_prompt() {
  local prompt_file="$1"
  local run_dir
  run_dir="$(basename "$(dirname "$(dirname "$prompt_file")")")"

  if [[ ! "$run_dir" =~ ^run-[0-9]+$ ]]; then
    echo ""
    return
  fi

  echo "${run_dir#run-}"
}

calc_metrics_for_glob() {
  local pattern="$1"
  local file
  local scores='[]'
  local times='[]'
  local tokens='[]'
  local env_failures=0
  local grading_failures=0
  local observed=0

  while IFS= read -r file; do
    local run_idx
    run_idx="$(extract_run_index_from_prompt "$file")"
    if [ -z "$run_idx" ]; then
      continue
    fi

    local run_idx_num=$((10#$run_idx))
    if [ "$run_idx_num" -gt "$RUNS_PER_EVAL_NUM" ]; then
      continue
    fi

    observed=$((observed + 1))
    local run_dir
    run_dir="$(dirname "$file")"
    local grading_file="$run_dir/grading.json"
    local timing_file="$run_dir/timing.json"

    local score="null"
    local environment_failure=false
    local grading_failure=false

    if [ -f "$grading_file" ]; then
      score="$(jq -r '
        (
          .overall.score //
          .overall.pass_rate //
          .score //
          .pass_rate
        ) //
        (
          (if (.assertions // null) == null then null else
            (
              ((.assertions | map(select((.result // .status // "") | ascii_downcase == "pass")) | length) as $p |
               (.assertions | map(select((.result // .status // "") | test("^(pass|fail)$"; "i"))) | length) as $t |
               if $t > 0 then ($p / $t) else null end)
            )
          end)
        )' "$grading_file")"

      environment_failure="$(jq -r '
        (
          .overall.environment_failure //
          .environment_failure //
          ((.environment_issues // []) | length > 0)
        )' "$grading_file")"

      grading_failure="$(jq -r '
        (
          .overall.grading_failure //
          .grading_failure //
          false
        )' "$grading_file")"
    else
      grading_failures=$((grading_failures + 1))
    fi

    if [ "$environment_failure" = "true" ]; then
      env_failures=$((env_failures + 1))
    fi

    if [ "$grading_failure" = "true" ]; then
      grading_failures=$((grading_failures + 1))
    fi

    score="$(to_number_or_null "$score")"
    if [ "$score" != "null" ]; then
      scores="$(jq -c --argjson value "$score" '. + [$value]' <<<"$scores")"
    fi

    if [ -f "$timing_file" ]; then
      local time_value token_value
      time_value="$(jq -r '.time_seconds // .duration_seconds // .elapsed_seconds // null' "$timing_file")"
      token_value="$(jq -r '.tokens // .token_count // .total_tokens // null' "$timing_file")"

      time_value="$(to_number_or_null "$time_value")"
      token_value="$(to_number_or_null "$token_value")"

      if [ "$time_value" != "null" ]; then
        times="$(jq -c --argjson value "$time_value" '. + [$value]' <<<"$times")"
      fi
      if [ "$token_value" != "null" ]; then
        tokens="$(jq -c --argjson value "$token_value" '. + [$value]' <<<"$tokens")"
      fi
    fi
  done < <(find "$ITER_DIR" -path "$pattern" -name prompt.txt | sort)

  jq -n \
    --argjson scores "$scores" \
    --argjson times "$times" \
    --argjson tokens "$tokens" \
    --argjson observed "$observed" \
    --argjson environment_failures "$env_failures" \
    --argjson grading_failures "$grading_failures" \
    '{
      metrics: {
        pass_rate: {
          mean: (if ($scores | length) > 0 then (($scores | add) / ($scores | length)) else null end),
          stddev: (if ($scores | length) > 1 then ((($scores | map((. - ((($scores | add) / ($scores | length)))) | . * .) | add) / ($scores | length)) | sqrt) else 0 end),
          count: ($scores | length)
        },
        time_seconds: {
          mean: (if ($times | length) > 0 then (($times | add) / ($times | length)) else null end),
          stddev: (if ($times | length) > 1 then ((($times | map((. - ((($times | add) / ($times | length)))) | . * .) | add) / ($times | length)) | sqrt) else 0 end),
          count: ($times | length)
        },
        tokens: {
          mean: (if ($tokens | length) > 0 then (($tokens | add) / ($tokens | length)) else null end),
          stddev: (if ($tokens | length) > 1 then ((($tokens | map((. - ((($tokens | add) / ($tokens | length)))) | . * .) | add) / ($tokens | length)) | sqrt) else 0 end),
          count: ($tokens | length)
        }
      },
      environment_failures: $environment_failures,
      grading_failures: $grading_failures,
      observed_runs: $observed
    }'
}

evals_json='{}'

while IFS= read -r eval_id; do
  with_json="$(calc_metrics_for_glob "*/eval-$eval_id/*/with_skill/*")"
  without_json="$(calc_metrics_for_glob "*/eval-$eval_id/*/without_skill/*")"

  with_mean="$(jq -r '.metrics.pass_rate.mean // "null"' <<<"$with_json")"
  without_mean="$(jq -r '.metrics.pass_rate.mean // "null"' <<<"$without_json")"

  with_time_mean="$(jq -r '.metrics.time_seconds.mean // "null"' <<<"$with_json")"
  without_time_mean="$(jq -r '.metrics.time_seconds.mean // "null"' <<<"$without_json")"

  with_tokens_mean="$(jq -r '.metrics.tokens.mean // "null"' <<<"$with_json")"
  without_tokens_mean="$(jq -r '.metrics.tokens.mean // "null"' <<<"$without_json")"

  delta_pass="null"
  delta_pass="$(subtract_or_null "$with_mean" "$without_mean")"

  delta_time="null"
  delta_time="$(subtract_or_null "$with_time_mean" "$without_time_mean")"

  delta_tokens="null"
  delta_tokens="$(subtract_or_null "$with_tokens_mean" "$without_tokens_mean")"

  with_missing="$(clamp_missing "$RUNS_PER_EVAL" "$(jq -r '.observed_runs' <<<"$with_json")")"
  without_missing="$(clamp_missing "$RUNS_PER_EVAL" "$(jq -r '.observed_runs' <<<"$without_json")")"

  eval_entry="$(jq -n \
    --argjson with "$with_json" \
    --argjson without "$without_json" \
    --argjson delta_pass "$delta_pass" \
    --argjson delta_time "$delta_time" \
    --argjson delta_tokens "$delta_tokens" \
    --argjson with_missing "$with_missing" \
    --argjson without_missing "$without_missing" \
    '{
      with_skill: {
        metrics: $with.metrics,
        environment_failures: $with.environment_failures,
        grading_failures: $with.grading_failures,
        missing_runs: $with_missing
      },
      without_skill: {
        metrics: $without.metrics,
        environment_failures: $without.environment_failures,
        grading_failures: $without.grading_failures,
        missing_runs: $without_missing
      },
      delta: {
        pass_rate: $delta_pass,
        time_seconds: $delta_time,
        tokens: $delta_tokens
      }
    }')"

  evals_json="$(jq -c --arg id "$eval_id" --argjson entry "$eval_entry" '. + {($id): $entry}' <<<"$evals_json")"
done < <(jq -r '.eval_ids[]' "$PLAN_FILE")

overall_with="$(calc_metrics_for_glob "*/with_skill/*")"
overall_without="$(calc_metrics_for_glob "*/without_skill/*")"

overall_delta_pass="$(subtract_or_null "$(jq -r '.metrics.pass_rate.mean // "null"' <<<"$overall_with")" "$(jq -r '.metrics.pass_rate.mean // "null"' <<<"$overall_without")")"
overall_delta_time="$(subtract_or_null "$(jq -r '.metrics.time_seconds.mean // "null"' <<<"$overall_with")" "$(jq -r '.metrics.time_seconds.mean // "null"' <<<"$overall_without")")"
overall_delta_tokens="$(subtract_or_null "$(jq -r '.metrics.tokens.mean // "null"' <<<"$overall_with")" "$(jq -r '.metrics.tokens.mean // "null"' <<<"$overall_without")")"

EXPECTED_TOTAL="$(jq -n --argjson eval_count "$(jq 'length' <<<"$EVAL_IDS_JSON")" --argjson runs "$RUNS_PER_EVAL" '$eval_count * $runs * 2')"
WITH_OBSERVED="$(jq -r '.observed_runs' <<<"$overall_with")"
WITHOUT_OBSERVED="$(jq -r '.observed_runs' <<<"$overall_without")"
OBSERVED_TOTAL=$((WITH_OBSERVED + WITHOUT_OBSERVED))

EXPECTED_PER_CONFIG=$(( $(jq 'length' <<<"$EVAL_IDS_JSON") * RUNS_PER_EVAL ))
WITH_MISSING="$(clamp_missing "$EXPECTED_PER_CONFIG" "$WITH_OBSERVED")"
WITHOUT_MISSING="$(clamp_missing "$EXPECTED_PER_CONFIG" "$WITHOUT_OBSERVED")"
TOTAL_MISSING=$((WITH_MISSING + WITHOUT_MISSING))

TOTAL_ENV=$(( $(jq -r '.environment_failures' <<<"$overall_with") + $(jq -r '.environment_failures' <<<"$overall_without") ))
TOTAL_GRADING=$(( $(jq -r '.grading_failures' <<<"$overall_with") + $(jq -r '.grading_failures' <<<"$overall_without") ))

jq -n \
  --arg schema_version "1.0.0" \
  --arg skill_name "$SKILL" \
  --argjson iteration "$ITERATION" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg workspace_root "evals/$SKILL/workspace/iteration-$ITERATION" \
  --argjson eval_ids "$EVAL_IDS_JSON" \
  --argjson runs_per_eval "$RUNS_PER_EVAL" \
  --argjson evals "$evals_json" \
  --argjson expected_total "$EXPECTED_TOTAL" \
  --argjson observed_total "$OBSERVED_TOTAL" \
  --argjson total_env "$TOTAL_ENV" \
  --argjson total_grading "$TOTAL_GRADING" \
  --argjson total_missing "$TOTAL_MISSING" \
  --argjson overall_with "$overall_with" \
  --argjson overall_without "$overall_without" \
  --argjson overall_delta_pass "$overall_delta_pass" \
  --argjson overall_delta_time "$overall_delta_time" \
  --argjson overall_delta_tokens "$overall_delta_tokens" \
  --argjson with_missing "$WITH_MISSING" \
  --argjson without_missing "$WITHOUT_MISSING" \
  '{
    schema_version: $schema_version,
    skill_name: $skill_name,
    iteration: $iteration,
    generated_at: $generated_at,
    workspace_root: $workspace_root,
    eval_ids: $eval_ids,
    runs_per_eval: $runs_per_eval,
    configs: ["with_skill", "without_skill"],
    totals: {
      expected_runs: $expected_total,
      observed_runs: $observed_total,
      environment_failures: $total_env,
      grading_failures: $total_grading,
      missing_runs: $total_missing
    },
    overall: {
      with_skill: {
        metrics: $overall_with.metrics,
        environment_failures: $overall_with.environment_failures,
        grading_failures: $overall_with.grading_failures,
        missing_runs: $with_missing
      },
      without_skill: {
        metrics: $overall_without.metrics,
        environment_failures: $overall_without.environment_failures,
        grading_failures: $overall_without.grading_failures,
        missing_runs: $without_missing
      },
      delta: {
        pass_rate: $overall_delta_pass,
        time_seconds: $overall_delta_time,
        tokens: $overall_delta_tokens
      }
    },
    evals: $evals
  }' > "$OUTPUT_FILE"

if [ "$VALIDATE_SCHEMA" = true ]; then
  VALIDATE_ARGS=(--benchmark "$OUTPUT_FILE")
  if [ -n "$SCHEMA_PATH" ]; then
    VALIDATE_ARGS+=(--schema "$SCHEMA_PATH")
  fi
  bash "$ROOT/evals/harness/scripts/validate-benchmark.sh" "${VALIDATE_ARGS[@]}" >/dev/null
fi

echo "$OUTPUT_FILE"
