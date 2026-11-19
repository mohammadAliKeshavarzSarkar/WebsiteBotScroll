# Stage A.2.4 Producer Preservation and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve evidence from a real authorized synthetic crawl and export an exact-byte `seo-crawl-evidence` 0.1.0 package with the frozen Stage A.2.4 sidecar manifest.

**Architecture:** Extend the existing crawler and worker through an append-only, tenant-scoped evidence repository, then build the canonical document from frozen terminal records. A separate producer package serializes deterministic bytes, replays canonical validation and exchange-profile preflight against those bytes, and only then writes the sidecar manifest.

**Tech Stack:** Node.js 26, TypeScript 5.9, pnpm, PostgreSQL 17, Prisma 7, BullMQ, Cheerio, Ajv/Vitest, JSON Schema Draft 2020-12.

**Spec:** `docs/superpowers/specs/2026-11-19-stage-a2-producer-export-design.md`

## Global Constraints

- Canonical contract `seo-crawl-evidence` `0.1.0`, source revision `bd45aa69c141deffed50c8d2ea57e28cea552cb8`, schema SHA-256 `8e06803f254b863a670418491aa85856208e75ae70b6bb77dcfde71cbc8787e8`.
- Exchange profile `seo-crawl-evidence-exchange-profile/0.1.0`; do not modify the canonical schema or fixtures.
- Evidence must originate from persisted collection, never reconstructed summaries or hand-authored fixtures.
- First export supports only `MANUAL` terminal runs for a publicly reachable, explicitly authorized synthetic host.
- Keep SSRF checks active at every redirect; introduce no loopback/private-address bypass.
- Exclude raw HTML, cookies, authorization, credentials, unrestricted headers, and signed request data from persistence and export.
- Evidence bytes are UTF-8 without BOM, two-space JSON, deterministic insertion order, and exactly one final LF.
- Integers use ordinary decimal notation within `[-9007199254740991, 9007199254740991]`; timestamps have at most millisecond precision and no leap seconds.
- Do not overwrite output files. Validation and preflight must re-read the exact delivered evidence bytes.
- Preserve unrelated local changes in generated Prisma files, `apps/web/next-env.d.ts`, and tool metadata unless a task explicitly regenerates an owned artifact.

## Review Focus

- A retry after partial persistence must reuse stable IDs and must not duplicate transactions, headers, or observations; Task 5 pins this with an integration test.
- A terminal but incomplete crawl must preserve partial/unavailable states, coverage, stop reason, and limitations instead of becoming a complete empty result; Tasks 2 and 5 pin this.
- Redirects to private addresses must fail before a request while retaining the completed public-hop evidence and a structured error; Task 3 pins this.
- Exact-byte checks must fail on BOM, duplicate keys, unsafe numeric spelling, invalid Unicode, or any manifest/evidence mismatch without rewriting files; Tasks 7 and 8 pin this.
- Export must reject a dirty or mismatched producer revision, unauthorized scope, non-manual trigger, nonterminal run, and pre-existing destination; Tasks 6 and 8 pin this.

---

### Task 1: Evidence Domain Types and Stable Run-Local Identities

**Files:**
- Create: `packages/domain/src/evidence.ts`
- Create: `packages/domain/src/evidence.test.ts`
- Modify: `packages/domain/package.json`

**Interfaces:**
- Produces: `EvidenceRunConfiguration`, `PageIdentityInput`, `HttpTransactionInput`, `ObservationInput`, `EvidenceErrorInput`, `EvidenceLimitationInput`.
- Produces: `createEvidenceId(namespace: EvidenceIdNamespace, parts: readonly string[]): string`, returning deterministic run-local IDs.

