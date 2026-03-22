# Eval Results & Skill Critique — 4 Iterations

## Overview

Ran 5 skills through 4 eval iterations (different agents, different runs per iteration). Total: ~400 graded runs across `with_skill` and `without_skill` configurations.

### Cross-iteration with_skill pass rates

| Skill              | iter-1 | iter-2 | iter-3 | iter-4 |
| ------------------ | ------ | ------ | ------ | ------ |
| manipulating-video | 1.000  | 1.000  | 0.639  | 1.000  |
| screencast         | 1.000  | 0.970  | 0.367  | 0.969  |
| template           | 1.000  | 1.000  | 0.825  | 1.000  |
| terminal-recording | 1.000  | 1.000  | 0.667  | 1.000  |
| upload-image       | 1.000  | 1.000  | 0.264  | 1.000  |

**Observation:** iteration-3 was run with `codex exec` which timed out repeatedly, couldn't find Chrome, and failed on tasks that actually require network/browser access. Every other iteration shows near-perfect with_skill scores. The eval framework itself is a source of variance, not just the skills.

### Cross-iteration deltas (with − without)

| Skill              | iter-1 | iter-2 | iter-3 | iter-4 | Mean  |
| ------------------ | ------ | ------ | ------ | ------ | ----- |
| manipulating-video | +0.64  | +0.36  | +0.06  | +0.34  | +0.35 |
| screencast         | +0.50  | +0.84  | +0.37  | +0.84  | +0.64 |
| template           | +1.00  | +0.62  | +0.56  | +0.58  | +0.69 |
| terminal-recording | +0.58  | +0.59  | +0.10  | +0.41  | +0.42 |
| upload-image       | +0.78  | +0.50  | +0.22  | +0.57  | +0.52 |

---

## Meta-problem: benchmark schema drift

Every iteration produced a different JSON shape for `benchmark.json`:

- iter-1: `run_summary.with_skill.pass_rate.mean`
- iter-2: `overall.with_skill.pass_rate.mean` OR `evals.<id>.with_skill_avg_score` (0-100 scale)
- iter-3: `summary.with_skill.pass_rate.mean`
- iter-4: `overall.with_skill_mean`

This means no tooling can consume benchmarks across iterations without a normalization layer. Either lock the schema in `evals/README.md` or provide a `benchmark-schema.json` that agents must validate against.

---

## Per-skill critique

### screencast

The highest-delta skill (the skill matters most) but also the most fragile.

#### What works — do NOT change

- **`SKILL.md` L28-32 (Rules section).** The three negative rules ("Do NOT manually search for Chrome", "Do NOT expose publicly", "Do NOT chain commands") are the most effective lines in any skill. In iter-2 and iter-4, with_skill agents obeyed all three 100% of the time. The negative-imperative style ("Do NOT") lands far better than positive guidance ("prefer X"). Leave these exactly as-is.
- **`SKILL.md` L38-44 (Step 1).** The `AGENT_BROWSER_STREAM_PORT=9223 agent-browser open <URL>` command is a perfect copy-paste block. Agents reproduce it verbatim in every with_skill run across all 4 iterations. The `<URL>` placeholder is unambiguous and agents substitute it correctly. This is the gold standard for how a skill step should look.
- **`SKILL.md` L46-56 (Step 2).** "Run the start script… **Do not add `&` or modify this command.**" — the bold warning works. No with_skill agent ever modified the command. The expected-output hint ("Relay is running. Viewer URL…") helps agents verify success without a separate step.
- **`scripts/server.py` L53-85 (CDP discovery).** The three-tier fallback (CLI arg → env var → `agent-browser get cdp-url` → port scan) is well-engineered. It never needs agent intervention. Leave it.
- **`scripts/server.py` L390-411 (HTTP handler).** Clean separation: `/health` returns JSON, `/ws` upgrades to WebSocket, everything else serves the viewer HTML. No agent has ever needed to understand or modify this.
- **`scripts/start-relay.sh` L48-50 (`pkill -f "server.py"` before start).** This idempotent cleanup means agents can re-run Step 2 without port conflicts. Every iteration benefited from this; no "address already in use" errors in any grading file.
- **The mermaid diagram at `SKILL.md` L9-14.** It's ignored by agents (they don't parse mermaid) but it's zero-cost and good for human readers. Leave it.

