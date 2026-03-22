# Codex Follow-up Notes

## Scope

This note summarizes the discussion starting from:

> "now the more important question..."

The goal is to decide what to do next to make the skills more robust and reduce agent confusion during evals.

## Main Conclusion

The important signal is not how to make `without_skill` perform better.

`without_skill` is a baseline. Its job is to show whether the skill materially improves agent behavior over a general agent. That means:

- Do not optimize the baseline path just to raise its score.
- Do inspect `without_skill` when needed to validate the comparison.
- Focus improvement work on `with_skill`, shared environment blockers, and eval validity.

## When `without_skill` Is Worth Inspecting

Look at `without_skill` only for these reasons:

- The baseline failure suggests the eval may be unfair or overfit to one exact phrasing or tool.
- The baseline failure reveals an environment problem that also affects `with_skill`.
- The baseline succeeds for the wrong reason and weakens the comparison.
- The baseline is unexpectedly strong, which may mean the skill is not adding enough unique value.

Otherwise, weak `without_skill` performance is fine and does not need to be fixed.

## Cross-Skill Pattern

Across the iterations, agents were usually better at the core task than at the workflow contract around the task.

Recurring failure shape:

- Missing required preflight checks.
- Missing required evidence in the final answer.
- Drifting into plausible alternative workflows instead of the intended one.
- Failing to return the exact metadata the eval expects.
- Burning time recovering from implicit environment problems instead of stopping cleanly.

In other words, the weak point is often not capability. It is protocol adherence.

## Least Reliable Part Of Each Skill

### `manipulating-video`

Least reliable parts:

- Running `ffprobe` first.
- Explaining chosen settings clearly.
- Explaining tradeoffs, especially for GIF generation.

The transforms themselves are usually fine. The eval failures cluster around inspection and justification.

### `template`

Least reliable parts:

- Structural completeness in the generated scaffold.
- Required sections being omitted when the agent is not explicitly guided.

This skill is generally stable. The failures are mostly missing template structure, not misunderstanding the task.

### `terminal-recording`

Least reliable parts:

- Following the exact recording choreography.
- Using the expected `/tmp/<topic>` style workspace.
- Explicitly connecting recording, `agg`, and upload flow in the wrap-up.

The weak point is workflow sequencing rather than terminal capture itself.

### `upload-image`

Least reliable parts:

- Returning both direct URL and viewer URL.
- Preserving a delete/removal handle.
- Converting SVG first and then uploading the converted PNG.
- Completing the animated-image fallback path reliably.

The main issue is host-contract correctness, not just “some upload happened”.

### `screencast`

Least reliable parts:

- Staying on the intended relay architecture.
- Correctly sequencing page open, relay start, first-frame trigger, health verification, and viewer URL handoff.
- Handling `watch-local-files` reliably.
- Failing cleanly when browser/runtime prerequisites are missing.

This skill is the most brittle because it combines a narrow intended workflow with environment-sensitive browser prerequisites.

## Specific `screencast` Takeaways

The question "did the agents use `agent-browser`?" has a clear answer:

- `with_skill`: usually yes.
- `without_skill`: usually no.

That matters because `without_skill` agents regularly drifted into alternative architectures:

- Playwright-based flows
- generic local servers
- custom live-reload servers
- browser-install recovery attempts
- unrelated streaming approaches

Those attempts are understandable, but they are still wrong under the intended skill contract.

## What To Do Next

The next work should target robustness of the intended path and reduction of agent choice.

### Priority 1: Reduce workflow ambiguity

- Collapse multi-step happy paths into one canonical wrapper command where possible.
- Prefer scripts over prose when the order of operations matters.
- Give each eval shape one canonical command instead of asking the agent to compose a workflow.

This matters most for `screencast`, and secondarily for `terminal-recording` and `upload-image`.

### Priority 2: Move prerequisite checks into scripts

- Check browser/runtime/tool availability inside the script.
- Fail with one explicit diagnostic when prerequisites are missing.
- Do not rely on the agent to discover or repair the environment.

This is especially important for `screencast`.

### Priority 3: Add anti-drift instructions

