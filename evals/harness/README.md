# Eval Harness

This harness defines a repeatable workspace and output contract for future skill eval iterations.

## Goals

1. Keep execution and grading separate.
2. Make each run reproducible with fixture-backed inputs.
3. Emit one stable `benchmark.json` schema across all iterations.
4. Preserve enough evidence to re-grade old runs without re-executing them.

## Canonical Workspace Layout

```text
evals/<skill>/workspace/iteration-<n>/
  run-plan.json
  environment.json
  benchmark.json
  eval-<id>/
    run-<NN>/
      with_skill/
        prompt.txt
        eval-context.json
        fixture-status.json
        fixtures/
        outputs/
        logs/
        artifacts/
        timing.json
        grading.json
      without_skill/
        ... same layout as with_skill ...
```

## Phase Model

1. **Workspace init**: create the iteration directory, run plan, and per-run directories.
2. **Environment snapshot**: record tool availability and key environment flags into `environment.json`.
3. **Fixture prep**: create concrete test inputs per eval run under `fixtures/`.
4. **Execution**: run the agent under test and store logs/artifacts in the run directory.
5. **Independent grading**: write `grading.json` from a separate grader context.
6. **Benchmark aggregation**: compute one normalized `benchmark.json` that matches `benchmark-schema.json`.

## Scripts

1. `bash evals/harness/scripts/init-workspace.sh --skill <skill> --iteration <n> --runs <count>` creates the workspace layout and fixture directories.
2. `bash evals/harness/scripts/check-environment.sh --skill <skill> --output <path>` captures prereq availability.
3. `bash evals/harness/scripts/prepare-fixtures.sh --skill <skill> --eval-id <id> --output-dir <path>` materializes fixture files.
4. `bash evals/harness/scripts/build-benchmark.sh --skill <skill> --iteration <n>` aggregates run grading/timing into canonical benchmark output.
5. `bash evals/harness/scripts/normalize-legacy-benchmark.sh <legacy-benchmark.json> [output.json]` extracts stable summary fields from old benchmark variants.
6. `bash evals/harness/scripts/run-eval.sh --skill <skill> --iteration <n> --runs <count> --executor-cmd '<cmd>' --grader-cmd '<cmd>' [--log-level quiet|progress|stream]` orchestrates all harness phases end-to-end.
7. `bash evals/harness/scripts/validate-benchmark.sh --benchmark <path>` validates output against `benchmark-schema.json`.
8. `bash evals/harness/scripts/stub-executor.sh` and `bash evals/harness/scripts/stub-grader.sh` are smoke-test helpers for validating harness plumbing.
9. `bash evals/harness/scripts/agent-executor.sh --runtime <amp|codex|pi>` runs an eval prompt with a concrete runtime and normalizes artifacts.
10. `bash evals/harness/scripts/agent-grader.sh --runtime <amp|codex|pi>` runs independent grading with a concrete runtime and writes `grading.json`.

## Full Iteration Command

Run a complete iteration with strict execution/grading separation:

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <skill> \
  --iteration <n> \
  --runs <count> \
  --executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/stub-executor.sh"' \
  --grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/stub-grader.sh"'
```

Replace stub commands with real agent executor and independent grader commands. The executor command runs from the per-run workspace, so reference harness scripts with `$EVAL_REPO_ROOT/...`.

`run-eval.sh` log modes:

1. `quiet` (default): no per-run status in terminal; logs are still written to `logs/execution.log` and `logs/grading.log`.
2. `progress`: prints run/executor/grader status lines while continuing to write log files.
3. `stream`: prints live executor/grader output to terminal and log files (via tee), plus progress lines.

Example with live streaming:

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <skill> \
  --iteration <n> \
  --runs <count> \
  --log-level stream \
  --executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-executor.sh" --runtime amp --mode smart' \
  --grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-grader.sh" --runtime codex'
```

## Runtime Adapter Examples

Amp executor + Codex grader:

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <skill> \
  --iteration <n> \
  --runs <count> \
  --executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-executor.sh" --runtime amp --mode smart' \
  --grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-grader.sh" --runtime codex'
```

Codex executor + Amp grader:

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <skill> \
  --iteration <n> \
  --runs <count> \
  --executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-executor.sh" --runtime codex' \
  --grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-grader.sh" --runtime amp --mode smart'
```

Pi executor + Pi grader:

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <skill> \
  --iteration <n> \
  --runs <count> \
  --executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-executor.sh" --runtime pi' \
  --grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-grader.sh" --runtime pi'
```

## Grading Contract

`grading.json` is expected to include at least one of the following score fields:

1. `overall.score`
2. `overall.pass_rate`
3. `score`
4. `pass_rate`

If none exist, the benchmark builder derives score from assertion entries where `result`/`status` is `pass`.

## Benchmark Schema

The canonical benchmark format is locked in [`benchmark-schema.json`](./benchmark-schema.json). All future iteration outputs should validate against this schema.
