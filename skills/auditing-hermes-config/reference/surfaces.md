# Evidence surfaces and limits

The audit keeps three surfaces separate:

1. **Application catalog.** Literal `DEFAULT_CONFIG` leaves plus conditional
   wildcard provider, MCP, platform, and open-dictionary families. This is an
   option catalog, not a document claiming every option coexists. Dynamic
   discovery is explicitly not proven complete.
2. **Native module catalog.** A bounded structural scan of the exact pinned
   `nix/nixosModules.nix`, with option metadata and a mapping label describing
   service behavior, generated application config, or config selection.
3. **Local evaluated state.** One read-only `nix eval` returns native
   `services.hermes-agent` and the Nix-generated application override key/type
   shapes, including the module-added `terminal.cwd`. Scalar
   values are replaced inside Nix before JSON serialization. A derivation-backed
   `configFile` remains unresolved without realization.

Normal source reads use GitHub contents endpoints with `?ref=<exact SHA>`.
Offline reads use `git show SHA:path`; source HEAD is irrelevant. Every citation
contains the SHA. Paths with a component exactly `_` are refused. Python source
is parsed only by a targeted literal extractor and is never executed.

Comparisons are conservative. Unknown paths become
`uncertain-needs-targeted-review`; stronger labels require exact-SHA source
proof. GitHub code search is used only for mismatches and is only discovery:
search results are never exact-revision evidence.

The generated override is not the final on-disk configuration: pure evaluation
cannot observe activation-time merging with mutable YAML. Catalog paths absent
from the evaluated shape therefore do not necessarily mean unconfigured.

`--latest` does not replace pinned evidence. It reads a second exact SHA and
records added, removed, and metadata-changed inventory paths under each
inventory's `latestComparison`.