- Tell the agent what not to do when a supported path exists.
- Explicitly forbid substitute architectures where eval correctness depends on one intended toolchain.
- Treat unsupported recovery attempts as wrong, not clever.

Best candidate:

- `screencast`: do not invent another server, browser stack, or streaming approach.

### Priority 4: Make success machine-checkable

- Have scripts emit health/state that proves success directly.
- Prefer one source of truth for viewer URL, frame count, watch status, upload result, or delete handle.
- Reduce reliance on the final natural-language response for proof.

Best candidates:

- `screencast`: emit relay health including frame count and watch mode.
- `upload-image`: emit direct URL, viewer URL, and delete handle in one structured result.
- `terminal-recording`: emit recording path, render path, and upload result explicitly.

### Priority 5: Tighten skill docs around contract points

For each skill, the docs should emphasize the exact assertions that agents commonly miss.

Examples:

- `manipulating-video`: probe first, then explain settings and tradeoffs.
- `template`: include every required scaffold section.
- `terminal-recording`: use the expected tmp layout and mention upload/render steps explicitly.
- `upload-image`: return all expected URLs/handles, not just one successful upload.
- `screencast`: use `agent-browser`, then relay script, then force first frame, then verify health, then share viewer URL.

## What Not To Do

- Do not spend time trying to make `without_skill` rediscover the intended skill workflow.
- Do not treat low baseline performance as a defect by itself.
- Do not confuse shared environment failures with skill-design failures.

## Decision Rule Going Forward

Use this triage rule:

- If `with_skill` is strong and `without_skill` is weak: do nothing to baseline.
- If both are weak: investigate `with_skill` and shared environment assumptions.
- If `without_skill` is unexpectedly strong: check whether the skill still adds unique value.
- If failures come from environment instability: fix the environment or bake checks into scripts before changing skill instructions.

## Next Eval Method

The next round should keep the current repeated authored evals, but add a second layer that is closer to real usage.

### Recommendation

Keep two eval layers:

- `Controlled`: the current authored evals with fixed prompts and fixed assertions.
- `Realistic`: fresh workspace fixtures, real files, natural prompts, full transcript capture, and post-hoc grading.

The controlled layer answers:

- does the skill make the agent follow the intended workflow?

The realistic layer answers:

- does the skill help the agent in normal ambiguous work?
- where does the agent drift?
- which failures are due to environment vs skill design?

### Realistic Run Design

For each realistic run:

- start from a fresh fixture directory
- include real files relevant to the skill
- give a natural user prompt rather than an eval-shaped prompt
- record the full session transcript
- save command logs and produced artifacts
- save environment diagnostics

Examples:

- `screencast`: local demo files, known browser/runtime state, relay health snapshots, viewer verification
- `upload-image`: real PNG, SVG, and animated-image fixtures
- `manipulating-video`: actual sample videos with and without audio
- `terminal-recording`: real `.cast` fixture plus an interactive recording scenario

### Grading Approach

Do not rely on an LLM grader alone.

Use a hybrid grader:

- `Rule-based checks` for objective facts
- `Artifact checks` for produced outputs
- `Transcript-based grading` for workflow adherence and drift analysis
- `LLM grading` only on top of the saved evidence, not instead of it

The grader should inspect:

- the eval spec
- the full transcript
- stdout/stderr logs
- produced files or URLs
- machine-readable health/status outputs
- a summary of objective checks

This gives better signal than asking a grader model to read the transcript alone.

### Eval Improvements

The evals themselves should be improved in these ways:

- separate `process assertions` from `outcome assertions`
- add more fixture-backed tasks
- make success more machine-checkable
- distinguish environment failure from skill failure more explicitly
- reduce overfitting to exact command phrasing when the real value is the outcome

### Why This Matters

The current evals are good at measuring protocol adherence.

They are weaker at measuring whether the skill helps in real work with normal ambiguity. A realistic second layer closes that gap without replacing the current evals.

### Bottom Line

The next test should not just ask whether the agent followed the intended script.

It should also ask whether, in a real workspace with real files and a normal user prompt, the skill reduces drift, reduces confusion, and improves the odds of a correct result. The best setup is: full session capture, saved artifacts, objective checks, and then a post-hoc grader that reads all of that evidence.
