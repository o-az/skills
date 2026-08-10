# Evidence surfaces and limits

The audit keeps three surfaces separate:

1. **Application catalog.** Literal `DEFAULT_CONFIG` leaves plus conditional
   wildcard provider, MCP, platform, and open-dictionary families. This is an
   option catalog, not a document claiming every option coexists. Dynamic
   discovery is explicitly not proven complete.
2. **Native module catalog.** A bounded structural scan of the semantically
   resolved native Hermes NixOS module at the exact pinned revision, with option
   metadata and a mapping label describing service behavior, generated
   application config, or config selection.
3. **Local evaluated state.** One read-only `nix eval` returns native
   `services.hermes-agent` and the Nix-generated application override key/type
   shapes, including the module-added `terminal.cwd`. Scalar
   values are replaced inside Nix before JSON serialization. A derivation-backed
   `configFile` remains unresolved without realization.

Normal discovery enumerates the exact revision's Git tree once, validates
preferred locations by strong Hermes-specific capability signatures, and uses
bounded deterministic fallback candidates when files move or split. A truncated
recursive GitHub tree is rebuilt with bounded exact-tree traversal. Normal file
reads use GitHub contents endpoints with `?ref=<exact SHA>`. Offline discovery
uses `git ls-tree` and reads use `git show SHA:path`; source HEAD is irrelevant.
Every citation contains the SHA. Paths with a component exactly `_` are refused.
Python source is parsed as syntax with Python's standard `ast` module and is
never executed. Missing or unsupported semantic roles are explicit report
metadata; foundational gaps stop inventory construction.

Comparisons are conservative. Unknown paths become
`uncertain-needs-targeted-review`; stronger labels require exact-SHA source
proof. The normal audit does not use GitHub code search: exact-path defaults,
known structural containers, and a small pinned set of direct consumers and
official docs are compared first. Any future search result is discovery only
and cannot replace exact-revision evidence.

The generated override is not the final on-disk configuration: pure evaluation
cannot observe activation-time merging with mutable YAML. Catalog paths absent
from the evaluated shape therefore do not necessarily mean unconfigured.

`--latest` does not replace pinned evidence. It reads a second exact SHA and
records added, removed, and metadata-changed inventory paths under each
inventory's `latestComparison`.