#### What's broken — specific lines

**Problem 1: The 5-step sequence is too granular.**
Steps 2→3→4 (start relay, reload for first frame, health check) are three separate bash calls that agents skip or reorder. Step 3 (reload) is the most-skipped step across all iterations — in iter-4, 1/10 with_skill runs skipped it.

- `SKILL.md` L58-65 — Step 3 is a standalone reload that agents forget because it feels like a verification step, not a required action. The skill explains _why_ ("Chrome only sends a frame when the page visually changes") but agents don't read rationales, they read command blocks. The explanation is on L60; the command is on L63. Agents see the command, skip the explanation, and sometimes skip the whole step because the previous step already said "Relay is running."
- `scripts/start-relay.sh` L62-70 — The health check loop only waits for HTTP 200 from `/health`. It could also reload the page and verify `frames > 0` before declaring success. That would eliminate Step 3 and Step 4 as separate agent actions.

**Problem 2: `WATCH` is buried.**
The eval `watch-local-files` expects the agent to set `WATCH=./demo` but the skill only mentions `WATCH` in a Configuration table (L94-104) and a "File Watching" section (L106-119). The actual Steps section (L34-84) never mentions it. Agents follow Steps, not reference tables.

- `SKILL.md` L34-84 — No conditional step like "If the user wants file watching, prefix with `WATCH=<dir>`."
- `scripts/server.py` L453-464 — The server _auto-detects_ `file://` URLs and watches that directory. So the WATCH env var is only needed when the directory isn't the one Chrome is pointed at. The skill doesn't explain this distinction, so agents either always set WATCH (unnecessary for file:// URLs) or never set it (wrong for custom dirs).

**Problem 3: `public-sharing-request` depends on sequencing that isn't in the Steps.**
The assertion "local relay is started before public sharing" requires the agent to do Steps 1-5 _then_ layer on Tailscale. But SKILL.md L122-140 ("Sharing Publicly") is a separate section disconnected from the Steps flow. An agent could reasonably start Tailscale first. The grading file from iter-2 run-10 confirms this: agent correctly set up relay and Tailscale Funnel but only shared the public URL, omitting `localhost:3456` from the final response.

**Problem 4: The server binds to `0.0.0.0`.**

- `scripts/server.py` L472 — `websockets.serve(handler, "0.0.0.0", PORT, ...)`. This means the relay is LAN-accessible by default. The skill says "do NOT expose publicly unless asked" but the server itself is already exposed on the LAN. Contradicts the Rules section. Should bind to `127.0.0.1` and only widen when explicitly sharing.

**Problem 5: No prereq verification.**
If `agent-browser` isn't installed or Chrome isn't running, the entire eval chain cascades into timeout. iter-3 is proof: 100% of screencast with_skill runs for `watch-local-files` and `public-sharing-request` failed with environment issues — Chrome/Playwright was unavailable. `start-relay.sh` could check for `agent-browser` in PATH before launching.

---

### upload-image

#### What works — do NOT change

- **`SKILL.md` L70-76 (Step 2: the upload curl command).** This is the single most reliable code block across all skills. Every with_skill agent in iter-1, iter-2, and iter-4 reproduced it exactly: `curl -s -X POST "https://api.imgbb.com/1/upload" -F "key=$IBB_API_KEY" -F "image=@..."`. The `$IBB_API_KEY` reference (not hardcoded) means agents never leak the key. 100% pass rate on the "does not expose API key" assertion across all iterations.
- **`SKILL.md` L12-16 (auto-trigger section).** "If the user shares an animated image… do not complain or apologize. Instead: 1. Load this skill. 2. Upload. 3. Share the URL." This is the strongest behavioral directive in any skill. When agents can actually execute it (iter-1, 2, 4), they follow the three numbered steps exactly. The "do not complain or apologize" phrasing is critical — without it, agents default to "I'm sorry, I can't analyze animated images."
- **`SKILL.md` L86-98 (Step 3: presentation format).** The `✅ Uploaded:` template with `URL:`, `Viewer:`, `Delete:` labels is reproduced nearly verbatim by every with_skill agent. Agents love copying emoji + label formats. This is why the "includes direct and viewer URLs" assertion passes at near-100%.
- **`SKILL.md` L21 ("do not echo or print it").** Explicit API key hygiene instruction. Works perfectly; no with_skill agent in any iteration exposed `IBB_API_KEY`.

#### What's broken — specific lines

**Problem 1: `animated-image-fallback` is structurally untestable.**
The eval prompt says "I attached an animated GIF and you can't inspect all the frames." There's no actual file to work with — the agent must simulate receiving an unanalyzable image. In iter-3 this caused 5/8 with_skill runs to timeout exploring hosting paths with no actual file to upload. The eval needs a concrete fixture (e.g., `/tmp/test-animation.gif`).

**Problem 2: SVG conversion has a macOS-only fallback that might not work.**

- `SKILL.md` L48-57 — Lists `magick` first, then `sips` as fallback. But `sips` doesn't reliably support SVG→PNG across all macOS versions. The skill doesn't say which to try first or how to detect failure. A simple "try `magick`, fall back to `sips`" isn't enough — agents need an explicit `if command -v magick` branch or the skill should just pick one.

**Problem 3: The delete URL parsing is implicit.**
The eval asserts "includes a delete URL" but `SKILL.md` L86-98 only shows the presentation template with `Delete: https://ibb.co/xxxx/delete-hash`. The imgbb API returns `data.delete_url` but the skill never names this JSON field. Agents get it right because they parse the full API response, but the skill is relying on agent initiative, not instruction.

**Problem 4: `SKILL.md` L43 — the `@` syntax is unexplained.**

```
-F "image=@/path/to/file.png"
```

The `@` prefix for curl file upload is non-obvious. Agents reproduce it from the template, but without*skill agents frequently omit it (writing `-F "image=/path/to/file.png"` instead), causing silent failures. The skill works \_because* it includes the exact command — but it never explains _why_ the `@` is there. If an agent improvises, it'll break.

---

### terminal-recording

#### What works — do NOT change

- **`SKILL.md` L46-57 (Phase 1 — Setup).** The topic-based directory pattern (`mkdir -p /tmp/<topic>`, `asciinema rec /tmp/<topic>/<topic>.cast`) is the strongest organizational directive across all skills. In iter-1/2/4, 100% of with_skill agents followed it. The `<topic>` placeholder is intuitive — agents infer "installing-dependencies" from the prompt naturally. This pattern drives the "topic-based output directory" assertion to 100% with_skill.
- **`SKILL.md` L96-105 (Phase 3 — results presentation).** The `✅ Recording complete` template with labeled fields (Asciinema URL, Cast file, GIF file, GIF URL) is reproduced verbatim. Same pattern as upload-image — agents are excellent at copying structured output templates. The "← only if uploaded" annotation on L104 prevents agents from fabricating a GIF URL when `--upload-gif` wasn't used.
- **`scripts/finalize-recording.sh` L80-93 (JSON output with `jq -n`).** Clean structured output to stdout with diagnostics on stderr. Agents can parse it. The conditional `gif_url` field (only present with `--upload-gif`) is well-implemented.
- **`SKILL.md` L29-33 (Available commands).** Listing `asciinema rec`, `asciinema upload`, and `agg` with their full invocation patterns works well. Agents don't have to guess the CLI interface.

#### What's broken — specific lines

**Problem 1: Cross-skill reference to `upload-image` is invisible without context.**
The `gif-hosting` eval asserts "references the upload-image skill for hosting." This is 0% without_skill across all 4 iterations. Even with skill loaded, iter-3 scored only 0.71. The SKILL.md reference is indirect:

- `SKILL.md` L88-94 — Uses `scripts/finalize-recording.sh --upload-gif` which internally calls imgbb. The skill never says "use the upload-image skill" or "load the upload-image skill." The script (`finalize-recording.sh` L62-78) directly curls imgbb, bypassing the upload-image skill entirely. So the eval assertion and the actual implementation disagree — the script reimplements upload-image rather than referencing it.

**Problem 2: `finalize-recording.sh` hardcodes temp file paths.**

- `scripts/finalize-recording.sh` L50 — `/tmp/terminal-recording-upload.log`
- `scripts/finalize-recording.sh` L60 — `/tmp/terminal-recording-agg.log`
- `scripts/finalize-recording.sh` L71 — `/tmp/terminal-recording-gif-upload.json`
  Multiple concurrent recordings clobber each other. Should use `mktemp` or topic-namespaced paths like `/tmp/${topic}-upload.log`.

**Problem 3: `headless-record.sh` uses `--headless` flag that isn't stable.**

- `scripts/headless-record.sh` L37 — `asciinema rec --overwrite --headless --command "$*"`. The `--headless` flag was introduced in asciinema 3.x. The skill's Requirements (L16) just says "`asciinema` CLI installed" without a version constraint. If someone has asciinema 2.x, this silently fails.

**Problem 4: `finalize-recording.sh` L51 — fragile URL extraction.**

```bash
ASCIINEMA_URL="$(grep -Eo 'https://asciinema.org/a/[A-Za-z0-9]+' /tmp/terminal-recording-upload.log | tail -n 1)"
```

This regex-greps the upload log for a URL. If asciinema changes their output format or URL pattern, this breaks silently. The `asciinema upload` command prints the URL to stdout, but the script captures both stdout and stderr to the same log file (L50: `> /tmp/terminal-recording-upload.log 2>&1`), then regex-extracts. It would be cleaner to capture stdout and stderr separately.

---

### manipulating-video

#### What works — do NOT change

- **`SKILL.md` L32-40 (Rules section).** Six crisp rules that agents follow reliably:
  - "Always run `ffprobe` first" — drives the probe assertion to ~100% in iter-1/2/4.
  - "Never overwrite the original file" — 100% compliance across every with_skill run in every iteration. Zero original-file-overwritten in any grading file.
  - "Use `-y` to auto-overwrite output files" — prevents the interactive y/n prompt that hangs agent bash calls. No agent ever got stuck on an overwrite prompt.
  - "Append `2>&1`" — agents follow this consistently when the rule is present. Without the skill, ~50% of agents omit stderr capture.
- **`SKILL.md` L42-50 (Agent Checklist).** The numbered 1-5 checklist is the most reliably followed sequence in any skill. In iter-4, all 15 with_skill runs followed it in order. The checklist works because it's short (5 items), imperative ("Probe… Choose… Pick… Run… Tell…"), and each item is one sentence. Compare this to screencast's 5 steps, which are longer — the manipulating-video checklist is tighter and more reliable.
- **`SKILL.md` L56-65 (Output Naming table).** The `| Compress | <name>_compressed.mp4 |` table is perfectly sized: agents scan it, pick the row, and apply the suffix. Every with_skill compression run across all iterations produced `*_compressed.mp4`. The table format is better than prose for this.
- **`SKILL.md` L126-143 (GIF two-pass workflow).** The palette-based GIF flow with pass 1 (palettegen) and pass 2 (paletteuse) is the single biggest quality differentiator. Without_skill agents produce ugly single-pass GIFs in ~90% of runs. With the skill, 100% use the two-pass flow. The `FPS=12`, `WIDTH=480` defaults on L138 are the right call — agents don't have to think about parameters.
- **`SKILL.md` L67-73 (Step 0 — ffprobe command).** The exact `ffprobe` command with `-show_entries` and `-of json` is reproduced verbatim by with_skill agents. This is important: when agents improvise a shorter ffprobe command, they lose the structured JSON that makes audio-stream detection programmatic rather than guesswork.

#### What's broken — specific lines

**Problem 1: `mute-no-audio` — the checklist has no audio-awareness branch.**
Even with the skill loaded, iter-3 had `"The command avoids mapping or filtering nonexistent audio"` as a repeated_failure (5/5 runs). The Rules section (L37) says "If a file has no audio stream, use `-an` and avoid audio filters/mappings" — but the Agent Checklist (L42-50) doesn't include a decision point. The checklist says "Pick the command for the requested operation" (L48) without branching on "does audio exist?" Agents follow the checklist, not the rules. The fix would be inserting a step between 1 and 2: "If no audio streams were found in the probe, note this — skip audio flags in step 3."

**Problem 2: The probe command is long and agents sometimes simplify it.**

- `SKILL.md` L72-73 — The ffprobe command is 160+ characters. In iter-3, the grading evidence shows agents running `uv run ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=noprint_wrappers=1` — note the missing `-of json` and the missing `codec_type` field. Without `codec_type`, there's no way to programmatically detect audio streams.

**Problem 3: `SKILL.md` L40 — `-hwaccel auto` is mentioned but never used.**
The rule says "Use hardware acceleration when available (`-hwaccel auto`)" but none of the command templates in the Instructions section include `-hwaccel auto`. Agents follow the templates, not the rules. This rule is dead weight — either add it to every template or remove the rule.

---

### template

#### What works — do NOT change

- **`SKILL.md` L13-18 (Frontmatter checklist).** Two items: `name` (kebab-case) and `description` (what + when to trigger). 100% with_skill compliance across all iterations. The brevity is the point — agents don't skip short checklists.
- **`SKILL.md` L22-54 (Body template).** The fenced markdown block with `## Requirements`, `## When to Use`, `## Available scripts`, `## References`, `## Instructions` is the most-copied structure across all skills. Agents reproduce it section-by-section. The "User says '...'" pattern in "When to Use" is especially effective — agents generate realistic trigger phrases without further guidance.
- **`SKILL.md` L37-40 (Available scripts section in template).** `scripts/example.sh` and `scripts/example.py` with relative paths. This is why the "script references use relative paths" assertion passes at 100% with_skill — agents see `scripts/example.sh` and produce `scripts/tool.py`, not `/absolute/path/tool.py`.
- **`SKILL.md` L70-75 (Rules section).** Four bullet points. Every one is concrete and actionable. "Reference bundled files with relative paths" is the most reliable rule across all skills. "Add `evals/evals.json` with at least 2 realistic prompts" is the line that drives the evals-section assertion — without it, 0% of agents add evals.

#### What's broken — specific lines

**Problem 1: `new-skill-skeleton` — evals section is at the very bottom.**

- `SKILL.md` L77-96 — The "Eval starter" section is the last section. In iter-3, with_skill scored only 0.65 on `new-skill-skeleton` because agents generated the upper sections faithfully but truncated before reaching the eval starter. The Rule on L75 says "Add `evals/evals.json`" but the actual JSON template is 20 lines later, past a section break. Moving the eval starter earlier (e.g., right after the Instructions section in the body template) would improve this.

**Problem 2: The `--help` guidance is a bullet point, not a code example.**

- `SKILL.md` L73 — "If a script exists, make it non-interactive and document `--help`." This is a rule, not a template example. The body template on L40 mentions `--help` once (`Mention \`uv run scripts/example.py --help\` if applicable`) but it's parenthetical. The without_skill `--help` assertion is flaky: 0.53 pass rate in iter-3 (some agents naturally mention it, some don't). Not a critical fix, but a concrete example in the template body would make it stickier.