- [ ] **Step 1: Write failing tests** for deterministic namespace-separated IDs, distinct URL identity fields, ordered header values, explicit observation status/value pairings, and safe integer bounds.
- [ ] **Step 2: Run `pnpm --filter @website-bot-scroll/domain test -- evidence`** and verify failure because the evidence module does not exist.
- [ ] **Step 3: Implement the exported types and `createEvidenceId`** using a SHA-256 digest of length-prefixed UTF-8 parts; do not accept ambiguous delimiter concatenation.
- [ ] **Step 4: Run `pnpm --filter @website-bot-scroll/domain test -- evidence && pnpm --filter @website-bot-scroll/domain typecheck`** and expect all checks to pass.
- [ ] **Step 5: Commit** with `git commit -m "feat: define preserved crawl evidence types"`.

### Task 2: Tenant-Scoped Evidence Persistence and Terminal Freeze

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_evidence_preservation/migration.sql`
- Create: `packages/db/src/repositories/evidence.ts`
- Create: `packages/db/src/repositories/evidence.integration.test.ts`
- Modify: `packages/db/package.json`

**Interfaces:**
- Consumes: Task 1 evidence inputs.
- Produces: `EvidenceRepository.appendPage`, `appendTransaction`, `appendObservation`, `appendError`, `appendLimitation`, `updateCoverage`, and `freezeRun`.
- Produces: `EvidenceRepository.loadFrozenRun(organizationId: string, runId: string): Promise<FrozenEvidenceRun>`.

- [ ] **Step 1: Write failing integration tests** proving tenant isolation, explicit transaction/header order, append idempotency by stable ID, observation immutability, coverage arithmetic, partial-run preservation, authorization-scope equality, and freeze rejection for inconsistent/nonterminal runs.
- [ ] **Step 2: Run the evidence repository tests with `TEST_DATABASE_URL`** and verify schema/model failures.
- [ ] **Step 3: Add normalized models** for export authorization, run configuration/coverage, page identities, transactions, ordered headers/values, observations, limitations, and structured evidence errors. Add uniqueness constraints for run-local identities and explicit order indexes.
- [ ] **Step 4: Implement `EvidenceRepository`** so child evidence is insert-only, counter updates are transactional, and `freezeRun` atomically checks manual trigger, terminal lifecycle, authorization scope, and coverage consistency.
- [ ] **Step 5: Run `pnpm db:generate`, deploy the migration to the test database, and rerun the evidence repository tests**; expect all tests to pass.
- [ ] **Step 6: Run `pnpm --filter @website-bot-scroll/db typecheck`** and verify generated client usage compiles.
- [ ] **Step 7: Commit** schema, migration, repository, tests, and generated Prisma client with `git commit -m "feat: persist immutable crawl evidence"`.

### Task 3: Lossless HTTP, Robots, Sitemap, and URL Provenance

**Files:**
- Create: `packages/crawler/src/evidence/events.ts`
- Modify: `packages/crawler/src/http/fetch-page.ts`
- Modify: `packages/crawler/src/http/fetch-page.test.ts`
- Modify: `packages/crawler/src/robots/fetch-robots.ts`
- Modify: `packages/crawler/src/robots/robots.test.ts`
- Modify: `packages/crawler/src/sitemap/discover.ts`
- Modify: `packages/crawler/src/sitemap/sitemap.test.ts`
- Modify: `packages/crawler/src/url/normalize.ts`
- Modify: `packages/crawler/src/url/normalize.test.ts`
- Modify: `packages/crawler/package.json`

**Interfaces:**
- Produces: `EvidenceSink.record(event: CrawlEvidenceEvent): Promise<void>` and discriminated `CrawlEvidenceEvent` variants.
- Changes: `fetchPage`, `loadRobots`, and `discoverSitemaps` accept an optional `evidenceSink` and stable context IDs; existing callers remain valid.

- [ ] **Step 1: Extend failing crawler tests** to assert separate discovered/requested/normalized/final/canonical identities, every redirect transaction, timestamps, byte counts, ordered repeated allowlisted headers, robots outcome/provenance, sitemap fetch chains, and structured failures.
- [ ] **Step 2: Add the review-focus test** where a public redirect hop points to a private address: assert no private request occurs, the completed hop remains recorded, and a structured network-boundary error is emitted.
- [ ] **Step 3: Run `pnpm --filter @website-bot-scroll/crawler test`** and verify failures against the current lossy result types.
- [ ] **Step 4: Implement the event interfaces and optional sink calls** without storing response bodies or disallowed headers. Change transport response headers to preserve repeated values and filter through the canonical allowlist.
- [ ] **Step 5: Run crawler tests, lint, and typecheck** and expect all to pass with existing no-sink behavior preserved.
- [ ] **Step 6: Commit** with `git commit -m "feat: preserve crawl transaction provenance"`.

### Task 4: HTML Observation Extraction

**Files:**
- Create: `packages/crawler/src/extract/html-observations.ts`
- Create: `packages/crawler/src/extract/html-observations.test.ts`
- Modify: `packages/crawler/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: HTML bytes, page identity, timestamps, policy/extractor versions.
- Produces: `extractHtmlObservations(input: HtmlObservationRequest): ObservationInput[]` with explicit `metadata`, `headings`, `structured_data`, `content`, `links`, and `rendering` envelopes.

