# Stage A.2.4 Producer Preservation and Export Design

## Intent

WebsiteBotScroll must produce one genuine `seo-crawl-evidence` 0.1.0 package from an explicitly authorized synthetic crawl and deliver it with the frozen Stage A.2.4 sidecar manifest. The package must be generated from evidence preserved during collection, not reconstructed from lossy summaries or hand-authored fixtures. This proves the file-based producer-to-consumer boundary before REST, MCP, strategic adapters, or operational integration are considered.

## Goals

- Preserve the observations needed by the canonical contract during an actual bounded crawl.
- Retain distinct URL identities, complete redirect transactions, ordered repeated allowlisted headers, provenance, configured limits, consumption, coverage, stop reason, limitations, and structured failures.
- Persist immutable run-local observation records with stable IDs and explicit collection states.
- Serialize deterministic UTF-8 JSON without a BOM and without silently changing evidence.
- Replay canonical validation and the accepted exchange-profile preflight against the exact serialized bytes that will be delivered.
- Generate the frozen sidecar manifest and verify its correspondence to those bytes.
- Demonstrate the path with an authorized synthetic target and independently reviewable execution results.

## Non-goals

- Customer-site crawling or production scheduling.
- Strategic SEO recommendations, prioritization, or site modification.
- REST, MCP, webhooks, or automated cross-repository transport.
- Browser rendering, Lighthouse, historical comparison, or external search data.
- Replacing the independent Python consumer or importing it as a runtime dependency.
- Expanding or revising the frozen canonical contract.

## Anti-goals

- Reconstructing unavailable observations from database summaries.
- Treating a completed run as complete discovery.
- Converting partial or unavailable evidence into observed empty values.
- Normalizing, rounding, truncating, reordering, defaulting, or repairing evidence during export.
- Allowing an exporter to read arbitrary files or crawl targets outside the explicit authorization scope.

## Constraints and frozen identities

- Canonical contract: `seo-crawl-evidence` `0.1.0`.
- Canonical WebsiteBotScroll revision: `bd45aa69c141deffed50c8d2ea57e28cea552cb8`.
- Canonical schema SHA-256: `8e06803f254b863a670418491aa85856208e75ae70b6bb77dcfde71cbc8787e8`.
- Exchange profile: `seo-crawl-evidence-exchange-profile/0.1.0`.
- The actual producer implementation commit is separate from the canonical revision and must be recorded as a full lowercase Git SHA in both `producer.version` and `producer_commit`.
- Evidence is UTF-8 without BOM. Its SHA-256 and byte length are calculated over the exact delivered bytes.
- Integers use ordinary decimal spelling, exclude negative zero, fraction and exponent notation, and remain within JavaScript's safe integer range.
- Timestamps use valid RFC 3339 with at most millisecond precision and no leap seconds.
- Strings contain valid Unicode scalar values. URL fields and complete URL-bearing `Link` and `Location` header values contain no backslash, C0 control, or DEL characters.

## Approaches considered

### Evidence-first vertical slice — selected

Extend the existing crawl path only as far as necessary to perform a small, real synthetic crawl, preserve its evidence, export it deterministically, and validate the delivered package. This yields the earliest trustworthy cross-language exchange while creating persistence primitives that later phases can extend.

### Complete observation platform first

Build generalized persistence and export support for every planned observation, renderer, diagnostic, and customer workflow before the first exchange. This offers a broader abstraction but delays validation and increases the risk of designing unused structures without real producer-consumer feedback.

### Export from existing summaries — rejected

Transform current crawl summaries into the contract at export time. Existing records do not preserve all required identities, transactions, headers, provenance, and collection states. This would fabricate or reconstruct evidence and violate the accepted boundary.

## System boundary

The implementation is a local producer pipeline:

1. An operator creates an authorization record for a named synthetic target and exact allowed scope.
2. The worker starts a bounded crawl whose configuration references that authorization.
3. Collection persists run, page, transaction, observation, provenance, limitation, and error evidence as it occurs.
4. A terminal run is frozen for export; ongoing or unauthorized runs are ineligible.
5. The exporter reads only persisted evidence for that run and creates the canonical document in memory without filling gaps.
6. The serializer emits deterministic UTF-8 JSON bytes to a new output file.
7. Canonical validation and producer profile preflight re-read and validate the exact file bytes.
8. Only after both pass does the producer create the frozen sidecar manifest from the validated bytes and persisted authorization.
9. A local verification command rechecks the pair and emits a producer receipt/log. Transfer remains manual and private.