**Problem 3: The body template has broken markdown fencing.**

- `SKILL.md` L22, L54, L56, L62, L68 — The template uses nested fenced code blocks (quadruple backticks wrapping triple backticks) which is technically valid but renders poorly in some markdown viewers. The closing fences on L54/L56/L62/L68 can confuse agents about where the template ends and the skill's own rules begin. In iter-3, one with_skill run generated output that included the literal ```````` markers as part of the skeleton. Not frequent, but a real parsing hazard.

---

## Recommendations (not acting on these — just documenting)

### Screencast robustness (biggest bang for effort)

1. **Collapse Steps 2-4 into `start-relay.sh`.** Have the script reload the page and verify `frames > 0` before returning. This removes two agent failure modes (skipping reload, skipping health check).
2. **Add a WATCH conditional to Step 2.** Something like: "If the user wants directory watching: `WATCH=./dir bash scripts/start-relay.sh`."
3. **Bind to `127.0.0.1` by default** in `server.py` L472. Add a `--bind` flag or `BIND_HOST` env var for explicit LAN/public exposure.
4. **Add a prereq check** to `start-relay.sh`: verify `agent-browser` is in PATH before launching the server.
5. **Add a Step 6 for public sharing** in the Steps section instead of a disconnected section at the bottom.

### Eval framework

