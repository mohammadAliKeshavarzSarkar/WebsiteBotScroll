# Crawl Evidence Contract 0.1.0 Design

## Intent

Define the pre-stable, technology-independent evidence boundary between WebsiteBotScroll and optional consumers such as SEO Engineering. WebsiteBotScroll remains the authoritative producer and schema owner; consumers remain independently deployable and pin reviewed copies by version, source commit, and SHA-256 checksum.

This design implements **Stage A.1 — Crawl Evidence Contract Readiness**. It does not claim operational integration and does not add REST, MCP, browser rendering, external search integrations, or a dependency between repositories.

## Responsibility boundary

- WebsiteBotScroll owns authorized collection, observations, snapshots, deterministic diagnostics, canonical schema, authoritative fixtures, and TypeScript validation.
- SEO Engineering owns strategic context, interpretation, prioritization, implementation guidance, Python validation, optional adapters, and consumer review.
- Observations, deterministic diagnostics, and strategic intelligence remain distinct.

## Contract identity and ownership

- Contract name: `seo-crawl-evidence`.
- Development version: `0.1.0`.
- JSON Schema dialect: Draft 2020-12.
- Canonical location: `packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/schema.json`.
- Exact 0.x versions are pinned; no compatible-version inference is permitted yet.
- Schema, producer, extractor, renderer, normalization-policy, diagnostic-rule, adapter, and SEO-skill versions have independent lifecycles.
- `1.0.0` requires joint semantic review, TypeScript/Python compatibility, adapter tests, and one actual authorized synthetic-site producer-to-consumer exchange.

## Evidence semantics

The contract distinguishes crawl lifecycle, discovery coverage, collection completeness, observation status, and diagnostic outcome.

Observation states are:

- `observed`: collection established the supplied value.
- `partial`: some evidence was collected but coverage is incomplete.
- `unknown`: a reliable value cannot currently be established.
- `not_collected`: the supported operation was not performed.
- `failed`: collection was attempted and failed.
- `unsupported`: the producer cannot collect the information.
- `not_applicable`: the observation does not apply.

An observed empty array means successful inspected absence. An unavailable observation has `value: null` and structured reason codes. Partial arrays cannot support definitive absence claims. Operational completion does not imply complete site discovery.

## Initial Stage A data

The initial envelope contains:

- Schema and producer identity.
- Authorized run scope, trigger, lifecycle, configured limits, coverage, stop reason, and limitations.
- Stable page identity without conflating discovered, requested, normalized, redirected, final, or canonical URLs.
- Per-method page observations with group-level provenance and optional field-level overrides.
- HTTP transactions and redirect hops with repeated allowlisted headers.
- Initial HTML metadata, headings, structured-data parse results, content hashes, visible-text summary, and extraction errors.
- Internal link observations and their discovery method.
- Optional deterministic diagnostics referencing observation IDs.
- Structured collection errors and limitations.

Browser rendering, performance measurements, historical comparisons, external search data, and strategic project expectations are deferred to compatible future versions.

## HTTP header policy

The Stage A allowlist is case-insensitive and preserves repeated values per transaction:

- Essential: `Location`, `Content-Type`, `X-Robots-Tag`, `Link`, `Content-Language`.
- Recommended: `Content-Length`, `Content-Encoding`, `Retry-After`, `Cache-Control`, `Vary`, `ETag`, `Last-Modified`, `Age`.

Cookies, authorization values, credentials, signed URLs, and unrestricted request headers are excluded. Actual transferred and decoded bytes are independent from `Content-Length`.

## Identity and provenance

- Canonical declarations never merge page identity automatically.
- URL normalization is policy-controlled and versioned.
- Source and rendered observations are independent.
- Group-level provenance is standard; field-level overrides are allowed for independent origins or failures.
- Raw response bytes are not exported or retained by default.
- Raw-byte and normalized extracted-content SHA-256 hashes are separate and include methodology versions.
- Material diagnostics carry stable IDs, rule and policy versions, outcome, limitations, and observation references.

## Diagnostic semantics

Diagnostics are optional in the same package for Stage A. Their stage status is explicit when not executed. Outcomes are `pass`, `fail`, `inconclusive`, and `not_applicable`. Missing required evidence cannot produce `pass`. Technical findings do not imply strategic priority or implementation authorization.

## Validation

JSON Schema enforces structure, types, formats, closed objects, and status/value shapes. A semantic validator additionally enforces:

- Unique run-local page, observation, diagnostic, and error IDs.
- Resolved observation and subject references.
- Terminal timestamps and lifecycle consistency.
- Coverage arithmetic and nonnegative counters.
- Partial status with limitations or reason codes.
- Unavailable states with null values and reasons.
- Redirect-chain continuity and final-URL consistency.
- Diagnostic prerequisites and reference integrity.
- No complete-coverage or resolved-issue claims from incompatible or incomplete evidence.

Validators must not coerce types, apply defaults, remove unknown properties, accept non-finite numbers, or silently ignore unknown formats.

## Compatibility fixtures

Authoritative synthetic fixtures contain no customer data. Initial valid cases cover complete HTTP collection, observed absent metadata, partial collection, redirect chains, repeated headers, rendering not collected, malformed structured data as an observation, internal links, and Persian UTF-8. Invalid cases cover failed-as-empty, duplicate IDs, dangling references, inconsistent coverage, missing partial reasons, redirect mismatch, unexpected properties, and unsupported versions.

## Package boundary

```text
packages/evidence-contract/
├── package.json
├── schema/seo-crawl-evidence/0.1.0/
│   ├── schema.json
│   └── semantic-rules.md
├── src/
│   ├── types.ts
│   ├── validate.ts
│   └── semantic-validation.ts
├── fixtures/
│   ├── valid/
│   └── invalid/
└── test/
```

The package owns contract validation only. It does not query the database, crawl websites, execute diagnostics, or know SEO Engineering's internal directory layout.

## Existing-roadmap impact

Before Task 7 persists snapshots, Tasks 3–6 need narrowly scoped evidence-preservation extensions: normalization-policy identity; robots and sitemap provenance; HTTP transactions, repeated headers, redirect chains, structured errors, and timestamps; and crawl limits, consumption, coverage, and stop reason. Task 7 then persists observation-oriented snapshots. Later Tasks 8, 9, 13, and 14 add versioned diagnostics, comparison correctness, evidence export, and cross-language compatibility respectively.

## Acceptance boundary

Stage A.1 is complete when the canonical proposal, field semantics, fixtures, and TypeScript structural/semantic validators agree. This does not establish integration readiness. Stage A.2 requires WebsiteBotScroll to export an actual authorized synthetic crawl that SEO Engineering validates and projects without fabricated data.
