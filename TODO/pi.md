# Cross-Iteration Eval Analysis & Next Steps

Analysis from 596 grading files across 4 iterations (Codex i1, pi i2, Codex i3, Amp i4) covering all 5 skills.

## Key Finding

**with_skill instructions are solid.** Every with_skill failure came exclusively from Codex i3's ephemeral sandboxes (environment issues, not skill quality). When agents can actually execute — pi, Amp, Codex i1 — with_skill is 97–100%.

The problems are:

1. Specific assertions that agents miss even with the skill loaded
2. Skills that are fragile to environment constraints
3. Cross-skill references that get lost in isolation

---

## manipulating-video

### ✅ Do NOT touch — agents do well with these

**Agent Checklist (lines 42–48).** The numbered 1-5 checklist is the single most effective part of this skill. Every agent that followed it passed all assertions. The ordering (probe → choose path → pick command → run → report) maps exactly to how agents think. This is the gold standard for skill structure.

**Output Naming table (lines 50–59).** Agents consistently use these suffixes. The table format works better than prose — agents parse it instantly.

**Step 0 — the ffprobe command (lines 63–68).** The exact command with `-show_entries` and `-of json` is copy-pasteable. Agents don't have to improvise. 100% of with_skill runs that probed used this exact command.

**Convert to GIF two-pass section (lines 108–123).** The palette workflow with explicit Pass 1 / Pass 2 commands is what makes `gif-from-clip` pass. Without it, agents default to single-pass (82% fail rate without skill). The "Good defaults: FPS=12, WIDTH=480" line is critical — agents use those exact values.

**Troubleshooting section (lines 160–164).** Especially the "Stream specifier ':a'" entry. This is the only skill with a troubleshooting section and it's one reason agents handle edge cases better here than in other skills.

### ⚠️ Problems

**Rules line 37: "If a file has no audio stream, use `-an` and avoid audio filters/mappings."**
This rule is correct but too buried. It's one sentence in a 7-item list. The `mute-no-audio` eval fails 45% even with_skill (in Codex i3) because agents read the "Remove audio" section (line 144: `ffmpeg -y -i "<INPUT>" -an -c:v copy "<OUTPUT>"`) and run it without checking ffprobe first. The Remove audio section has no guard clause — it doesn't say "first check if audio exists."

**Fix:** Add a one-line note directly in the "Remove audio" section:

```
### Remove audio

> **Check ffprobe output first.** If the input has no audio stream, tell the user — do not run ffmpeg.
```

**The "Remove audio" section (line 142–145) is 3 lines.** Compare to "Convert to GIF" which is 20 lines with defaults, two-pass, and a fallback. The brevity of "Remove audio" makes agents skip straight to the command without thinking. The mute-no-audio eval specifically tests the edge case where there's nothing to remove, and the skill's thinnest section is the one that handles it.

**Step 0 says "Note whether audio streams exist" (line 68) but doesn't say what to do with that information.** It should say: "If no audio streams exist, skip all audio flags and filters in subsequent commands. Use `-an` only to ensure no audio is mapped; do not use audio codec or bitrate flags."

---

## screencast

### ✅ Do NOT touch

**The Rules section (lines 30–33).** Three negative rules ("Do NOT manually search for Chrome", "Do NOT try to expose publicly", "Do NOT chain commands"). These are perfect. The "Do NOT chain commands" rule in particular prevents a common agent mistake. Agents follow negative rules more reliably than positive ones — keep all three exactly as-is.

**Steps 1–5 structure.** The explicit "each step is a separate Bash tool call" instruction plus exact copy-pasteable commands is why with_skill is 97%+. Agents follow this linearly without deviation. The bold "Do not add `&` or modify this command" on Step 2 is doing real work.

**The mermaid diagram (lines 8–13).** This is unusual in a skill file but it works — it gives agents the mental model of the architecture in one glance. Agents that understand "Chrome → Relay → Viewers" make better decisions when things go wrong.

**`start-relay.sh` script.** Clean, does one thing. The health-check loop with 6 retries and clear error output is exactly right. The `--help` flag and argument validation are agent-friendly. The `pkill -f "server.py"` cleanup before starting prevents port conflicts. Don't change this script.

### ⚠️ Problems

**WATCH env var is invisible in the main Steps flow.** The Steps section (lines 35–72) never mentions WATCH. It appears in:

- The Configuration table (line 83) — agents don't read tables unless directed
- The File Watching section (lines 87–96) — a separate section agents may never scroll to

The `watch-local-files` eval tests whether agents use `WATCH=./demo bash scripts/start-relay.sh`. With the skill, it works because agents eventually find the File Watching section. But it's the most-missed assertion in with_skill runs (~3-5% miss rate) because the linear Steps flow doesn't branch for it.

**No pre-flight or error recovery guidance.** If `agent-browser` isn't installed or Chrome won't launch, the skill gives agents nothing. Compare to manipulating-video which has a Troubleshooting section. Codex i3's 39/60 environment failures all produced empty or timeout grading because the agent had no fallback path.

**Step 3 is architecturally fragile.** "Chrome only sends a frame when the page visually changes" — this is an implementation detail that leaks into the workflow. If `start-relay.sh` did the reload internally after confirming health, Step 3 wouldn't exist and the 3-5% miss rate goes to 0. The script already waits for health; adding a reload there would be natural.

**The "Sharing Publicly" section (lines 98–113) lists 4 options.** The eval only tests Tailscale Funnel, but agents see 4 options and sometimes pick the wrong one or forget to start the local relay first. The section header says "(only when asked)" which is good, but the agent still has to decide between Funnel, Serve, serveo, and wrangler.

---

## template

### ✅ Do NOT touch

**Frontmatter checklist (lines 17–19).** Short, specific, effective. Agents reliably produce correct frontmatter when this exists.

**Body template inside the code fence (lines 21–54).** The fact that it's a literal markdown template agents can copy is why `scripted-skill-template` has 100% with_skill pass rate across all iterations. Agents copy structure better than they infer it.

**Rules section (lines 56–59).** "Reference bundled files with relative paths such as `scripts/tool.py`, not absolute placeholders" — this one line is why the relative-paths assertion passes with_skill. Without it, agents use `/path/to/scripts/tool.py` placeholders 83% of the time.

**"Available scripts" in the body template (lines 33–34).** The mere presence of this section heading in the template means agents reproduce it. Without the skill, 100% of agents across all iterations omit it.

### ⚠️ Problems

**Eval starter section is at the very bottom (lines 61–77).** It's the last section in the file, after Rules. When agents generate long skill files, they run out of steam and drop the final section. Codex i3 missed "includes evals section" 4/5 times even with_skill loaded. Every other section has ~0% with_skill failure rate — only this one fails, and only because of its position.

**The eval starter section isn't part of the body template code fence.** The body template (lines 21–54) ends before the Rules section. The eval starter is a separate section below. An agent copying the body template literally will not include evals. If the body template's code fence contained a placeholder `## Evals` section, agents would copy it.

**The body template's code fence uses 4 backticks (````md).** This is technically correct markdown but unusual. Some agents may not handle the nested fence correctly when generating output, leading to malformed skill files. Not a grading issue but a practical one.

---

## terminal-recording

### ✅ Do NOT touch

**Phase 1/2/3 flow structure.** The three-phase interactive flow (Setup → Recording → Wrap-up) maps perfectly to the conversational turn pattern. Agents understand "wait for user to say start" and "wait for user to say done" — this is one of the most agent-native patterns across all skills.

**`scripts/finalize-recording.sh`.** Excellent script. Does three things (upload, render GIF, optionally upload GIF) with structured JSON output. The `--upload-gif` flag is clean. Error handling is good (checks cast exists, checks URL extraction worked, checks IBB_API_KEY). Agents parse the JSON output reliably.

**`scripts/headless-record.sh`.** Clean `--` separator pattern. The `--help` output shows a real example. Only 6% failure rate on the "uses asciinema rec" assertion.

**The results presentation template (lines 73–80).** The emoji + formatted block gives agents an exact output template. Every with_skill run reproduced this format.

**Available commands section (lines 23–25).** Listing the raw commands (`asciinema rec`, `asciinema upload`, `agg`) separately from the bundled scripts means agents can use either path. Good layering.

### ⚠️ Problems

**upload-image skill reference is too quiet.** The only mention is in Requirements (line 14: "`IBB_API_KEY` only if using `scripts/finalize-recording.sh --upload-gif`") and implicitly through the `--upload-gif` flag. The `gif-hosting` eval asserts "references the upload-image skill for hosting the GIF rather than inventing a new upload flow" — this fails 100% without skill across all iterations and 41% even with_skill in Codex i3.