1. **Lock the benchmark.json schema** in `evals/README.md`. Provide a JSON Schema or at minimum a canonical example that all iterations must match.
2. **Provide fixture files for evals that need them.** `animated-image-fallback` needs a real GIF. `mute-no-audio` needs a real no-audio video. Don't rely on agents to create test fixtures.
3. **Record which agent/runtime ran each iteration** in the benchmark metadata. iter-3's collapse is only explainable because we know it was codex exec; future readers won't.

---

## Cross-cutting patterns: what agents obey vs. ignore

Patterns extracted from 400+ graded runs. Use these when writing or editing any skill.

### Agents always follow

| Pattern                                  | Example                                                | Why it works                                                  |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ---------------------- | --- | ---------------------------------------- |
| Copy-paste command blocks                | `curl -s -X POST "https://api.imgbb.com/1/upload" ...` | Zero interpretation needed. Agents reproduce verbatim.        |
| Negative imperatives ("Do NOT")          | `Do NOT manually search for Chrome`                    | Stronger signal than "prefer" or "avoid." 100% compliance.    |
| Short numbered checklists (≤5 items)     | manipulating-video Agent Checklist L42-50              | Agents execute sequentially without skipping.                 |
| Output presentation templates with emoji | `✅ Uploaded: filename.png`                            | Agents love these and reproduce them character-for-character. |
| Naming convention tables                 | `                                                      | Compress                                                      | <name>\_compressed.mp4 | `   | Agents scan, match, apply. No ambiguity. |
| Inline `<placeholder>` in commands       | `agent-browser open <URL>`                             | Agents substitute correctly. Better than prose descriptions.  |
| Bold warnings on critical lines          | `**Do not add \`&\` or modify this command.\*\*`       | Agents respect bolded restrictions.                           |

