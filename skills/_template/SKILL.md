---
name: _template
description: "Template for authoring new skills. Use when creating or refactoring a skill and you need a concise SKILL.md structure with clear trigger text, prerequisites, script references, and eval coverage."
license: "GPL-3.0-or-Later"
metadata:
  author: o-az
  version: "1.0.0"
---

# template

Use this file as a starting point when creating a new skill. Keep `SKILL.md` concise, move heavy detail into `references/` or `scripts/`, and add `evals/evals.json` early so the skill is testable.

## Frontmatter checklist

- `name`: short kebab-case skill name
- `description`: what the skill does and when it should trigger
- Add other metadata only if it serves a real purpose

## Body template

````md
# <skill-name>

One short paragraph describing the skill's purpose and main workflow.

## Requirements

- List required CLIs, env vars, runtimes, or external services.

## When to Use

- User says "..."
- User asks for ...
- User needs ...

## Available scripts

- `scripts/example.sh` - Short description of what it does.
- `scripts/example.py` - Document a real `--help` command, for example `uv run scripts/example.py --help`.

## References

- `references/variant-a.md` - Load when the task needs variant A.
- `references/variant-b.md` - Load when the task needs variant B.

## Instructions

### 1. Inspect or validate inputs

```bash
example command 2>&1
```

### 2. Run the main workflow

```bash
bash scripts/example.sh "$INPUT" 2>&1
```

### 3. Summarize outputs

State what files, URLs, or structured output to return to the user.

## Evals

Create `evals/evals.json` with at least 2 realistic prompts before considering the skill complete.

```json
{
  "skill_name": "<skill-name>",
  "evals": [
    {
      "id": "basic-flow",
      "prompt": "Realistic user request here.",
      "expected_output": "What success looks like.",
      "assertions": ["Concrete observable requirement 1", "Concrete observable requirement 2"]
    },
    {
      "id": "edge-case",
      "prompt": "A realistic edge case for this skill.",
      "expected_output": "Expected behavior for the edge case.",
      "assertions": ["Concrete observable requirement 1", "Concrete observable requirement 2"]
    }
  ]
}
```
````

## Rules

- Reference bundled files with relative paths such as `scripts/tool.py`, not absolute placeholders.
- If a script exists, make it non-interactive and document `--help` with a concrete command.
- Prefer structured output on stdout and diagnostics on stderr for bundled scripts.
- Keep eval guidance inside the template body so it does not get dropped.
- Add `evals/evals.json` with at least 2 realistic prompts before considering the skill complete.
