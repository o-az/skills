#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/validate-benchmark.sh --benchmark <path> [--schema <path>]

Validates benchmark.json against the canonical benchmark schema.
EOF
}

BENCHMARK_PATH=""
SCHEMA_PATH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --benchmark)
      BENCHMARK_PATH="${2:-}"
      shift 2
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

if [ -z "$BENCHMARK_PATH" ]; then
  usage >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ -z "$SCHEMA_PATH" ]; then
  SCHEMA_PATH="$ROOT/evals/harness/benchmark-schema.json"
fi

if [ ! -f "$BENCHMARK_PATH" ]; then
  echo "Benchmark file not found: $BENCHMARK_PATH" >&2
  exit 1
fi

if [ ! -f "$SCHEMA_PATH" ]; then
  echo "Schema file not found: $SCHEMA_PATH" >&2
  exit 1
fi

if command -v uv >/dev/null 2>&1; then
  VALIDATION_OUTPUT_FILE="$(mktemp)"
  if uv run --with check-jsonschema check-jsonschema --schemafile "$SCHEMA_PATH" "$BENCHMARK_PATH" >"$VALIDATION_OUTPUT_FILE" 2>&1; then
    rm -f "$VALIDATION_OUTPUT_FILE"
    echo "$BENCHMARK_PATH"
    exit 0
  fi

  cat "$VALIDATION_OUTPUT_FILE" >&2
  rm -f "$VALIDATION_OUTPUT_FILE"
  echo "Benchmark validation failed with check-jsonschema: $BENCHMARK_PATH" >&2
  exit 1
fi

# Fallback structural validation if uv is unavailable.
if jq -e '
  def is_num_or_null: . == null or (type == "number");
  def is_int_nonneg: (type == "number") and (. >= 0) and (. == floor);
  def is_int_pos: (type == "number") and (. >= 1) and (. == floor);

  def scalar_summary:
    (type == "object") and
    has("mean") and has("stddev") and has("count") and
    (.mean | is_num_or_null) and
    (.stddev | is_num_or_null) and
    (.count | is_int_nonneg);

  def metric_summary:
    (type == "object") and
    has("pass_rate") and has("time_seconds") and has("tokens") and
    (.pass_rate | scalar_summary) and
    (.time_seconds | scalar_summary) and
    (.tokens | scalar_summary);

  def config_summary:
    (type == "object") and
    has("metrics") and has("environment_failures") and has("grading_failures") and has("missing_runs") and
    (.metrics | metric_summary) and
    (.environment_failures | is_int_nonneg) and
    (.grading_failures | is_int_nonneg) and
    (.missing_runs | is_int_nonneg);

  def delta_summary:
    (type == "object") and
    has("pass_rate") and has("time_seconds") and has("tokens") and
    (.pass_rate | is_num_or_null) and
    (.time_seconds | is_num_or_null) and
    (.tokens | is_num_or_null);

  def config_with_delta:
    (type == "object") and
    has("with_skill") and has("without_skill") and has("delta") and
    (.with_skill | config_summary) and
    (.without_skill | config_summary) and
    (.delta | delta_summary);

  def totals_summary:
    (type == "object") and
    has("expected_runs") and has("observed_runs") and has("environment_failures") and has("grading_failures") and has("missing_runs") and
    (.expected_runs | is_int_nonneg) and
    (.observed_runs | is_int_nonneg) and
    (.environment_failures | is_int_nonneg) and
    (.grading_failures | is_int_nonneg) and
    (.missing_runs | is_int_nonneg);

  (type == "object") and
  has("schema_version") and
  has("skill_name") and
  has("iteration") and
  has("generated_at") and
  has("workspace_root") and
  has("eval_ids") and
  has("runs_per_eval") and
  has("configs") and
  has("totals") and
  has("overall") and
  has("evals") and
  (.schema_version | type == "string") and
  (.skill_name | type == "string") and
  (.iteration | is_int_pos) and
  (.generated_at | type == "string") and
  (.workspace_root | type == "string") and
  (.eval_ids | type == "array" and length > 0 and all(.[]; type == "string")) and
  (.runs_per_eval | is_int_pos) and
  (.configs == ["with_skill", "without_skill"]) and
  (.totals | totals_summary) and
  (.overall | config_with_delta) and
  (.evals | type == "object" and (keys | length) > 0 and all(to_entries[]; (.value | config_with_delta)))
' "$BENCHMARK_PATH" >/dev/null; then
  echo "Schema validator unavailable; used fallback structural validation for $BENCHMARK_PATH" >&2
  echo "$BENCHMARK_PATH"
  exit 0
fi

echo "Benchmark validation failed: $BENCHMARK_PATH" >&2
exit 1
