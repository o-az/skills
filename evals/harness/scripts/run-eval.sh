#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/run-eval.sh --skill <skill-name> --iteration <n> --runs <count> [options]

Runs the full harness lifecycle:
1) workspace init + environment snapshot + fixture prep
2) execution command (agent under test)
3) grading command (independent grader)
4) benchmark build + optional schema validation

Options:
  --executor-cmd <command>      Shell command run once per eval/run/config as the executor (cwd: EVAL_WORKSPACE_DIR).
  --grader-cmd <command>        Shell command run once per eval/run/config as the independent grader (cwd: repo root).
  --executor-cmd-file <path>    Read executor command from a file.
  --grader-cmd-file <path>      Read grader command from a file.
  --log-level <level>           Logging mode: quiet (default), progress, stream.
  --prepare-only                Only prepare workspace/fixtures and exit.
  --skip-completed              Skip runs where grading.json already exists.
  --allow-missing-tools         Run anyway even if environment snapshot reports missing required tools.
  --no-validate-schema          Skip benchmark schema validation.

The executor/grader commands receive run context via env vars, including:
  EVAL_RUN_DIR, EVAL_WORKSPACE_DIR, EVAL_FIXTURE_DIR, EVAL_OUTPUT_DIR,
  EVAL_LOG_DIR, EVAL_ARTIFACT_DIR, EVAL_PROMPT_FILE, EVAL_CONTEXT_FILE,
  EVAL_EVAL_SPEC_FILE, EVAL_GRADING_FILE, EVAL_TIMING_FILE, EVAL_ENVIRONMENT_FILE,
  EVAL_REPO_ROOT, EVAL_SKILL_FILE, EVAL_SKILL_NAME, EVAL_ITERATION,
  EVAL_EVAL_ID, EVAL_RUN_ID, EVAL_CONFIG, EVAL_WITH_SKILL, EVAL_EXECUTOR_EXIT_CODE.
EOF
}

SKILL=""
ITERATION=""
RUNS=""
EXECUTOR_CMD=""
GRADER_CMD=""
PREPARE_ONLY=false
SKIP_COMPLETED=false
ALLOW_MISSING_TOOLS=false
VALIDATE_SCHEMA=true
LOG_LEVEL="quiet"

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
    --executor-cmd)
      EXECUTOR_CMD="${2:-}"
      shift 2
      ;;
    --grader-cmd)
      GRADER_CMD="${2:-}"
      shift 2
      ;;
    --executor-cmd-file)
      EXECUTOR_CMD="$(cat "${2:-}")"
      shift 2
      ;;
    --grader-cmd-file)
      GRADER_CMD="$(cat "${2:-}")"
      shift 2
      ;;
    --log-level)
      LOG_LEVEL="${2:-}"
      shift 2
      ;;
    --prepare-only)
      PREPARE_ONLY=true
      shift
      ;;
    --skip-completed)
      SKIP_COMPLETED=true
      shift
      ;;
    --allow-missing-tools)
      ALLOW_MISSING_TOOLS=true
      shift
      ;;
    --no-validate-schema)
      VALIDATE_SCHEMA=false
      shift
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

case "$LOG_LEVEL" in
  quiet|progress|stream)
    ;;
  *)
    echo "Invalid --log-level: $LOG_LEVEL (expected quiet|progress|stream)." >&2
    exit 2
    ;;
esac

if [ "$PREPARE_ONLY" != true ]; then
  if [ -z "$EXECUTOR_CMD" ] || [ -z "$GRADER_CMD" ]; then
    echo "--executor-cmd and --grader-cmd are required unless --prepare-only is set." >&2
    exit 2
  fi
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL_EVAL_FILE="$ROOT/evals/$SKILL/evals/evals.json"

if [ ! -f "$SKILL_EVAL_FILE" ]; then
  echo "Eval spec not found: $SKILL_EVAL_FILE" >&2
  exit 1
