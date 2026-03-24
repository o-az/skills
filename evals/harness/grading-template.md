# Independent Grading Prompt Template

You are grading a completed skill eval run.

## Inputs

1. Eval spec entry (`id`, `prompt`, `assertions`).
2. Run configuration (`with_skill` or `without_skill`).
3. Captured evidence:
   - `prompt.txt`
   - `eval-context.json`
   - `fixture-status.json`
   - execution logs from `logs/`
   - generated files in `outputs/` and `artifacts/`
   - `timing.json`

## Rules

1. Grade only from evidence in the run directory.
2. Mark assertion result as `pass`, `fail`, or `not-applicable`.
3. For each assertion, include a short evidence quote or path reference.
4. If tool/runtime issues block execution, set `environment_failure` to `true` and explain.
5. Do not infer success from intent; require concrete output evidence.

## Output format (`grading.json`)

```json
{
  "overall": {
    "score": 0.75,
    "pass_rate": 0.75,
    "environment_failure": false,
    "summary": "One assertion failed: viewer URL omitted from final response."
  },
  "assertions": [
    {
      "text": "The relay is started with bash scripts/start-relay.sh",
      "result": "pass",
      "evidence": "logs/execution.log contains: bash scripts/start-relay.sh"
    }
  ]
}
```