The SKILL.md never says the words "upload-image skill." It assumes the agent will know that `finalize-recording.sh --upload-gif` uses imgbb which is the upload-image skill's domain. That's too indirect.

**Fix:** Add an explicit note in Phase 3 or in the Manual Usage → Convert to GIF section:

```
> **To host the GIF**, use the `upload-image` skill or run `bash scripts/finalize-recording.sh <cast> --upload-gif`. Do not use imgur, catbox, or other upload services.
```

**The IBB_API_KEY requirement (line 14) is conditional and easy to miss.** It says "only if using `--upload-gif`" — agents read this as "I don't need it" and then fail when the user asks for hosted GIFs. Consider listing it as a full requirement with a note that it's only needed for GIF hosting.

---

## upload-image

### ✅ Do NOT touch

**"When to auto-trigger" section (lines 7–11).** This is the most aggressive trigger in any skill — it tells agents to auto-load the skill when they encounter animated images. The bold "do not complain or apologize" is why the `animated-image-fallback` eval has a 100% with_skill pass rate (outside of env failures). This pattern of telling agents what NOT to do is extremely effective.

**Input Formats table (lines 19–26).** The table with format + example covers every input type. Agents use this as a dispatch table. The SVG row explicitly says "converted to PNG before upload" which is why the conversion assertion passes.

**Step 1 — Prepare the image (lines 30–53).** The format-specific `-F` flag examples are copy-pasteable. The SVG conversion with both `magick` and `sips` fallback paths means agents on macOS without ImageMagick still succeed. This dual-path pattern showed up in real runs — Amp's iteration-4 used `sips` successfully.

**Step 3 — Parse and present (lines 65–73).** The exact output template with URL/Viewer/Delete fields is why agents include the delete URL. Without this template, agents extract URL and Viewer but forget Delete (88% without_skill failure rate).

**Requirements section (lines 13–14).** "Assume it is available — do **not** echo or print it" — this one sentence prevents API key exposure. All with_skill runs passed the "doesn't expose API key" assertion (except Codex i3 env failures).

### ⚠️ Problems

**No error recovery for SVG conversion.** Step 1 shows `magick` and `sips` as alternatives but doesn't say what to do if both fail. An agent on Linux without either tool has no path forward. Minor issue — most agents are on macOS.

**Step 2 — the curl command (lines 55–58) doesn't show response handling.** The command is `curl -s -X POST ...` but there's no `| jq .` or variable capture. Step 3 says "Extract fields from the JSON response" but doesn't show how. Agents figure it out, but a one-liner like `curl ... | jq '{url: .data.url, viewer: .data.url_viewer, delete: .data.delete_url}'` would remove ambiguity.

**The multiple images section (lines 75–82) is undertested.** No eval covers it. It's 8 lines at the end of the file. If it matters, add an eval. If it doesn't, it's dead weight that could confuse agents.

---

## Cross-Cutting Improvements

- [ ] **Every skill should have a Troubleshooting section.** manipulating-video's troubleshooting section is the template. screencast and terminal-recording have none, and those are the skills with the most environment failures.
- [ ] **Cross-skill references need to be explicit.** terminal-recording → upload-image is the clearest example. Say the skill name. Don't assume agents will infer it from env vars or script internals.
- [ ] **Position matters.** The evals section in template, the WATCH var in screencast, the upload-image reference in terminal-recording — all fail because they're at the bottom or in a section agents don't read linearly. Put critical information in the path agents actually follow (Steps, Checklist, Instructions).

---

## How to Test Better Next Time

### Problems with the current approach

The current evals test **whether the agent says the right things**, not **whether the agent does the right things**:

- pi (i2) and Amp (i4) for screencast: neither launched Chrome. They generated plausible responses and graded them. "with_skill: 97%" means "97% of simulated responses mentioned the right commands" — not "97% of the time the screencast actually worked."
- Codex (i3) actually tried to run things and hit real environment problems. Its lower scores are arguably more honest.
- manipulating-video is the exception — all agents ran real ffmpeg and produced real files. Those scores are trustworthy.

The evals differentiate with_skill from without_skill reliably, but they don't tell you whether the skill actually works end-to-end.

### Proposed architecture: execution → recording → independent grading

**Phase 1 — Execution (recorded).** Agent A gets a real working directory with real files, the prompt from evals.json, with or without the skill loaded, and full session recording (`--stream-json` or `script`). Agent A does its thing. No grading awareness.