fi

copy_dir_contents() {
  local src="$1"
  local dst="$2"

  mkdir -p "$dst"
  if [ -d "$src" ]; then
    (
      cd "$src"
      tar -cf - .
    ) | (
      cd "$dst"
      tar -xf -
    )
  fi
}

reset_run_state() {
  local run_dir="$1"
  rm -rf "$run_dir/outputs" "$run_dir/logs" "$run_dir/artifacts"
  mkdir -p "$run_dir/outputs" "$run_dir/logs" "$run_dir/artifacts"
}

snapshot_workspace() {
  local workspace_dir="$1"
  local output_file="$2"

  if [ ! -d "$workspace_dir" ]; then
    : > "$output_file"
    return
  fi

  (
    cd "$workspace_dir"
    find . -type f -print0 | sort -z | while IFS= read -r -d '' rel; do
      rel="${rel#./}"
      shasum "$rel"
    done
  ) > "$output_file"
}

write_workspace_diff() {
  local before_file="$1"
  local after_file="$2"
  local diff_file="$3"

  if ! diff -u "$before_file" "$after_file" > "$diff_file"; then
    true
  fi
}

log_progress() {
  if [ "$LOG_LEVEL" = "progress" ] || [ "$LOG_LEVEL" = "stream" ]; then
    printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
  fi
}

run_logged_command() {
  local working_dir="$1"
  local command="$2"
  local log_file="$3"
  shift 3
  local -a env_args=("$@")
  local exit_code=0

  if [ "$LOG_LEVEL" = "stream" ]; then
    set +e
    (
      cd "$working_dir"
      env "${env_args[@]}" bash -lc "$command" < /dev/null
    ) 2>&1 | tee "$log_file"
    local -a pipeline_status=("${PIPESTATUS[@]}")
    set -e

    exit_code="${pipeline_status[0]}"
    if [ "${pipeline_status[1]}" -ne 0 ] && [ "$exit_code" -eq 0 ]; then
      exit_code="${pipeline_status[1]}"
    fi
  else
    (
      cd "$working_dir"
      env "${env_args[@]}" bash -lc "$command" < /dev/null
    ) > "$log_file" 2>&1 || exit_code=$?
  fi

  return "$exit_code"
}

normalize_number_or_null() {
  local value="$1"

  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "null"
    return
  fi

  if jq -e -n --arg value "$value" '$value | tonumber' >/dev/null 2>&1; then
    jq -n --arg value "$value" '$value | tonumber'
  else
    echo "null"
  fi
}

resolve_tokens() {
  local run_dir="$1"
  local from_metrics="null"
  local from_timing="null"

  if [ -f "$run_dir/artifacts/executor-metrics.json" ]; then
    from_metrics="$(jq -r '.tokens // .token_count // .total_tokens // null' "$run_dir/artifacts/executor-metrics.json" 2>/dev/null || echo null)"
  fi

  if [ "$from_metrics" != "null" ]; then
    normalize_number_or_null "$from_metrics"
    return
  fi

  if [ -f "$run_dir/timing.json" ]; then
    from_timing="$(jq -r '.tokens // .token_count // .total_tokens // null' "$run_dir/timing.json" 2>/dev/null || echo null)"
  fi

  normalize_number_or_null "$from_timing"
}

write_timing_file() {
  local timing_file="$1"
  local started_at="$2"
  local finished_at="$3"
  local elapsed_seconds="$4"
  local tokens_json="$5"
  local executor_exit_json="$6"

  jq -n \
    --arg started_at "$started_at" \
    --arg finished_at "$finished_at" \
    --argjson elapsed_seconds "$elapsed_seconds" \
    --argjson tokens "$tokens_json" \
    --argjson executor_exit_code "$executor_exit_json" \
    '{
      started_at: $started_at,
      finished_at: $finished_at,
      time_seconds: $elapsed_seconds,
      tokens: $tokens,
      executor_exit_code: $executor_exit_code
    }' > "$timing_file"
}