### Agents often ignore

| Pattern                                | Example                                                         | Why it fails                                                                                    |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rules disconnected from steps          | `-hwaccel auto` in Rules but absent from templates              | Agents follow templates, not rules. Dead rules = dead weight.                                   |
| Reference tables (env vars, config)    | `WATCH` in a Configuration table                                | Agents read Steps, skip tables. If it's not in a step, it doesn't exist.                        |
| Rationale text before a command        | "Chrome only sends a frame when..." before `agent-browser eval` | Agents read the command, skip the explanation, sometimes skip the whole step.                   |
| Sections after the main workflow       | "Eval starter" at the very bottom of template                   | Agents truncate. Put critical content early.                                                    |
| Implicit JSON field names              | "includes a delete URL" without naming `data.delete_url`        | Works when agents parse the full response, but fragile.                                         |
| Cross-skill references                 | "use the upload-image skill for hosting"                        | 0% without_skill, flaky even with_skill. Agents don't load other skills unless explicitly told. |
| Long single-line commands (160+ chars) | The ffprobe command in manipulating-video L72                   | Agents simplify/truncate, losing critical flags.                                                |

---

## Eval framework redesign: separating execution from grading

### The core problem with the current evals

The current setup asks the **same agent** to execute the skill, produce output, AND grade itself. That's why iter-3 collapsed — codex couldn't execute (no Chrome, timeouts), so it had nothing to grade, so it scored itself zero. And it's why iter-1/4 scored 100% with_skill — the agent "simulated" what it would do, then graded its own simulation. You're essentially getting the agent's self-assessment, not a measurement of what actually happened.

