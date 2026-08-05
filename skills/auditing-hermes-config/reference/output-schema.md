# Output schema (schemaVersion 4)

Every document has `schemaVersion`, `command`, and command-specific data. Audit
documents exactly contain:

- `schemaVersion`, `command`, `generatedAt`, `readOnly`
- `provenance`: `{ selection, lockedSha, resolvedSha, owner, repo, targetRepo,
targetDirty, host }`, plus `resolvedAt` for `latest`
- `surfaces`: `{ runtime: { contracts, defaultCount }, module, host }`
- `findings[]`: `path`, `classification`, `reason`, plus optional `type`,
  `unresolved`, and `evidence`; scalar setting values are never emitted
- `moduleSummary`: `{ effectiveTopLevelValues, optionCoverage: "unavailable" }`
- `limits[]`
- `safety`: `{ performed, forbidden }`

Evidence is `{ source, line, url, excerpt }`; upstream URLs include the exact SHA.
Static or unresolved Markdown explicitly says it is not a complete audit.
Host documents preserve key/type/unresolved shape but redact scalar values. Report
files are mode `0600`.
The machine-readable schema is [audit.schema.json](audit.schema.json).

Useful `jq` queries:

```sh
jq -r '.provenance.resolvedSha' audit.json
jq -r '.findings[] | select(.classification == "uncertain-needs-targeted-review") | .path' audit.json
jq -r '.surfaces.module.options[] | [.path, .typeExpression] | @tsv' audit.json
jq -r '.limits[]' audit.json
```
