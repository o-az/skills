# Evidence surfaces and limits

## Boundaries

The target is selected by `--target-repo`, then `HERMES_TARGET_REPO`, then upward
discovery of a `flake.lock` with `nodes.hermes-agent.locked.rev`. `flake.lock`
and host adapters must be Git-tracked. Every upstream source read is from a
required path present in the selected commit's `git ls-tree`; paths containing a
component exactly `_` are refused.
The exact source worktree's `HEAD` must equal the requested SHA. Paths are
enumerated from that object with `git ls-tree` and read with `git show`; dirty
source worktree files therefore cannot affect evidence.

Cache, indexes, temporary outputs, snapshots, and reports stay outside target,
skills repository, and source worktree. Indexes are recomputed from immutable Git
objects rather than trusted from mutable cache files. Python is parsed, never
executed.

## Runtime and platform contracts

The JavaScript literal lexer ignores comments and understands quoted literals,
collections, booleans, null, and simple numeric arithmetic. It extracts defaults,
root sets, provider fields/aliases, platform container keys and concrete schemas
where present. Provider unknown fields are called ignored only when the pinned
normalizer proves rejection. Platform extraction records completeness; unknown
fields remain uncertain if rejection cannot be proven.

MCP shapes fail closed: known top-level server fields and explicitly supported
nested leaves can be valid; unsupported ancestors or nested leaves are uncertain.
Collision-safe `toolUnresolved: true` tool records remain atomic uncertainty
records. A genuine `$unresolved` key is ordinary user data.

## Native module and host

Structural Nix extraction recognizes `mkOption`, `mkEnableOption`, nested attrsets,
and wildcard `mcpServers.<name>` options without assuming a fixed option count.
Metadata and exact-SHA citations retain line, URL, and excerpt.

Snapshot makes at most one `nix eval` call. It asks the target flake for one host,
uses JSON-safe values, disables import-from-derivation, is offline/read-only, and
never deliberately realizes a build. Reports retain key/type shape but redact
all scalar host values. Static evidence
requires an explicit tracked `--host-adapter` and never guesses target layout.
Derivation-backed
`configFile` contents remain unresolved. Failed/disabled evaluation uses tracked
static host evidence and explicitly limits every host-effective conclusion.