stage_expected_paths() {
  local skill_name="$1"
  local fixture_dir="$2"
  local workspace_dir="$3"

  case "$skill_name" in
    manipulating-video)
      mkdir -p /tmp/demo
      for filename in input.mov screen-recording.mp4 no-audio-source.mp4; do
        if [ -f "$fixture_dir/$filename" ]; then
          cp -f "$fixture_dir/$filename" "/tmp/demo/$filename"
        fi
      done
      ;;
    upload-image)
      if [ -f "$fixture_dir/diagram.png" ]; then
        cp -f "$fixture_dir/diagram.png" /tmp/diagram.png
      fi
      if [ -f "$fixture_dir/test-animation.gif" ]; then
        cp -f "$fixture_dir/test-animation.gif" /tmp/test-animation.gif
      fi
      ;;
  esac

  mkdir -p "$workspace_dir/fixtures"
  copy_dir_contents "$fixture_dir" "$workspace_dir/fixtures"
}

write_environment_skip_grading() {
  local grading_file="$1"
  local eval_spec_file="$2"
  local summary="$3"
  local missing_tools="$4"

  local assertions_json
  assertions_json="$(jq -c --arg evidence "$summary" '.assertions // [] | map({text: ., result: "not-applicable", evidence: $evidence})' "$eval_spec_file")"

  jq -n \
    --arg summary "$summary" \
    --arg missing_tools "$missing_tools" \
    --argjson assertions "$assertions_json" \
    '{
      overall: {
        score: null,
        pass_rate: null,
        environment_failure: true,
        grading_failure: false,
        summary: $summary
      },
      environment_issues: ["missing tools: " + $missing_tools],
      assertions: $assertions
    }' > "$grading_file"
}

write_grader_failure_grading() {
  local grading_file="$1"
  local eval_spec_file="$2"
  local summary="$3"

  local assertions_json
  assertions_json="$(jq -c --arg evidence "$summary" '.assertions // [] | map({text: ., result: "not-applicable", evidence: $evidence})' "$eval_spec_file")"

  jq -n \
    --arg summary "$summary" \
    --argjson assertions "$assertions_json" \
    '{
      overall: {
        score: null,
        pass_rate: null,
        environment_failure: false,
        grading_failure: true,
        summary: $summary
      },
      assertions: $assertions
    }' > "$grading_file"
}

write_executor_failure_grading() {
  local grading_file="$1"
  local eval_spec_file="$2"
  local summary="$3"
  local environment_failure="$4"

  local result="fail"
  local score_json="0"
  local pass_rate_json="0"

  if [ "$environment_failure" = true ]; then
    result="not-applicable"
    score_json="null"
    pass_rate_json="null"
  fi

  local assertions_json
  assertions_json="$(jq -c --arg result "$result" --arg evidence "$summary" '.assertions // [] | map({text: ., result: $result, evidence: $evidence})' "$eval_spec_file")"

  jq -n \
    --arg summary "$summary" \
    --argjson score "$score_json" \
    --argjson pass_rate "$pass_rate_json" \
    --argjson environment_failure "$environment_failure" \
    --argjson assertions "$assertions_json" \
    '{
      overall: {
        score: $score,
        pass_rate: $pass_rate,
        environment_failure: $environment_failure,
        grading_failure: false,
        summary: $summary
      },
      assertions: $assertions
    }' > "$grading_file"
}

detect_environment_failure_from_executor_log() {
  local log_file="$1"
  local exit_code="$2"

  if [ "$exit_code" -eq 127 ]; then
    return 0
  fi

  if grep -Eqi 'command not found|No such file or directory|not installed|failed to connect|timed out|permission denied' "$log_file"; then
    return 0
  fi

  return 1
}

