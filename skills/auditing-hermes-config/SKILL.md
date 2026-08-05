---
name: auditing-hermes-config
description: Audits revision-pinned Hermes runtime configuration, native NixOS module options, and host configuration. Use when reviewing Hermes defaults, migrations, validity, module wiring, or revision drift.
compatibility: Requires Node.js 20+. Nix is optional; static fallback is explicitly limited.
---

# Auditing Hermes Config

Keep three evidence surfaces separate: Hermes runtime configuration, the exact
`hermes-agent` NixOS module pinned in `flake.lock`, and target host-effective
configuration. Absence from defaults alone does not prove invalidity.

## Run

Set the installed skill directory and always identify the target explicitly:

```sh
SKILL_DIR=/absolute/path/to/skills/auditing-hermes-config
node "$SKILL_DIR/scripts/hermes-config-audit.mjs" discover --target-repo /path/to/nixos-config --source /exact/worktree --cache /outside/cache
node "$SKILL_DIR/scripts/hermes-config-audit.mjs" index --target-repo /path/to/nixos-config --source /exact/worktree --cache /outside/cache
node "$SKILL_DIR/scripts/hermes-config-audit.mjs" audit --target-repo /path/to/nixos-config --host marley --source /exact/worktree --cache /outside/cache --json /outside/reports/audit.json --markdown /outside/reports/audit.md
node "$SKILL_DIR/scripts/hermes-config-audit.mjs" compare --base /outside/base.json --target /outside/target.json
```

`--target-repo` is canonical. `HERMES_TARGET_REPO` and upward discovery are
fallbacks; `--repo` is a compatibility alias. Outputs and cache must be outside
the target, skills repository, and source worktree. Read
[surfaces](reference/surfaces.md) before interpreting results and the
[output schema](reference/output-schema.md) before consuming JSON.

## Discipline

Report **Proper**, **Repo today**, **Gap**, and **Path**. Treat unresolved values
and incomplete dynamic schemas as uncertainty, never as proof of invalidity.
`configFile` may bypass generated `settings`; do not realize derivations merely
to inspect it.

The tool is read-only. Never run Python, build, switch, deploy, rebuild, restart,
or edit target configuration. Snapshot permits at most one read-only `nix eval`
per host invocation, disables import-from-derivation, redacts scalar host values,
and falls back honestly when evaluation fails. Add
`--host-adapter hosts/marley/hermes/settings.nix` for tracked static local evidence;
without it static host evidence remains unresolved.

Static analysis is not effective configuration. Dynamic contracts and the
structural Nix parser can be incomplete; `configFile` content stays unresolved
without realization; offline Nix can fail. `--latest` is tested with a
deterministic fake `gh`; live GitHub availability is not tested. Target dirty
state is reported.