- [ ] **Step 1: Write failing table-driven tests** for observed metadata, observed absence, repeated headings, malformed JSON-LD, relative links, Persian UTF-8, non-HTML/not-collected states, extraction failure, and `rendering:not_collected` with `browser_rendering_disabled`.
- [ ] **Step 2: Run `pnpm --filter @website-bot-scroll/crawler test -- html-observations`** and verify failure because the extractor is absent.
- [ ] **Step 3: Add Cheerio at an exact version and implement `extractHtmlObservations`** with stable IDs, provenance, source hashes, no raw-HTML return value, and no strategic conclusions.
- [ ] **Step 4: Run extraction tests, crawler lint, and typecheck** and expect all checks to pass.
- [ ] **Step 5: Commit** with `git commit -m "feat: extract observation-oriented page evidence"`.

### Task 5: Idempotent Authorized Synthetic Crawl Orchestration

**Files:**
- Modify: `apps/worker/src/jobs/run-crawl.ts`
- Modify: `apps/worker/src/jobs/run-crawl.integration.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `packages/queue/src/contracts.ts`
- Modify: `packages/queue/src/contracts.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 repositories, evidence sink, fetcher, and extractor.
- Produces: `executeAuthorizedCrawl(job: RunCrawlJob, dependencies: CrawlDependencies): Promise<CrawlExecutionResult>`.

- [ ] **Step 1: Write failing queue tests** requiring authorization reference, manual trigger, exact bounded limits, producer/policy versions, and no response body in payloads.
- [ ] **Step 2: Write failing worker integration tests** for a multi-page HTML crawl, redirects, repeated headers, unavailable observations, page limit, partial failure, and terminal freeze.
- [ ] **Step 3: Add the retry review-focus test**: interrupt after persisted transactions, replay the same job, and assert stable IDs with no duplicated transaction/header/observation rows.
- [ ] **Step 4: Run queue and worker tests** and verify failures because the complete worker path is not wired.
- [ ] **Step 5: Implement `executeAuthorizedCrawl`** using identifier-only queue payloads, persisted frontier checkpoints, the evidence sink, extraction, truthful coverage, stop reason, limitations, and final freeze.
- [ ] **Step 6: Run queue/worker tests, lint, and typecheck** and expect all checks to pass.
- [ ] **Step 7: Commit** with `git commit -m "feat: run authorized evidence-preserving crawls"`.

### Task 6: Canonical Evidence Document Builder