write_run_summary() {
  local run_summary_file="$1"
  local run_dir="$2"
  local config="$3"
  local executor_exit_code="$4"
  local grader_exit_code="$5"

  local prompt_text
  prompt_text="$(cat "$run_dir/prompt.txt")"

  local with_skill_json=false
  if [ "$config" = "with_skill" ]; then
    with_skill_json=true
  fi

  jq -n \
    --arg prompt "$prompt_text" \
    --arg config "$config" \
    --arg run_dir "$run_dir" \
    --arg prompt_file "$run_dir/prompt.txt" \
    --arg eval_context_file "$run_dir/eval-context.json" \
    --arg fixture_status_file "$run_dir/fixture-status.json" \
    --arg execution_log "$run_dir/logs/execution.log" \
    --arg grading_log "$run_dir/logs/grading.log" \
    --arg outputs_dir "$run_dir/outputs" \
    --arg artifacts_dir "$run_dir/artifacts" \
    --arg timing_file "$run_dir/timing.json" \
    --arg grading_file "$run_dir/grading.json" \
    --argjson with_skill "$with_skill_json" \
    --argjson executor_exit_code "$executor_exit_code" \
    --argjson grader_exit_code "$grader_exit_code" \
    '{
      prompt: $prompt,
      config: $config,
      with_skill: $with_skill,
      run_dir: $run_dir,
      files: {
        prompt: $prompt_file,
        eval_context: $eval_context_file,
        fixture_status: $fixture_status_file,
        execution_log: $execution_log,
        grading_log: $grading_log,
        outputs_dir: $outputs_dir,
        artifacts_dir: $artifacts_dir,
        timing: $timing_file,
        grading: $grading_file
      },
      executor_exit_code: $executor_exit_code,
      grader_exit_code: $grader_exit_code
    }' > "$run_summary_file"
}

ITER_DIR="$(bash "$ROOT/evals/harness/scripts/example-run.sh" --skill "$SKILL" --iteration "$ITERATION" --runs "$RUNS")"
PLAN_FILE="$ITER_DIR/run-plan.json"
ENV_FILE="$ITER_DIR/environment.json"

if [ "$PREPARE_ONLY" = true ]; then
  echo "$ITER_DIR"
  exit 0
fi

if [ ! -f "$PLAN_FILE" ]; then
  echo "Run plan not found: $PLAN_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment snapshot not found: $ENV_FILE" >&2
  exit 1
fi

RUNS_PER_EVAL="$(jq -r '.runs_per_eval' "$PLAN_FILE")"
MISSING_TOOLS_JSON="$(jq -c '[.tools[] | select(.available != true) | .name]' "$ENV_FILE")"
MISSING_TOOLS_COUNT="$(jq -r 'length' <<<"$MISSING_TOOLS_JSON")"
MISSING_TOOLS_CSV="$(jq -r 'join(", ")' <<<"$MISSING_TOOLS_JSON")"

