# Evals

This directory holds author-only eval material for the skills in this repo.

Each skill has:

- `evals/<skill-name>/evals/evals.json` — the authored eval spec
- `evals/<skill-name>/workspace/iteration-<n>/...` — generated eval runs and benchmarks

Do not put eval specs back inside `skills/<skill-name>/`. Installed skills should stay lean.

## Repeated Eval Prompt

Use this prompt for an agent, replacing `<SKILL_NAME>` and `<RUNS>`:

```text
Evaluate the skill at `skills/<SKILL_NAME>` using the eval spec at `evals/<SKILL_NAME>/evals/evals.json`.

Requirements:
- Do not change `SKILL.md`, the eval spec, grading criteria, or the skill implementation.
- Create or reuse `evals/<SKILL_NAME>/workspace/iteration-2/`.
- For each eval case, run it `<RUNS>` times.
- Save results under this layout:

  `evals/<SKILL_NAME>/workspace/iteration-2/eval-<id>/run-<NN>/with_skill/`
  `evals/<SKILL_NAME>/workspace/iteration-2/eval-<id>/run-<NN>/without_skill/`

For every run/config:
- create `outputs/`
- save produced artifacts in `outputs/`
- save `timing.json`
- save `grading.json`

Benchmarking:
- After all runs finish, write `evals/<SKILL_NAME>/workspace/iteration-2/benchmark.json`
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
Take a look at `evals/<SKILL_NAME>/README.md` if present, otherwise use `evals/README.md`. Then evaluate the skill using `evals/<SKILL_NAME>/evals/evals.json` and save repeated runs under `evals/<SKILL_NAME>/workspace/iteration-2/`.
```

Or shorter:

```text
Evaluate `skills/<SKILL_NAME>` using `evals/<SKILL_NAME>/evals/evals.json`. Follow the repeated-run instructions in `evals/README.md`. Save everything under `evals/<SKILL_NAME>/workspace/iteration-2/`.
```
