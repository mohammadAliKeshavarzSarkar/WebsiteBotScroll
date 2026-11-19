# Generalized Observation Platform Design

## Intent

WebsiteBotScroll will complete a generalized, tenant-safe observation platform before producing its first interoperability package. The platform must preserve evidence from current HTTP/HTML collectors and future source collectors, browser renderers, performance tools, external providers, diagnostic rules, and export projections without adding a new persistence model for every observation type.

This deliberately replaces the earlier evidence-first sequencing. The accepted `seo-crawl-evidence` 0.1.0 exchange remains a required projection, but its first real package is deferred until the generalized model has been exercised by real collection tests.

This document supersedes the delivery sequence—but not the frozen interoperability constraints—in `2026-11-19-stage-a2-producer-export-design.md`.

## Goals

- Register immutable, versioned observation-type definitions owned initially by WebsiteBotScroll engineering.
- Persist immutable collection executions separately from the observations they emit.
- Support run-, page-, resource-, site-, and cross-page-scoped observations.
- Validate observation payloads, reasons, provenance, and status against the exact definition version used at collection time.
- Preserve large or binary evidence through content-addressed artifact metadata without placing raw bodies in JSON columns.
- Model renderer sessions and their artifacts without coupling the core model to Chromium.
- Register immutable diagnostic rule versions and persist rule executions, evidence dependencies, outcomes, limitations, and errors.
- Produce versioned export projections that transform frozen platform snapshots into external contracts without mutating source evidence.
- Preserve tenant isolation, idempotency, stable identities, ordered evidence, and freeze semantics.

## Non-goals

- Customer-authored observation definitions in the first release.
- Executable plug-ins uploaded by customers.
- A public marketplace, REST API, MCP server, or cross-repository runtime dependency.
- Storing raw HTML, credentials, cookies, unrestricted headers, or signed request material.
- Replacing PostgreSQL with an event-stream database or schema-less document store.
- Predicting every future payload shape in relational columns.

## Chosen architecture

The platform uses an engineering-controlled, versioned definition registry with immutable JSON Schemas. Observation envelopes and common query fields remain relational; type-specific payloads remain JSON and are validated on write against the pinned definition. Definitions are append-only by `(key, version)` and include scope, payload schema, allowed statuses, sensitivity classification, retention class, and compatibility metadata.

This is preferred over free-form JSON because invalid or ambiguous evidence must not enter persistence, and over one relational table per observation because that would require migrations for every future collector. Customer-defined types can later use the same registry after governance, quotas, and schema-safety controls exist.

## Core model

### Definition registry

`ObservationDefinition` identifies a stable semantic key such as `page.metadata`, an immutable semantic version, JSON Schema, allowed scopes and statuses, payload sensitivity, retention class, and lifecycle state. Published definitions cannot be edited or deleted; correction publishes a new version. A deterministic schema SHA-256 detects accidental drift.

`CollectorDefinition` identifies a collector/renderer/provider implementation and version, its configuration schema, supported observation definitions, and execution mode. Definitions describe capability; executions record what actually happened.

Definitions are global, system-owned records rather than tenant data. Only an internal publication repository may create or change their lifecycle. All subjects, executions, observations, artifacts, diagnostics, snapshots, and export executions are tenant-owned and require `organizationId` on every repository operation.

### Subjects

Every observation references one explicit subject through a typed subject record. Initial subject kinds are `run`, `page`, `resource`, `site`, and `cross_page`. Subject identity contains only stable references and normalized identity metadata. Cross-page subjects use ordered subject-member rows so diagnostic relevance is explicit.

### Executions and observations

`ObservationExecution` records one attempt by a pinned collector definition: tenant, run, optional parent execution, trigger, configuration snapshot, start/end timestamps, lifecycle, environment metadata, and structured failure. Retries create attempts under the same stable execution key; successful persisted output is idempotent.

`ObservationRecord` references the exact definition version, subject, and execution. It stores status, payload, reasons, provenance, hashes, collection timestamps, and sequence. The repository validates schema, status/value pairing, scope, tenant ownership, definition publication state, safe integers, and stable-ID conflicts before insertion. Records are immutable after insertion and frozen transitively with their run snapshot.

`observed` and `partial` records require a non-null payload that validates against the pinned schema; `partial` additionally requires at least one reason. `unknown`, `not_collected`, `failed`, `unsupported`, and `not_applicable` require `null` and at least one reason.

### Artifacts and renderers

`EvidenceArtifact` stores metadata for content-addressed bytes: SHA-256, byte length, media type, storage locator, sensitivity, retention class, creation time, and availability state. The database never treats a locator as trusted input. Observation-to-artifact links carry a role and deterministic order.

Renderer work is an ordinary collector execution with a renderer-specific session record containing engine/version, viewport, locale, user agent, timing policy, and terminal state. Screenshots, traces, DOM snapshots, and performance outputs are artifacts or observations. Raw artifacts remain excluded by default and require an explicit allowlisted retention policy.

Artifacts referenced by a frozen snapshot are retention-pinned until every referencing snapshot and export is deleted through a future governed workflow. This phase permits neither deletion nor tombstoning of frozen dependencies. Unfrozen orphan cleanup may mark metadata unavailable only after confirming zero references; atomic store writes use temporary content, hash/length verification, exclusive final creation, and crash cleanup.

