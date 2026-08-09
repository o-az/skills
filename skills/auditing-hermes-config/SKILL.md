---
name: auditing-hermes-config
description: Audits exact-revision Hermes application options, native NixOS module options, and one host's evaluated configuration.
compatibility: Requires Node.js 20+, Python 3, GitHub CLI authentication, and normally Nix.
---

# Auditing Hermes Config

Run the one read-only command:

```sh
node scripts/hermes-config-audit.mjs audit --target-repo /path/to/nixos-config --host HOST
```

It gets owner, repository, and exact SHA from the target's `flake.lock`,
checks `gh auth status`, enumerates that SHA's tree once, resolves bounded
Hermes-specific source roles by semantic signatures, and reads only selected
files through `gh api`,
and performs exactly one `nix eval`. It writes mode-0600 JSON and Markdown to
`$XDG_STATE_HOME/hermes-config-audit` (or `~/.local/state/...`) and prints both
paths. `--output-dir` may select another directory outside both repositories.
GitHub reads follow the [`gh api` manual](https://cli.github.com/manual/gh_api).

Use `--source /git/repository` offline; the repository need only contain the
pinned commit because reads use `git show SHA:path`. `--no-nix` is an explicitly
incomplete fallback. `--latest` keeps the pinned inventories authoritative and
adds an explicit comparison with the current GitHub HEAD, so it still requires
authenticated `gh` even when pinned reads use `--source`.

The target only needs to be a readable directory containing `flake.lock`; Git
history is not required. Never execute upstream Python,
realize/build/switch/deploy/restart Nix, or infer
invalidity merely from absence in defaults. Read [surfaces](./reference/surfaces.md)
and [output schema](./reference/output-schema.md) when interpreting results.