**Files:**
- Create: `packages/evidence-producer/package.json`
- Create: `packages/evidence-producer/tsconfig.json`
- Create: `packages/evidence-producer/src/build-document.ts`
- Create: `packages/evidence-producer/test/build-document.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `FrozenEvidenceRun` from Task 2 and a verified clean producer revision.
- Produces: `buildEvidenceDocument(run: FrozenEvidenceRun, identity: ProducerIdentity): EvidenceDocument`.
- Produces: `verifyProducerRevision(input: { repositoryRoot: string; expectedCommit: string }): Promise<void>`.

- [ ] **Step 1: Write failing tests** mapping frozen records to every required contract envelope while preserving Persian text, repeated header order, unavailable/partial states, URL identities, coverage, provenance, and limitations.
- [ ] **Step 2: Add rejection tests** for scheduled/retry triggers, nonterminal runs, scope mismatch, inconsistent coverage, dirty repository, and expected commit not equal to `HEAD`.
- [ ] **Step 3: Scaffold `@website-bot-scroll/evidence-producer` with workspace dependencies on domain, database, and evidence-contract, then run `pnpm --filter @website-bot-scroll/evidence-producer test -- build-document`** and verify failure because the builder is absent.
- [ ] **Step 4: Implement the pure builder and revision verifier**; do not add defaults for missing evidence and do not execute Git with interpolated shell strings.
- [ ] **Step 5: Run producer tests/lint/typecheck and the unchanged canonical contract suite** and expect all checks to pass.
- [ ] **Step 6: Commit** with `git commit -m "feat: build canonical evidence from frozen runs"`.

### Task 7: Exact-Byte Serialization and Producer Profile Preflight

**Files:**
- Create: `packages/evidence-producer/src/serialize.ts`
- Create: `packages/evidence-producer/src/exchange-profile.ts`
- Create: `packages/evidence-producer/test/serialize.test.ts`
- Create: `packages/evidence-producer/test/exchange-profile.test.ts`
- Modify: `packages/evidence-producer/package.json`

**Interfaces:**
- Produces: `serializeEvidence(document: EvidenceDocument): Uint8Array`.
- Produces: `preflightExchangeBytes(bytes: Uint8Array): ExchangeProfileResult` with structured issues and no repaired output.

- [ ] **Step 1: Write failing serializer tests** asserting byte-for-byte repeatability, two-space indentation, deterministic member/array order, UTF-8 without BOM, and exactly one final LF included in SHA-256 and length.
- [ ] **Step 2: Write failing adversarial preflight tests** for BOM, invalid UTF-8/surrogates, duplicate keys, unsafe integers, negative zero, fraction/exponent numeric spelling, excessive timestamp precision, leap seconds, and backslash/C0/DEL in URL fields and complete `Link`/`Location` values.
- [ ] **Step 3: Assert eligible authoritative evidence remains byte-identical** before and after preflight and Persian/repeated headers parse unchanged.
- [ ] **Step 4: Run targeted producer tests** and verify failure because serialization/preflight modules are absent.
- [ ] **Step 5: Implement deterministic serialization and raw-token/parsed preflight** separately from canonical validation; return only eligibility and structured issues.
- [ ] **Step 6: Run all producer and canonical contract tests, lint, and typecheck** and expect all checks to pass.
- [ ] **Step 7: Commit** with `git commit -m "feat: add bounded evidence exchange preflight"`.

### Task 8: Frozen Sidecar Manifest, Export Command, and Pair Verification

**Files:**
- Create: `packages/evidence-producer/src/exchange-manifest.ts`
- Create: `packages/evidence-producer/src/export-run.ts`
- Create: `packages/evidence-producer/src/verify-exchange.ts`
- Create: `packages/evidence-producer/test/exchange-manifest.test.ts`
- Create: `packages/evidence-producer/test/export-run.integration.test.ts`
- Modify: `packages/evidence-producer/package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `createExchangeManifest(input: ManifestInput): ExchangeManifest` with exactly the frozen 17 fields.
- Produces: `exportFrozenRun(options: ExportOptions): Promise<ExportReceipt>`.
- Produces: `verifyExchangePair(options: VerifyOptions): Promise<VerificationReceipt>`.
- Adds scripts: `evidence:export` and `evidence:verify`.

