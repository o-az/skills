# Evals

This directory holds author-only eval material for the skills in this repo.

Each skill has:

- `evals/<skill-name>/evals/evals.json` — the authored eval spec
- `evals/<skill-name>/workspace/iteration-<n>/...` — generated eval runs and benchmarks

Do not put eval specs back inside `skills/<skill-name>/`. Installed skills should stay lean.

## Harness First

Before running a new iteration, bootstrap the canonical workspace using the harness scripts:

```bash
bash evals/harness/scripts/example-run.sh --skill <SKILL_NAME> --iteration <N> --runs <RUNS>
```

To run the full lifecycle (prepare + execute + independent grade + benchmark + schema validation):

```bash
bash evals/harness/scripts/run-eval.sh \
  --skill <SKILL_NAME> \
  --iteration <N> \
  --runs <RUNS> \
  --log-level progress \
  --executor-cmd '<EXECUTOR_COMMAND>' \
  --grader-cmd '<GRADER_COMMAND>'
```

Use `--log-level quiet|progress|stream` depending on how much live terminal output you want.

Recommended runtime adapters:

```bash
--executor-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-executor.sh" --runtime amp --mode smart'
--grader-cmd 'bash "$EVAL_REPO_ROOT/evals/harness/scripts/agent-grader.sh" --runtime codex'
```

This creates:

1. `run-plan.json` with fixed eval IDs/configs/runs.
2. `environment.json` with tool/env availability.
3. Per-run `fixtures/`, `logs/`, `outputs/`, `artifacts/`, `prompt.txt`, and `fixture-status.json`.

After grading completes, produce a canonical benchmark schema output:

```bash
bash evals/harness/scripts/build-benchmark.sh --skill <SKILL_NAME> --iteration <N>
```

Use [`evals/harness/benchmark-schema.json`](./harness/benchmark-schema.json) as the source-of-truth benchmark format.

If you need to compare old iteration benchmark files with schema drift, normalize them first:

```bash
bash evals/harness/scripts/normalize-legacy-benchmark.sh <legacy-benchmark.json>
```

## Repeated Eval Prompt

Use this prompt for an agent, replacing `<SKILL_NAME>` and `<RUNS>`:

```text
Evaluate the skill at `skills/<SKILL_NAME>` using the eval spec at `evals/<SKILL_NAME>/evals/evals.json`.

Requirements:
- Do not change `SKILL.md`, the eval spec, grading criteria, or the skill implementation.
- Create or reuse `evals/<SKILL_NAME>/workspace/iteration-<N>/`.
- For each eval case, run it `<RUNS>` times.
- Save results under this layout:

  `evals/<SKILL_NAME>/workspace/iteration-<N>/eval-<id>/run-<NN>/with_skill/`
  `evals/<SKILL_NAME>/workspace/iteration-<N>/eval-<id>/run-<NN>/without_skill/`

For every run/config:
- create `outputs/`
- save produced artifacts in `outputs/`
- save `timing.json`
- save `grading.json`

Benchmarking:
- After all runs finish, write `evals/<SKILL_NAME>/workspace/iteration-<N>/benchmark.json`
- Aggregate:
  - mean pass rate
  - stddev pass rate
  - mean time_seconds
  - stddev time_seconds
  - mean tokens
  - stddev tokens
  - delta between `with_skill` and `without_skill`

Rules:
- Start each run from a clean context.
- Keep prompts and assertions fixed across runs.
- Be strict when grading.
- Require concrete evidence in every PASS/FAIL.
- If a run fails due to environment or tool issues, record that clearly in `grading.json` instead of hiding it.
- Do not delete or overwrite `iteration-1`.
- Do not commit anything.

When done:
- print a short summary with:
  - where the benchmark file is
  - with_skill mean pass rate
  - without_skill mean pass rate
  - delta
  - any flaky evals or repeated failures
```

## Suggested Run Counts

- `screencast`: `10`
- `terminal-recording`: `8`
- `upload-image`: `8`
- `manipulating-video`: `5`
- `template`: `5`

## What To Tell Agents

Use one agent per skill.

Tell each agent:

```text
Take a look at `evals/<SKILL_NAME>/README.md` if present, otherwise use `evals/README.md`. Then evaluate the skill using `evals/<SKILL_NAME>/evals/evals.json` and save repeated runs under `evals/<SKILL_NAME>/workspace/iteration-<N>/`.
```

Or shorter:

```text
Evaluate `skills/<SKILL_NAME>` using `evals/<SKILL_NAME>/evals/evals.json`. Follow the repeated-run instructions in `evals/README.md`. Save everything under `evals/<SKILL_NAME>/workspace/iteration-<N>/`.
```

## Benchmark History

### Iteration 4 — Amp

<sub>Opus 4.6</sub>

| Skill                | Runs | With Skill | Baseline |   Delta |
| -------------------- | ---: | ---------: | -------: | ------: |
| `manipulating-video` |   30 |     1.0000 |   0.6611 | +0.3389 |
| `screencast`         |   60 |     0.9695 |   0.1305 | +0.8390 |
| `template`           |   20 |     1.0000 |   0.4250 | +0.5750 |
| `terminal-recording` |   32 |     1.0000 |   0.5938 | +0.4062 |
| `upload-image`       |   48 |     1.0000 |   0.4305 | +0.5695 |

### Iteration 3 — Codex

<sub>gpt-5.4 medium fast</sub>

Many runs hit `codex exec --ephemeral` sub-session timeouts, depressing with_skill scores.

| Skill                | Runs | With Skill | Baseline |   Delta |
| -------------------- | ---: | ---------: | -------: | ------: |
| `manipulating-video` |   30 |     0.6389 |   0.5778 | +0.0611 |
| `screencast`         |   60 |     0.3667 |   0.0000 | +0.3667 |
| `template`           |   20 |     0.8250 |   0.2667 | +0.5583 |
| `terminal-recording` |   32 |     0.6667 |   0.5677 | +0.0990 |
| `upload-image`       |   48 |     0.2639 |   0.0417 | +0.2222 |

### Iteration 2 — pi

<sub>claude-opus-4-6</sub>

| Skill                | Runs | With Skill | Baseline |   Delta |
| -------------------- | ---: | ---------: | -------: | ------: |
| `manipulating-video` |   30 |     1.0000 |   0.6450 | +0.3550 |
| `screencast`         |   60 |     0.9700 |   0.1300 | +0.8400 |
| `template`           |   20 |     1.0000 |   0.3830 | +0.6170 |
| `terminal-recording` |   32 |     1.0000 |   0.4060 | +0.5940 |
| `upload-image`       |   48 |     1.0000 |   0.5000 | +0.5000 |

### Iteration 1 — Codex (calibration pass, not a benchmark)

Codex authored the eval specs, improved the skills, then ran single-run evals and graded its own work — all in one session with full context. Treat as a bootstrap/calibration pass, not a real benchmark.

| Skill                | With Skill | Baseline |   Delta |
| -------------------- | ---------: | -------: | ------: |
| `manipulating-video` |     1.0000 |   0.3611 | +0.6389 |
| `screencast`         |     1.0000 |   0.5000 | +0.5000 |
| `template`           |     1.0000 |   0.0000 | +1.0000 |
| `terminal-recording` |     1.0000 |   0.4167 | +0.5833 |
| `upload-image`       |     1.0000 |   0.2222 | +0.7778 |