while IFS= read -r eval_id; do
  EVAL_SPEC_FILE_FROM_REPO="$ROOT/evals/$SKILL/evals/evals.json"

  for run_idx in $(seq -w 1 "$RUNS_PER_EVAL"); do
    for config in with_skill without_skill; do
      RUN_DIR="$ITER_DIR/eval-$eval_id/run-$run_idx/$config"
      FIXTURE_DIR="$RUN_DIR/fixtures"
      RUN_LABEL="eval-$eval_id run-$run_idx $config"

      log_progress "Starting $RUN_LABEL"

      if [ "$SKIP_COMPLETED" = true ] && [ -s "$RUN_DIR/grading.json" ]; then
        log_progress "Skipping $RUN_LABEL (existing grading.json)"
        continue
      fi

      reset_run_state "$RUN_DIR"

      OUTPUT_DIR="$RUN_DIR/outputs"
      LOG_DIR="$RUN_DIR/logs"
      ARTIFACT_DIR="$RUN_DIR/artifacts"
      WORKSPACE_DIR="$ARTIFACT_DIR/workspace"

      EXEC_LOG="$LOG_DIR/execution.log"
      GRADE_LOG="$LOG_DIR/grading.log"
      GRADING_FILE="$RUN_DIR/grading.json"
      TIMING_FILE="$RUN_DIR/timing.json"
      CONTEXT_FILE="$RUN_DIR/eval-context.json"
      PROMPT_FILE="$RUN_DIR/prompt.txt"
      FIXTURE_STATUS_FILE="$RUN_DIR/fixture-status.json"
      EVAL_SPEC_FILE="$ARTIFACT_DIR/eval-spec.json"
      RUN_SUMMARY_FILE="$ARTIFACT_DIR/run-summary.json"

      mkdir -p "$WORKSPACE_DIR"
      copy_dir_contents "$FIXTURE_DIR" "$WORKSPACE_DIR"
      stage_expected_paths "$SKILL" "$FIXTURE_DIR" "$WORKSPACE_DIR"

      jq -c --arg id "$eval_id" '.evals[] | select(.id == $id)' "$EVAL_SPEC_FILE_FROM_REPO" > "$EVAL_SPEC_FILE"

      BEFORE_SNAPSHOT_FILE="$ARTIFACT_DIR/workspace-before.sha1"
      AFTER_SNAPSHOT_FILE="$ARTIFACT_DIR/workspace-after.sha1"
      WORKSPACE_DIFF_FILE="$ARTIFACT_DIR/workspace.diff"
      snapshot_workspace "$WORKSPACE_DIR" "$BEFORE_SNAPSHOT_FILE"

      START_EPOCH="$(date +%s)"
      STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

      WITH_SKILL_JSON=false
      if [ "$config" = "with_skill" ]; then
        WITH_SKILL_JSON=true
      fi

      COMMON_ENV=(
        "EVAL_REPO_ROOT=$ROOT"
        "EVAL_SKILL_NAME=$SKILL"
        "EVAL_SKILL_FILE=$ROOT/skills/$SKILL/SKILL.md"
        "EVAL_ITERATION=$ITERATION"
        "EVAL_EVAL_ID=$eval_id"
        "EVAL_RUN_ID=run-$run_idx"
        "EVAL_CONFIG=$config"
        "EVAL_WITH_SKILL=$WITH_SKILL_JSON"
        "EVAL_RUN_DIR=$RUN_DIR"
        "EVAL_WORKSPACE_DIR=$WORKSPACE_DIR"
        "EVAL_FIXTURE_DIR=$FIXTURE_DIR"
        "EVAL_OUTPUT_DIR=$OUTPUT_DIR"
        "EVAL_LOG_DIR=$LOG_DIR"
        "EVAL_ARTIFACT_DIR=$ARTIFACT_DIR"
        "EVAL_PROMPT_FILE=$PROMPT_FILE"
        "EVAL_CONTEXT_FILE=$CONTEXT_FILE"
        "EVAL_FIXTURE_STATUS_FILE=$FIXTURE_STATUS_FILE"
        "EVAL_ENVIRONMENT_FILE=$ENV_FILE"
        "EVAL_EVAL_SPEC_FILE=$EVAL_SPEC_FILE"
        "EVAL_GRADING_TEMPLATE=$ROOT/evals/harness/grading-template.md"
        "EVAL_GRADING_FILE=$GRADING_FILE"
        "EVAL_TIMING_FILE=$TIMING_FILE"
      )

      EXEC_EXIT=0
      GRADE_EXIT=0

      if [ "$MISSING_TOOLS_COUNT" -gt 0 ] && [ "$ALLOW_MISSING_TOOLS" != true ]; then
        SKIP_SUMMARY="Skipped execution due to missing prerequisite tools: $MISSING_TOOLS_CSV"
        printf '%s\n' "$SKIP_SUMMARY" > "$EXEC_LOG"
        log_progress "$RUN_LABEL skipped (missing tools: $MISSING_TOOLS_CSV)"

        FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        write_timing_file "$TIMING_FILE" "$STARTED_AT" "$FINISHED_AT" 0 null null

        snapshot_workspace "$WORKSPACE_DIR" "$AFTER_SNAPSHOT_FILE"
        write_workspace_diff "$BEFORE_SNAPSHOT_FILE" "$AFTER_SNAPSHOT_FILE" "$WORKSPACE_DIFF_FILE"
        write_environment_skip_grading "$GRADING_FILE" "$EVAL_SPEC_FILE" "$SKIP_SUMMARY" "$MISSING_TOOLS_CSV"
        write_run_summary "$RUN_SUMMARY_FILE" "$RUN_DIR" "$config" null null
        continue
      fi

      log_progress "$RUN_LABEL executor start"
      if ! run_logged_command "$WORKSPACE_DIR" "$EXECUTOR_CMD" "$EXEC_LOG" "${COMMON_ENV[@]}"; then
        EXEC_EXIT=$?
      fi
      log_progress "$RUN_LABEL executor exit=$EXEC_EXIT"

      END_EPOCH="$(date +%s)"
      FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      ELAPSED_SECONDS=$((END_EPOCH - START_EPOCH))
      TOKENS_JSON="$(resolve_tokens "$RUN_DIR")"
      write_timing_file "$TIMING_FILE" "$STARTED_AT" "$FINISHED_AT" "$ELAPSED_SECONDS" "$TOKENS_JSON" "$EXEC_EXIT"

      snapshot_workspace "$WORKSPACE_DIR" "$AFTER_SNAPSHOT_FILE"
      write_workspace_diff "$BEFORE_SNAPSHOT_FILE" "$AFTER_SNAPSHOT_FILE" "$WORKSPACE_DIFF_FILE"

      log_progress "$RUN_LABEL grader start"
      if ! run_logged_command "$ROOT" "$GRADER_CMD" "$GRADE_LOG" "${COMMON_ENV[@]}" "EVAL_EXECUTOR_EXIT_CODE=$EXEC_EXIT"; then
        GRADE_EXIT=$?
      fi
      log_progress "$RUN_LABEL grader exit=$GRADE_EXIT"

      if [ ! -f "$GRADING_FILE" ]; then
        if [ "$GRADE_EXIT" -ne 0 ]; then
          write_grader_failure_grading "$GRADING_FILE" "$EVAL_SPEC_FILE" "Independent grader command failed with exit code $GRADE_EXIT"
        elif [ "$EXEC_EXIT" -ne 0 ]; then
          if detect_environment_failure_from_executor_log "$EXEC_LOG" "$EXEC_EXIT"; then
            write_executor_failure_grading "$GRADING_FILE" "$EVAL_SPEC_FILE" "Executor failed due to environment/runtime issue (exit code $EXEC_EXIT)" true
          else
            write_executor_failure_grading "$GRADING_FILE" "$EVAL_SPEC_FILE" "Executor command failed with exit code $EXEC_EXIT" false
          fi
        else
          write_grader_failure_grading "$GRADING_FILE" "$EVAL_SPEC_FILE" "Independent grader did not produce grading.json"
        fi
      fi

      write_run_summary "$RUN_SUMMARY_FILE" "$RUN_DIR" "$config" "$EXEC_EXIT" "$GRADE_EXIT"
      log_progress "$RUN_LABEL complete"
    done
  done
done < <(jq -r '.eval_ids[]' "$PLAN_FILE")

BUILD_ARGS=(--skill "$SKILL" --iteration "$ITERATION")
if [ "$VALIDATE_SCHEMA" = true ]; then
  BUILD_ARGS+=(--validate-schema)
fi

BENCHMARK_PATH="$(bash "$ROOT/evals/harness/scripts/build-benchmark.sh" "${BUILD_ARGS[@]}")"
echo "$BENCHMARK_PATH"