- [ ] **Step 1: Write failing manifest tests** for exact keys/types/constants, lowercase hashes, safe basename, evidence byte length/checksum, producer-version equality, authorization/scope equality, timestamps, limitations, and exact `pass` declarations.
- [ ] **Step 2: Write failing export tests** proving canonical validation and profile preflight re-read exact temporary-file bytes, atomic rename, no overwrite, no path traversal, and no manifest on failed validation/preflight.
- [ ] **Step 3: Add review-focus rejection tests** for dirty/mismatched revision, unauthorized scope, non-manual/nonterminal run, existing destination, one-byte evidence mutation, BOM, checksum/length mismatch, and type-sensitive manifest mismatch.
- [ ] **Step 4: Run targeted tests** and verify failure because manifest/export/verify modules are absent.
- [ ] **Step 5: Implement manifest construction, export orchestration, and pair verification** using filesystem APIs with resolved destination containment checks and exclusive file creation.
- [ ] **Step 6: Document exact Windows PowerShell commands** for exporting and locally verifying a candidate, including `.env` loading and private-output handling.
- [ ] **Step 7: Run producer tests, canonical contract tests, lint, typecheck, and integration tests** and expect all checks to pass.
- [ ] **Step 8: Commit** with `git commit -m "feat: export verified evidence exchange packages"`.

### Task 9: Runnable Synthetic Target and Stage A.2.4 Exchange Runbook

**Files:**
- Create: `packages/test-sites/src/server.ts`
- Create: `packages/test-sites/src/server.test.ts`
- Modify: `packages/test-sites/package.json`
- Create: `docs/operations/stage-a2-synthetic-exchange.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `createSyntheticSiteHandler(): (request, response) => void` and `startSyntheticSite(options): Promise<SyntheticSiteServer>` for deployment packaging and local route tests.
- Produces: operator runbook; actual public deployment URL and authorization reference remain operator inputs.

- [ ] **Step 1: Write failing route tests** for robots, sitemap/index, two linked HTML pages, redirect chain, repeated headers, Persian content, malformed JSON-LD, absent metadata, and bounded failure responses.
- [ ] **Step 2: Implement the dependency-free HTTP handler/server** so the same deterministic routes can be deployed publicly without changing crawler security policy.
- [ ] **Step 3: Run test-sites tests, lint, typecheck, and build** and expect all checks to pass.
- [ ] **Step 4: Write the runbook** covering public deployment, DNS/TLS confirmation, authorization creation, exact scope, bounded manual crawl, freeze, clean producer commit, export, local replay, checksum reporting, private delivery, and teardown/revocation.
- [ ] **Step 5: Run the complete local gate:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; create a separate test database so all database/worker integration tests execute rather than skip.
- [ ] **Step 6: Commit** with `git commit -m "docs: add synthetic evidence exchange runbook"`.
- [ ] **Step 7: After review and push, verify hosted CI for the exact producer commit** before authorizing collection.
- [ ] **Step 8: With the owner-provided public synthetic URL and authorization reference, execute the runbook** and record exact commands, producer validation/preflight results, evidence/manifest filenames, SHA-256, byte length, coverage, limitations, and provenance without editing either artifact.
- [ ] **Step 9: Deliver the private pair to SEO Engineering and retain its independent receipt**; Stage A.2.4 remains pending until both sides accept the same bytes.

## Completion Gate

- All nine tasks are committed in reviewable increments.
- Full repository lint, typecheck, tests (including database integrations), and production build pass on Node 26.
- Hosted CI passes for the exact producer implementation commit.
- The authorized synthetic evidence and manifest are generated from persisted collection, locally reverified, and never edited after checksum generation.
- SEO Engineering verifies the exact bytes independently; any difference remains visible rather than repaired.
- REST, MCP, strategic adapters, customer crawling, and site modification remain deferred.