**Phase 2 — Grading (independent).** Agent B gets the session recording (every tool call, every output), the assertions from evals.json, the actual filesystem state (what files exist, their contents). Agent B grades. It never saw the skill. It doesn't know which config produced this.

This fixes:

1. **No self-grading.** Agent B has no stake in the outcome.
2. **No simulation.** Agent A has to actually do the work.
3. **Full evidence trail.** The recording is the source of truth.

### Self-contained fixtures per eval case

Each eval case should have a self-contained workspace instead of assuming files exist at `/tmp/demo/`:

```
evals/manipulating-video/evals/fixtures/compress-mp4/
  setup.sh           ← generates test files, prints workspace path
  input.mov          ← real file (or generated by setup.sh)
  prompt.txt         ← the eval prompt
```

`setup.sh` makes evals fully reproducible:

```bash
#!/bin/bash
mkdir -p /tmp/eval-workspace
ffmpeg -y -f lavfi -i testsrc=duration=5:size=640x480:rate=30 \
  -f lavfi -i sine=frequency=440:duration=5 \
  -c:v libx264 -c:a aac /tmp/eval-workspace/input.mov 2>/dev/null
echo "/tmp/eval-workspace"
```

### Pre-process recordings for the grading agent

Don't give the grader raw `--stream-json` — pre-process into a structured summary:

```json
{
  "prompt": "Compress input.mov into a smaller mp4...",
  "skill_loaded": true,
  "tool_calls": [
    { "tool": "bash", "command": "ffprobe ... input.mov", "exit_code": 0, "stdout_excerpt": "..." },
    { "tool": "bash", "command": "ffmpeg -y -i input.mov -c:v libx264 ...", "exit_code": 0 }
  ],
  "files_created": ["output_compressed.mp4"],
  "files_modified": [],
  "original_file_intact": true,
  "final_response": "Created output_compressed.mp4 using libx264 CRF 28..."
}
```

### Natural without_skill variance

Stop scripting variance ("Run 1: skip ffprobe, Run 2: run ffprobe but don't explain..."). With real execution, you get natural variance for free. Run 8 times with temperature > 0 without the skill and see what they actually do. Even better: run the same prompt through **different models** (Sonnet, GPT-4o, Gemini) for the without_skill baseline.

### Split assertions into mechanical vs judgment

- **Mechanical** (grade with bash, no LLM): file exists, command ran, exit code 0, hash matches, original file intact
- **Judgment** (grade with LLM): "explains compression settings", "mentions quality-size tradeoff"

Add filesystem assertions to evals.json:

```json
{
  "text": "Output file exists and is smaller than input",
  "type": "filesystem",
  "check": "test -f output_compressed.mp4 && test $(stat -f%z output_compressed.mp4) -lt $(stat -f%z input.mov)"
}
```

Add negative assertions:

```json
{
  "text": "Original file not overwritten",
  "type": "filesystem",
  "check": "shasum input.mov | grep <original-hash>"
}
```

### One sandbox, all skills

All 5 skills' dependencies in one image:

```
ffmpeg ffprobe chromium agent-browser uv node asciinema agg curl jq magick
```

Docker or nix shell. Pre-install everything so agents never install on the fly (which is what caused Codex's timeouts and macOS permission prompts). Every agent runs inside the sandbox with all tools ready.

---

## What NOT to Fix

These assertions fail without_skill by design — they prove the skill provides real value:

| Assertion                                         | Fail rate w/o skill | Why it should stay hard      |
| ------------------------------------------------- | ------------------- | ---------------------------- |
| gif-hosting references upload-image skill         | 100% (17/17)        | Non-discoverable knowledge   |
| interactive-recording uploads + converts with agg | 94% (16/17)         | Bundled script knowledge     |
| topic-based /tmp dir pattern                      | 94% (16/17)         | Convention only in skill     |
| SVG conversion before upload                      | 88% (15/17)         | imgbb doesn't accept SVG     |
| Delete URL in response                            | 88% (15/17)         | Agents don't parse for it    |
| ffprobe before ffmpeg                             | 82% (9/11)          | Agents skip inspection       |
| GIF palette workflow                              | 82% (9/11)          | Agents use single-pass       |
| Quality-size tradeoff mention                     | 82% (9/11)          | Agents don't explain choices |