The first exchange accepts only a manually triggered run. The worker's internal retry state is not a canonical trigger and must never be remapped silently.

## Persistence model

The existing crawl run remains the lifecycle anchor. New persistence must be additive and tenant-scoped. Ordered transactions and headers use normalized relational rows with explicit order columns. Immutable observation envelopes use relational identity and state columns, with JSON limited to contract-shaped observation values whose internal ordering is explicit.

### Authorization

An export authorization record contains a stable opaque reference, organization, synthetic target description, seed URLs, allowed hosts, optional include/exclude patterns, creator, creation timestamp, and explicit active/revoked state. It authorizes collection and export only for the recorded scope. The first exchange is rejected if the run scope differs from the authorization record.

### Run evidence

Persist producer and policy versions, trigger, lifecycle timestamps, configured limits, actual coverage counters, explicit stop reason, and run limitations. Coverage is updated transactionally and terminal consistency is checked before export.

### Page identity

Persist discovered, requested, normalized, final, and canonical URL values separately. Canonical declarations never merge page identities. Each page has a stable run-local ID and collection timestamps.

### HTTP transactions

Persist every redirect hop in order: transaction ID, request and response URLs, method, status, start/end timestamps, transferred and decoded byte counts, redirect target, and ordered allowlisted response headers. Header values retain their original order. Cookies, authorization, credentials, request secrets, raw HTML, and unrestricted headers are excluded.

### Observations

Each page observation group has a stable run-local ID, method, status, nullable value, reasons, provenance, optional field overrides, content hashes, and structured extraction failures. The first HTML slice records explicit `http`, `metadata`, `headings`, `structured_data`, `content`, and `links` envelopes. It records `rendering` as `not_collected` with `browser_rendering_disabled`. Source and future rendered observations remain separate. Missing collection is represented as unavailable/unsupported/partial according to the contract, never as an observed empty value.

### Errors and limitations

Persist structured stage, code, message, timestamp, retryability, and optional page/observation references. Limitations remain distinct from errors and may be scoped to a run or page.

Evidence child rows are append-only after collection. Run counters remain mutable collection state until a transactional terminal freeze checks lifecycle and coverage consistency. Terminal correction after freeze, if ever needed, creates an auditable superseding record rather than mutating delivered evidence.

## Collection changes

- URL normalization returns and persists identity components plus normalization-policy version.
- Robots and sitemap processing preserve evaluated URL, outcome, user agent, matched rule, declaration source, fetch chain, timestamps, and failures.
- HTTP fetching reports each hop through an evidence sink rather than returning only a final response summary.
- Queue payloads contain identifiers and bounded control data, never page bodies.
- Worker checkpoints are idempotent: retries reuse stable run/page identities and do not duplicate completed transactions or observations.
- Response bodies may be processed transiently for extraction but raw HTML is not stored or exported in this phase.

## Deterministic export

The exporter accepts a run ID, explicit destination directory, expected producer commit, and authorization reference. Before collection and again before export, it verifies the supplied full commit against repository `HEAD` and requires a clean source tree rather than trusting a caller-provided string. It rejects nonterminal runs, non-manual runs, failed consistency checks, scope mismatches, pre-existing output paths, and destinations outside the operator-selected directory.

Object member order and array order are deterministic. Arrays whose order is evidentiary—redirect transactions and repeated header values—retain collection order. Other collections use stable documented ordering, primarily run-local IDs. Evidence serialization is UTF-8 without BOM, two-space JSON, deterministic insertion order, and exactly one final LF; the checksum and byte length include that LF. The manifest uses the same deterministic UTF-8-without-BOM convention, although the accepted manifest hashes only the evidence bytes. No temporary object transformation may change evidence semantics.

The evidence filename is a safe generated basename and is never accepted as an input locator by verification code.

## Producer exchange-profile preflight

Preflight operates on raw bytes and parsed JSON while remaining separate from canonical validation. It checks:

- UTF-8 without BOM and valid Unicode scalar strings.
- Duplicate JSON members.
- Ordinary decimal integer tokens, no negative zero, and safe-range values.
- RFC 3339 timestamps with at most millisecond precision and no leap seconds.
- Backslash, C0, and DEL exclusion in URL fields and complete URL-bearing `Link` and `Location` values.
- Exact frozen contract and exchange-profile identities used for the export.

