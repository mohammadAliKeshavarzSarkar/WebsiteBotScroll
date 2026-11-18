# Evidence preservation gaps before Task 7

The 0.1.0 contract is deliberately ahead of the current crawler. These are the minimal preservation changes required before snapshot persistence; Stage A.1 does not implement them.

## Task 3 — URL normalization and identity

Current normalization returns one normalized URL. Preserve the normalization-policy version and the separate discovered, requested, normalized, redirected/final, and canonical values. Do not merge page identities from canonical declarations.

## Task 4 — robots and sitemap provenance

Preserve the robots URL, fetch/parse outcome, evaluated user agent, matched rule, evaluation timestamp, sitemap declaration source, sitemap fetch chain, and structured failures. Discovery output alone is insufficient evidence.

## Task 5 — HTTP transaction evidence

Preserve every redirect transaction, request/response URL, method, status, start/end timestamps, ordered repeated allowlisted response headers, redirect target, transferred bytes, decoded bytes, and structured failure. Continue revalidating every redirect target against the network boundary. Do not store cookies, authorization, credentials, raw HTML, or unrestricted headers.

## Task 6 — run limits and coverage

Persist configured limits separately from actual consumption. Add discovered, attempted, collected, failed, and unattempted coverage counters; explicit stop reason; run limitations; producer and policy versions; and terminal timestamp consistency. A completed job must not imply complete discovery.

The existing worker checkpoints URL progress but does not yet start the complete BullMQ crawl worker path. Worker wiring must preserve idempotency and lifecycle evidence without embedding page bodies in queue payloads.

## Task 7 — observation-oriented snapshots

Persist immutable page identity and per-method observation groups with stable run-local IDs, status, value, reasons, group provenance, optional field overrides, extraction errors, and content hashes. Store source and rendered observations independently. Export from these preserved records into the canonical package rather than reconstructing evidence from lossy summaries.

## Later roadmap impact

- Task 8 adds versioned deterministic diagnostics that reference observation IDs.
- Task 9 compares compatible observations and distinguishes unavailable evidence from change.
- Task 13 exports authorized evidence packages with the pinned contract identity.
- Task 14 adds cross-language compatibility and the Stage A.2 producer-to-consumer exchange.

No database, crawler, queue, or worker behavior is changed by this document. Each preservation change requires its own implementation plan and migration review.