The iter-2 and iter-3 data is more honest because those agents actually tried to execute commands and hit real failures. But the grading was still done by the same agent in the same context, which introduces leniency bias (or in iter-3's case, an agent that gave up and scored everything zero out of frustration).

### Proposed architecture: three-phase eval pipeline

#### Phase 1: Environment setup (scripted, no agent)

A plain shell script that:

- Creates a temp workspace with realistic files (test videos, SVGs, .cast files, a dummy project dir)
- Sets env vars (`IBB_API_KEY`, PATH with required tools)
- Verifies prerequisites exist (`which ffmpeg agg asciinema agent-browser`)
- Records what's available and what's not in an `environment.json`

This removes the "agent creates its own test fixtures" problem that plagues every iteration. The manipulating-video eval says "Compress /tmp/demo/input.mov" but the file doesn't exist until someone creates it. That should be a fixture, not an agent task.

#### Phase 2: Execution (agent under test)

Give the agent the real prompt in a real workspace. Capture everything:

```bash
# Option A: script(1) — captures terminal I/O
script -q /tmp/eval-session.log amp "Compress /tmp/demo/input.mov into a smaller mp4"

# Option B: tee the full agent output
amp --prompt "..." 2>&1 | tee /tmp/eval-output.log

# Option C: if using amp programmatically, use the thread ID
# and read_thread later to get the full conversation
```

What to capture:

- Full conversation transcript (every tool call, every response)
- All files created/modified (diff the workspace before/after)
- Timing (wall clock start/end)
- Exit status
- The actual output artifacts (compressed video, uploaded URL, etc.)

The key constraint: the agent under test gets **zero knowledge** that it's being evaluated. It just sees a user prompt. No "grade yourself" step. No assertions visible to it.

#### Phase 3: Grading (separate agent, separate context)

A different agent (or even a different model) gets:

- The eval spec (assertions)
- The full session transcript from Phase 2
- The workspace diff (files before/after)
- The `environment.json` from Phase 1
- The actual output artifacts

It grades each assertion with evidence drawn from the transcript. It never saw the execution — it's forensic analysis.

This is where environment failures get handled properly: if the transcript shows `agent-browser: command not found`, the grading agent marks it as an environment failure, not a skill failure. Currently that distinction gets lost when the executing agent grades itself.

### How the evals themselves should change

**1. Evals need fixture manifests.** Each eval should declare what files must exist before the agent starts:

```json
{
  "id": "compress-mp4",
  "prompt": "Compress /tmp/demo/input.mov into a smaller mp4",
  "fixtures": {
    "/tmp/demo/input.mov": "generate:video:5s:320x240:with_audio",
    "/tmp/demo/no-audio-source.mp4": "generate:video:3s:320x240:no_audio"
  },
  "assertions": [...]
}
```

Right now, 3 of the 5 skills need files that don't exist. The agent either creates them (wasting time, introducing variance) or fails.

**2. Assertions should distinguish "did the right thing" from "said the right thing."** Currently, assertions like "The response explains the chosen compression settings" conflate execution with communication. An agent might compress perfectly but forget to explain CRF in its final message. That's a presentation issue, not a skill issue. Split them:

```json
{
  "execution_assertions": [
    "ffprobe was called before ffmpeg",
    "Output file is a valid MP4 smaller than input"
  ],
  "response_assertions": ["Final message mentions codec and CRF/bitrate"]
}
```

This lets you track whether skill failures are execution failures or communication failures — those need different fixes.

**3. Some assertions are untestable as written.** `animated-image-fallback` requires the agent to be in a state where it "received an animated GIF and can't inspect it." You can't manufacture that state from a text prompt. Either:

- Provide an actual animated GIF file and test whether the agent uploads it instead of trying to analyze it
- Or accept that this eval is a behavioral/reasoning test, not an execution test, and grade it from the transcript only

**4. The screencast evals need a "degraded mode" path.** If Chrome isn't available, the entire skill is untestable. The eval should have a prerequisite check that marks the whole eval as `SKIPPED` rather than letting it cascade into timeouts and zeros. That way you can separate "skill works when environment is present" from "environment wasn't present."

### Multi-agent testing

The "one agent per skill" advice in `evals/README.md` is correct for parallelism but insufficient for comparison. What you actually want:

**Run matrix:**

- N agents (amp, codex, claude-code, etc.) × M skills × K runs × 2 configs (with/without)
- Same fixtures, same prompts, same grading agent
- Different executing agent each time

**What this reveals that single-agent doesn't:**

- Whether a skill only works for the agent it was written for (overfitting)
- Whether certain assertions are model-dependent (e.g., "explains CRF" — GPT-4 explains naturally, other models might not)
- Whether the skill's command blocks are robust across agent runtimes (codex exec can't run `agent-browser`, amp can)

**The grading agent should be fixed across all runs.** If you change the grading agent between iterations, you get grading variance on top of execution variance (which is exactly what happened — iter-3's grader was harsher than iter-4's). One grading model, one grading prompt, applied to all transcripts post-hoc.

### Concrete harness

A small harness — doesn't need to be fancy:

```
evals/
  run-eval.sh              # orchestrator
  fixtures/                # pre-built test files
    video-with-audio.mov
    video-no-audio.mp4
    test-animation.gif
    logo.svg
    diagram.png
  grade.md                 # grading prompt for the grading agent
```

`run-eval.sh` does:

1. Copy fixtures into place
2. Verify prereqs, write `environment.json`
3. Launch the agent-under-test with the prompt, capture the full transcript
4. Snapshot workspace diff (before/after)
5. Hand transcript + diff + eval spec to the grading agent
6. Collect `grading.json` from the grader

The separation means you can re-grade old transcripts with a new grading prompt without re-running anything. You can also swap in a different executing agent without changing the grading pipeline.

The biggest win: you stop measuring "how well does an agent grade itself" and start measuring "how well does an agent follow a skill."
