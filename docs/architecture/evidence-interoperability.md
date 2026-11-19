# Evidence interoperability

WebsiteBotScroll owns the canonical `seo-crawl-evidence` contract. Version `0.1.0` is a pre-stable Stage A.1 proposal for consumer review, not an operational integration guarantee.

## Canonical review bundle

- Draft 2020-12 schema: `packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/schema.json`
- Field dictionary and semantic rules: beside the schema
- TypeScript structural and semantic validators: `packages/evidence-contract/src`
- Authoritative synthetic fixtures: `packages/evidence-contract/fixtures`
- Machine-readable paths, policies, and SHA-256 values: `packages/evidence-contract/review-manifest.json`

Consumers should pin the exact contract version, WebsiteBotScroll source commit, schema checksum, and fixture checksums. No 0.x compatible-version inference is permitted. The TypeScript validator is authoritative for WebsiteBotScroll; SEO Engineering may maintain a reviewed Python implementation without creating a runtime repository dependency.

## Responsibility boundary

WebsiteBotScroll collects authorized evidence and owns observation semantics. SEO Engineering owns strategic interpretation, priority, and implementation guidance. Deterministic diagnostics remain optional and separate from strategic intelligence. The contract never authorizes a change to a customer site.

Stage A.1 ends with agreement on schema, fields, fixtures, and validators. Stage A.2 begins only when WebsiteBotScroll exports an actual authorized synthetic crawl and the consumer validates it without fabricated evidence. REST and MCP transport are deferred until the file/package exchange is proven.

## Security and privacy

Raw HTML is excluded by default. The header allowlist is pinned in the manifest and preserves repeated values in order. Cookies, authorization, credentials, unrestricted request headers, and signed request data are excluded. Validators reject URL userinfo and recognizable signing/query-secret names; producers remain responsible for redacting sensitive URL-bearing header values that cannot be recognized generically. Raw-byte and normalized-content hashes are distinct.

## Reproducing checksums

From the repository root in PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/schema.json
Get-ChildItem packages/evidence-contract/fixtures -Recurse -Filter *.json | Get-FileHash -Algorithm SHA256
```

Schema, fixtures, and the manifest are pinned to LF in `.gitattributes`. Any schema or fixture change requires a reviewed version decision and regenerated `review-manifest.json` hashes. The review-bundle test independently recomputes every hash. Duplicate-member conformance is checked against raw JSON before `JSON.parse` because parsed objects cannot preserve duplicate keys.

## Deferred capabilities

Browser rendering, performance measurements, historical comparison, external search data, REST, MCP, Python consumer code, adapters, and strategic project expectations are outside Stage A.1. The first adapter sequence remains architecture, internal linking, then international SEO after Stage A.2 proves the evidence path.