Failure produces structured issues and no eligible manifest. It never rewrites the evidence.

## Sidecar manifest

The manifest contains exactly the frozen fields:

- `contract`
- `exchange_profile`
- `contract_source_commit`
- `producer_commit`
- `schema_sha256`
- `evidence_sha256`
- `checksum_algorithm`
- `evidence_filename`
- `evidence_bytes`
- `run_id`
- `authorization_ref`
- `authorized_scope`
- `started_at`
- `finished_at`
- `coverage_limitations`
- `producer_validation`
- `producer_preflight`

It has no extra keys. It is created only after exact-byte canonical validation and profile preflight pass. The local producer verifier checks byte length and checksum before parsing, then checks type-sensitive manifest-to-evidence equality and the frozen identities. A manifest records correspondence and producer declarations; it does not cryptographically establish authenticity or independently prove authorization.

## Failure handling

- Collection failures become structured evidence where the contract permits them.
- Persistence failure stops or marks the run partial; it is never hidden as successful collection.
- An incomplete terminal run may be exportable only if its lifecycle, coverage, stop reason, reasons, and limitations truthfully describe the incomplete evidence.
- Serialization, validation, preflight, or manifest inconsistency leaves the candidate on hold and produces structured local diagnostics.
- Output files are written via a temporary file and atomic rename within the destination. Existing files are never overwritten.

## Security and privacy

- The crawler retains current SSRF and redirect-target validation at every hop.
- Only explicitly authorized synthetic hosts may be collected.
- The Stage A.2.4 target is a publicly reachable synthetic site controlled and explicitly authorized by the owner. The production network boundary remains active; no localhost/private-address resolver or transport bypass is introduced.
- Secrets and disallowed headers are rejected before persistence and again before export.
- Export paths are operator supplied, local, and bounded; manifest filenames cannot influence reads.
- Evidence and manifests remain private until separately approved for redistribution.
- Logs avoid raw page content, secrets, and unrestricted evidence values.

## Testing and acceptance

### Unit and property tests

- Stable identifiers, identity separation, coverage arithmetic, lifecycle consistency, ordered headers, redirect order, and observation state/value pairings.
- Serializer determinism and exact-byte repeatability.
- Every exchange-profile lexical boundary, including BOM, duplicate keys, unsafe integers, negative zero, exponent/fraction notation, invalid surrogates, excessive timestamp precision, leap seconds, backslash, C0, and DEL.
- Manifest type sensitivity, exact keys, safe basename handling, checksum/length mismatch, revision mismatch, and evidence-field mismatch.

### Database and worker integration tests

- Tenant isolation and authorization-scope enforcement.
- Idempotent retry without duplicated transactions or observations.
- Partial and failed collection preservation.
- Export rejection for ongoing, inconsistent, unauthorized, or lossy runs.

### Actual synthetic exchange acceptance

1. Commit the reviewed producer implementation and record its exact SHA.
2. Deploy or select a publicly reachable, owner-controlled synthetic site and create an explicit authorization for its exact scope.
3. Run the real worker/crawler against that target with bounded limits.
4. Export evidence and manifest from persisted observations.
5. Replay producer canonical validation and profile preflight against exact delivered bytes.
6. Record commands, results, limitations, provenance, checksums, byte length, and relevant logs without editing the package.
7. Deliver both files privately to SEO Engineering.
8. SEO Engineering independently verifies and returns its receipt.
9. Compare results without rewriting either artifact.

Stage A.2.4 completes only when both implementations accept the same delivered bytes and the joint review confirms that evidence originated from the authorized collection without fabrication.

## Delivery sequence

1. Add preservation-oriented database migrations and repositories.
2. Extend URL, robots, sitemap, fetch, and worker paths to emit preserved evidence.
3. Add observation-oriented snapshot persistence and idempotency.
4. Add deterministic evidence document construction and serialization.
5. Add producer exchange-profile preflight.
6. Add exact sidecar generation and local pair verification.
7. Run full security, contract, and repository verification.
8. Perform the authorized synthetic crawl and prepare the private exchange candidate.

Each step is independently reviewable and must keep existing repositories usable. The canonical contract package remains frozen unless a separately reviewed version decision is made.
