# Output schema

The JSON report uses `schemaVersion: 5` and has exactly these top-level fields:

- `schemaVersion`: report contract version
- `provenance`: lock identity, selected exact SHA, target, host, and backend
- `applicationInventory`: option entries and an honest completeness statement
- `moduleInventory`: native option entries and completeness statement
- `local`: redacted evaluated native and Nix-generated override key/type shapes,
  or an
  unavailable reason
- `comparison`: catalog paths present or absent in the evaluated shapes plus
  application/module mismatches; it does not claim which values were explicitly
  assigned by local source
- `limits`: unresolved and completeness qualifications

Application entries include path, default and observed default shape where
available, source-established expected shape, confidence, conditions, migration
status, and exact-SHA evidence. A default alone is not treated as an accepted
type contract. Module
entries include path, type, default, example, description, mapping, and evidence.
With `--latest`, each inventory also contains `latestComparison` with the exact
latest SHA and added, removed, and changed paths; pinned inventory evidence stays
authoritative.
The machine-readable contract is [audit.schema.json](audit.schema.json). Both
JSON and Markdown reports are created with mode `0600`.