### Diagnostics

`DiagnosticRuleDefinition` is immutable and versioned. It declares accepted observation definition versions/scopes, configuration schema, outcome vocabulary, and policy version. `DiagnosticExecution` pins the rule version and snapshot, while `DiagnosticResult` records subject, outcome, message data, limitations, and ordered input observation references. A result cannot claim success if required inputs are unavailable unless the rule definition explicitly supports that state.

### Export projections

`ExportProjectionDefinition` identifies an immutable adapter version, target contract identity, accepted platform definition versions, and configuration schema. `ExportExecution` pins a frozen snapshot and projection version, records exact producer revision and validation results, and emits content-addressed artifacts. Projection code reads immutable records and must never repair, default, or rewrite source evidence. The first projection remains `seo-crawl-evidence/0.1.0` with the accepted exchange profile and sidecar conventions.

## Lifecycle and immutability

Definitions move from `draft` to `published` to `deprecated`; published content is immutable. Executions move through `pending`, `running`, and terminal states. Observations and diagnostic results are append-only. A dedicated snapshot repository owns the single freeze transaction and verifies terminal execution states, coverage, tenant ownership, subject integrity, artifact availability, and dependency closure. Correction/supersession workflows are deferred; delivered or frozen records are never mutated.

## Security, tenancy, and privacy

- Every tenant-data repository operation receives and verifies `organizationId`; relationships cannot cross tenants. Global definition publication uses a separate internal-only repository.
- JSON Schemas are data, not executable code; remote references and dynamic code loading are prohibited.
- Schema complexity, payload bytes, nesting, array sizes, artifact bytes, and execution duration are bounded.
- Definition sensitivity and retention policies are enforced before persistence and export.
- Secrets and disallowed HTTP material are rejected before artifact creation and again at projection boundaries.
- Artifact storage uses content-addressed keys and server-selected paths; callers never supply filesystem paths.
- Logs contain identifiers and structured issue codes, not raw sensitive payloads.

## Compatibility and migration

Existing `EvidenceObservation` rows are migrated through an explicit mapping from current methods (`http`, `metadata`, `headings`, `structured_data`, `content`, `links`, `rendering`) to published definition versions. Existing stable IDs remain external aliases. Transactions and ordered headers remain normalized evidence records and are referenced by `page.http` observations rather than duplicated.

Migration runs in expand/backfill/verify/switch/contract phases. The old repository remains readable until parity tests prove the generalized snapshot contains equivalent evidence. No destructive schema removal occurs in this project phase.

During dual write, the legacy store remains authoritative. One database transaction writes legacy and generalized rows through a single facade; either both commit or neither commits. Retry uses the existing stable event identity in both stores. Backfill is idempotent and records a checkpoint plus parity digest per run. Reads switch per run only after parity succeeds; existing frozen legacy runs remain legacy-only and cannot be exported through the generalized projection. The contract/removal phase is explicitly outside this project.

## Fixed platform limits and identifiers

- Definition keys match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`; versions are strict SemVer `MAJOR.MINOR.PATCH` without prerelease/build suffixes in this phase.
- Stable IDs are namespace-separated SHA-256 identifiers over length-prefixed UTF-8 components; execution attempts additionally include a non-negative safe-integer attempt number.
- Schema documents and observation payloads are at most 1,048,576 UTF-8 bytes, nesting depth 32, 1,024 object properties in aggregate, and 10,000 array items in aggregate.
- Artifact byte limits are policy supplied and may not exceed 50 MiB per artifact or 250 MiB per execution in this phase.
- Definition states are `draft`, `published`, `deprecated`; execution states are `pending`, `running`, `completed`, `partial`, `failed`, `cancelled`; snapshot states are `building`, `frozen`, `failed`.
- Validation returns `{ valid: true }` or `{ valid: false, issues: Array<{ code: string; path: string; message: string }> }` and never repairs input.
- Application repositories are the immutability trust boundary in this phase; database constraints enforce uniqueness and referential integrity, while repository integration tests prove mutation is unavailable.

## Acceptance

- Registry rejects mutation, unsafe schemas, unknown versions, and incompatible scope/status combinations.
- Repository tests prove tenant isolation, idempotent retry, immutable conflicts, payload validation, ordered subjects/artifacts, and freeze closure.
- Current HTTP/HTML collection persists through the generalized API with no loss of Persian Unicode, URL identities, repeated headers, unavailable states, provenance, or limitations.
- A synthetic renderer collector proves session/artifact extensibility without browser coupling in core persistence.
- Diagnostic tests prove pinned inputs, cross-page relevance, unavailable-input behavior, and deterministic reruns.
- Two projections—a canonical evidence projection and an internal neutral snapshot—prove export adapters do not shape source persistence.
- Full lint, typecheck, migration, unit, integration, and build gates pass with a real PostgreSQL test database.

## Delivery sequence

1. Definition registry and validation policy.
2. Subjects, executions, generalized observations, artifacts, and freeze semantics.
3. Migration adapter for current HTTP/HTML collection.
4. Renderer session and artifact extension proof.
5. Diagnostic registry, execution, and evidence dependency graph.
6. Projection registry and neutral snapshot boundary.
7. Rebuild the accepted `seo-crawl-evidence` producer on the generalized snapshot.
8. Perform the first verified synthetic exchange.

