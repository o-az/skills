---
name: github-to-markdown
description: Converts a GitHub repository, directory, or file into a single markdown document using 2md. Use when asked to convert a repo to markdown, flatten GitHub code into one file, dump a repo for an LLM, bundle source for a prompt, snapshot GitHub code, or use 2md.
license: MIT
compatibility: Requires internet access and either curl or Bun/Node.js for the optional CLI path
metadata:
  author: github.com/o-az
  version: "1.0.0"
---

# github-to-markdown

Use [2md](https://github.com/o-az/2md) to turn a GitHub repository, subdirectory, or single file into one markdown document.

## When to auto-trigger

- The user wants a GitHub repo converted into one markdown file.
- The user wants to feed a repo, folder, or file into an LLM or prompt as a single document.
- The user asks to flatten, concatenate, dump, bundle, snapshot, or export GitHub code into markdown.
- The user wants a specific GitHub repo, directory, file, or filtered subset bundled into markdown.
- The user wants to include or exclude files while generating the markdown bundle.
- The user asks to use 2md or wants a rerunnable 2md command.
- Do not use this skill for local non-GitHub directories unless the user explicitly wants GitHub-hosted input.
- Do not use this skill for generic web scraping or for converting markdown into some other format.

## Requirements

- Network access to `https://2md.sauce.wiki`
- Either:
  - `curl`, or
  - Bun with `bunx`, or
  - Node.js with `npx --yes` as a fallback when `bunx` is unavailable

## Inputs

Accepted source forms:

- Full GitHub repo URL: `https://github.com/owner/repo`
- Repo shorthand: `owner/repo`
- Directory URL: `https://github.com/owner/repo/tree/<ref>/path/to/dir`
- File URL: `https://github.com/owner/repo/blob/<ref>/README.md`
- Path shorthand accepted by the CLI:
  - `owner/repo/path/to/dir`
  - `owner/repo/README.md`

Optional query params:

- `include=.ts`
- `include=.tsx`
- `exclude=.test.ts`
- `exclude=dist/`
- `submodules=true`

Supported filter pattern styles:

- suffix match like `.test.ts`
- directory match like `src/`
- glob match like `*.test.*`
- contains match like `test`

## Instructions

### 1. Normalize the target

First classify the request as one of these target types:

- repo
- directory
- file
- filtered subset of a repo

If the user gives repo shorthand or owner/repo/path shorthand, convert it into one of these 2md target path forms:

- repo: `github.com/owner/repo`
- directory: `github.com/owner/repo/tree/<ref>/path/to/dir`
- file: `github.com/owner/repo/blob/<ref>/path/to/file`

Rules:

- Preserve the branch or ref from the user input whenever it is present.
- Do not invent `main` unless you have verified that it is the intended ref.
- Do not widen scope. If the user asked for a file or directory, do not silently bundle the whole repo.
- Treat “specific set of files” as a filtered repo or filtered directory request using `include` and `exclude` params.
- If the user gives a local path like `./src` or `/tmp/project`, this skill is usually not the right tool.

### 2. Prefer the hosted HTTP endpoint

For direct retrieval, use the 2md endpoint:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo"
```

Directory example:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo/tree/<ref>/src"
```

File example:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo/blob/<ref>/README.md"
```

With filters:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo?include=.ts&exclude=.test.ts"
```

With submodules:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo?submodules=true"
```

When the user wants a saved artifact, write the response to a local file:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/owner/repo" -o repo.md
```

If 2md returns an HTTP error, surface the status and response body instead of guessing. Prefer `--fail-with-body` so HTTP failures do not get treated as successful markdown output. Common failures include private repos, nonexistent repos, bad paths, rate limits, timeouts, and other upstream fetch failures.

### 3. Use the CLI when it is a better fit

Use the CLI when the user explicitly wants a command they can rerun locally.

Prefer `bunx` first. If `bunx` is unavailable, fall back to `npx --yes`.

Preferred examples:

```bash
bunx github:o-az/2md o-az/2md > repo.md
bunx github:o-az/2md o-az/sandbox/src > src.md
bunx github:o-az/2md https://github.com/honojs/hono/blob/main/README.md > README.bundle.md
```

Fallback examples:

```bash
npx --yes github:o-az/2md o-az/2md > repo.md
npx --yes github:o-az/2md o-az/sandbox/src > src.md
npx --yes github:o-az/2md https://github.com/honojs/hono/blob/main/README.md > README.bundle.md
```

The CLI also accepts full GitHub URLs.

### 4. Choose filters carefully

When the user wants a smaller bundle for LLM context, prefer targeted `include` and `exclude` params.

Use filters to narrow scope, not to broaden it.

Examples:

- TypeScript only:

  ```text
  ?include=.ts&include=.tsx
  ```

- Exclude tests:

  ```text
  ?exclude=.test.ts&exclude=.spec.ts
  ```

- Include source, exclude tests:

  ```text
  ?include=src&exclude=*.test.ts
  ```

- Filter a specific directory instead of the whole repo:

  ```text
  https://2md.sauce.wiki/github.com/owner/repo/tree/<ref>/src?include=.ts&exclude=.test.ts
  ```

If the requested bundle could become very large, warn the user and suggest `include` and `exclude` filters before returning a huge inline response.

### 5. Return the right thing

- If the user asked you to do the conversion and save an artifact, execute it and report the exact output file path.
- If the user asked for a rerunnable workflow, return the exact 2md URL, CLI command, or both.
- If the user asked for the markdown content itself, return the generated markdown or the specific excerpt they asked for.
- If the generated markdown is too large to return comfortably inline, say so and offer to save it to a file or narrow it with filters.

## Agent checklist

1. Classify the target as repo, directory, file, or filtered subset.
2. Preserve the branch or ref from the input.
3. Prefer the hosted endpoint unless the user asked for a rerunnable CLI command.
4. Do not widen scope.
5. Use filters only to narrow scope.
6. Report the exact output file path when saving locally.
7. On failure, report the HTTP status and response body instead of fabricating output.

## Quick reference

Show a whole repo as markdown:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md"
```

Show a subdirectory as markdown:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md/tree/main/scripts"
```

Show a single file as markdown:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md/blob/main/bunfig.toml"
```

Show a smaller LLM-focused bundle:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md?include=.tsx&include=.mjs"
```

Save a whole repo locally:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md" -o o-az-2md.md
```

Save a subdirectory locally:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md/tree/main/scripts" -o o-az-2md-scripts.md
```

Save a single file locally:

```bash
curl --silent --show-error --fail-with-body --location "https://2md.sauce.wiki/github.com/o-az/2md/blob/main/bunfig.toml" -o o-az-2md-bunfig-toml.md
```
