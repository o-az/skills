#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash evals/harness/scripts/normalize-legacy-benchmark.sh <legacy-benchmark.json> [output.json]

Extracts stable summary fields from legacy benchmark schema variants.
EOF
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  usage >&2
  exit 2
fi

INPUT="$1"
OUTPUT="${2:-}"

if [ ! -f "$INPUT" ]; then
  echo "File not found: $INPUT" >&2
  exit 1
fi

get_pass_mean='def rate:
  if . == null then null
  elif (type == "number") then .
  elif (type == "object") then (.mean // null)
  else null
  end;
(
  .overall.with_skill_mean //
  (.overall.with_skill.pass_rate? | rate) //
  (.summary.with_skill.pass_rate? | rate) //
  (.run_summary.with_skill.pass_rate? | rate) //
  (.with_skill.pass_rate? | rate) //
  null
)'

get_without_pass_mean='def rate:
  if . == null then null
  elif (type == "number") then .
  elif (type == "object") then (.mean // null)
  else null
  end;
(
  .overall.without_skill_mean //
  (.overall.without_skill.pass_rate? | rate) //
  (.summary.without_skill.pass_rate? | rate) //
  (.run_summary.without_skill.pass_rate? | rate) //
  (.without_skill.pass_rate? | rate) //
  null
)'

get_delta='def delta_rate:
  if . == null then null
  elif (type == "number") then .
  elif (type == "object") then (.pass_rate // null)
  else null
  end;
(
  (.overall.delta? | delta_rate) //
  (.summary.delta? | delta_rate) //
  (.run_summary.delta? | delta_rate) //
  null
)'

normalized="$(jq -n \
  --arg source "$INPUT" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson with_mean "$(jq -r "$get_pass_mean" "$INPUT")" \
  --argjson without_mean "$(jq -r "$get_without_pass_mean" "$INPUT")" \
  --argjson delta "$(jq -r "$get_delta" "$INPUT")" \
  '{
    schema_version: "1.0.0",
    generated_at: $generated_at,
    source_file: $source,
    with_skill_mean_pass_rate: $with_mean,
    without_skill_mean_pass_rate: $without_mean,
    delta_pass_rate: (
      if $delta != null then $delta
      elif ($with_mean != null and $without_mean != null) then ($with_mean - $without_mean)
      else null
      end
    )
  }')"

if [ -n "$OUTPUT" ]; then
  mkdir -p "$(dirname "$OUTPUT")"
  printf '%s\n' "$normalized" > "$OUTPUT"
  echo "$OUTPUT"
else
  printf '%s\n' "$normalized"
fi
