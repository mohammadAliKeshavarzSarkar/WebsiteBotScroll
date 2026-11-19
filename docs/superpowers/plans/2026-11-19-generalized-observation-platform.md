# Generalized Observation Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, immutable, tenant-safe platform for current and future observations, renderer artifacts, diagnostic rules, and export projections before producing the first evidence package.

**Architecture:** Keep common identity, lifecycle, tenancy, ordering, and query fields relational while validating type-specific JSON payloads against immutable engineering-published definitions. Collection, diagnostics, and exports operate as pinned executions over frozen snapshots; artifacts are content-addressed and policy-governed.

**Tech Stack:** TypeScript, pnpm, Prisma 7, PostgreSQL, JSON Schema Draft 2020-12/Ajv, Vitest, Node.js crypto and filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-11-19-generalized-observation-platform-design.md`

## Global Constraints

- Published definitions and persisted evidence are immutable; definition corrections create new versions, while evidence supersession is deferred.
- Every tenant-data write and read is tenant-scoped and rejects cross-tenant references; global system-definition publication is internal-only.
- JSON Schema remote references, executable definitions, caller-selected artifact paths, and unbounded payloads are prohibited.
- Raw HTML, credentials, cookies, authorization data, and unrestricted headers remain excluded.
- Existing evidence remains readable until migration parity is verified; no destructive removal in this plan.
- The canonical `seo-crawl-evidence` 0.1.0 contract remains frozen.

## Review Focus

- Concurrent publication of the same `(key, version)` must converge idempotently or reject a semantic conflict.
- Malicious or pathological schemas/payloads must fail within configured depth, size, property, and array limits.
- Retry after partial output must not duplicate executions, observations, subject members, or artifact links.
- Freeze must reject dangling dependencies, running child executions, unavailable required artifacts, and cross-tenant references.
- Projection retries and failures must never mutate source evidence or overwrite an existing output artifact.

---

### Task 1: Versioned Definition Registry

**Files:**
- Create: `packages/domain/src/observation-platform.ts`
- Create: `packages/domain/src/observation-platform.test.ts`
- Create: `packages/observation-schema/package.json`
- Create: `packages/observation-schema/tsconfig.json`
- Create: `packages/observation-schema/src/schema-policy.ts`
- Create: `packages/observation-schema/src/schema-policy.test.ts`
- Create: `packages/db/src/repositories/definitions.ts`
- Create: `packages/db/src/repositories/definitions.integration.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_observation_definition_registry/migration.sql`
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ObservationDefinitionInput`, `CollectorDefinitionInput`, `DefinitionStatus`, `PlatformValidationIssue`, and the exact limits from the spec.
- Produces: `compileBoundedSchema(schema: unknown): CompiledObservationSchema` and `validateBoundedPayload(compiled, payload): PlatformValidationResult` from `@website-bot-scroll/observation-schema`.
- Produces: internal-only `DefinitionRepository.publishObservationDefinition(input)`, `publishCollectorDefinition(input)`, and exact-version lookup methods.

- [ ] Write failing domain/schema-policy tests for exact key/SemVer syntax, immutable schema hashes, allowed scopes/statuses, remote-reference rejection, and all fixed complexity limits.
- [ ] Write failing integration tests for global engineering definitions, internal publication authorization, idempotent publication, conflicting publication, collector capabilities, lifecycle, and concurrent uniqueness.
- [ ] Run domain and DB tests and verify the registry is absent.
- [ ] Add definition models, migration, bounded Ajv compilation, stable schema hashing, and repository methods.
- [ ] Run migrations, targeted tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: add versioned observation definition registry"`.

### Task 2: Subjects, Executions, and Generalized Observation Records

**Files:**
- Create: `packages/db/src/repositories/observation-records.ts`
- Create: `packages/db/src/repositories/observation-records.integration.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_generalized_observation_records/migration.sql`
- Modify: `packages/domain/src/observation-platform.ts`

**Interfaces:**
- Consumes: exact published definitions from Task 1.
- Produces: `ObservationSubjectInput`, `ObservationExecutionInput`, `ObservationRecordInput`.
- Produces: `ObservationRepository.startExecution(organizationId, input)`, `appendSubject(organizationId, input)`, `appendObservation(organizationId, input)`, `finishExecution(organizationId, input)`, and `loadRunRecords(organizationId, runId)`.

- [ ] Write failing tests for run/page/resource/site/cross-page subjects, resource identity/ownership, ordered cross-page members, parent executions, namespace-separated IDs, stable attempt numbers, and exact lifecycle transitions.
- [ ] Add review-focus tests for cross-tenant references, unknown definition versions, scope mismatch, invalid payload/status pairing, partial retry, and immutable conflicts.
- [ ] Run targeted tests and verify failure before models exist.
- [ ] Add normalized subject/execution/record models, indexes, migration, repository validation, and snapshot loading.
- [ ] Run migrations, targeted tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: persist generalized observation executions"`.

### Task 3: Content-Addressed Evidence Artifacts

**Files:**
- Create: `packages/domain/src/evidence-artifact.ts`
- Create: `packages/db/src/repositories/artifacts.ts`
- Create: `packages/db/src/repositories/artifacts.integration.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_evidence_artifacts/migration.sql`

**Interfaces:**
- Produces: `ArtifactDescriptor`, `ArtifactPolicy`, `ArtifactStore.put(bytes, policy)`, and tenant-scoped `ArtifactRepository` methods.
- Produces: ordered observation-artifact links with roles and availability states.

- [ ] Write failing tests for SHA-256 identity, byte length, media type, sensitivity/retention enforcement, duplicate content, and ordered roles.
- [ ] Add adversarial tests for caller paths, hash mismatch/collision, excessive per-artifact/execution bytes, atomic-write failure cleanup, unavailable artifacts, frozen retention pins, and cross-tenant links.
- [ ] Implement metadata persistence and a filesystem test store using server-selected content-addressed paths.
- [ ] Run migrations, targeted tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: add governed evidence artifact storage"`.

### Task 4: Current Collector Migration Adapter

**Files:**
- Create: `packages/crawler/src/evidence/definitions.ts`
- Create: `packages/crawler/src/evidence/platform-sink.ts`
- Create: `packages/crawler/src/evidence/platform-sink.test.ts`
- Modify: `apps/worker/src/jobs/run-crawl.ts`
- Modify: `apps/worker/src/jobs/run-crawl.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 repositories.
- Produces: published definitions for `page.http`, `page.metadata`, `page.headings`, `page.structured_data`, `page.content`, `page.links`, and `page.rendering`.
- Produces: `PlatformEvidenceSink` adapting current crawler events to generalized executions and records.

- [ ] Write failing parity tests preserving URL identity, transactions, repeated header order, Persian text, provenance, unavailable/partial states, limitations, and retry IDs.
- [ ] Write failing migration/backfill verification tests mapping legacy method names without rewriting legacy rows.
- [ ] Implement definition bootstrap and a single-transaction dual-write facade where legacy remains authoritative, retry IDs are shared, parity digests/checkpoints gate per-run read switching, and frozen legacy runs remain legacy-only.
- [ ] Run crawler/worker/DB tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: migrate crawler evidence to observation platform"`.

### Task 5: Renderer Session Extension Proof

**Files:**
- Create: `packages/domain/src/renderer-session.ts`
- Create: `packages/db/src/repositories/renderer-sessions.ts`
- Create: `packages/db/src/repositories/renderer-sessions.integration.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_renderer_sessions/migration.sql`

**Interfaces:**
- Produces: `RendererSessionInput` and repository lifecycle methods linked to collector executions.
- Produces: renderer definition fixtures and screenshot/trace/DOM artifact-role examples without requiring Chromium.

- [ ] Write failing tests for pinned engine/version, viewport, locale, user agent, timing policy, artifacts, terminal failure, and retry isolation.
- [ ] Implement renderer-session persistence as an extension of generalized executions, not a parallel observation system.
- [ ] Run migrations, tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: model renderer sessions and artifacts"`.

### Task 6: Diagnostic Rule Registry and Results

**Files:**
- Create: `packages/domain/src/diagnostics.ts`
- Create: `packages/db/src/repositories/diagnostics.ts`
- Create: `packages/db/src/repositories/diagnostics.integration.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_diagnostic_rule_platform/migration.sql`

**Interfaces:**
- Produces: `DiagnosticRuleDefinitionInput`, `DiagnosticExecutionInput`, `DiagnosticResultInput`.
- Produces: ordered evidence dependencies and explicit cross-page subject relevance.

- [ ] Write failing tests for immutable rule versions, accepted input definitions, configuration schemas, outcome vocabularies, and policy versions.
- [ ] Add tests for unavailable required inputs, dangling observations, cross-page rules, deterministic reruns, limitations, and tenant isolation.
- [ ] Implement rule publication, execution/result persistence, dependency validation, and snapshot loading.
- [ ] Run migrations, targeted tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: add versioned diagnostic evidence platform"`.

### Task 7: Export Projection Registry and Neutral Snapshot

**Files:**
- Create: `packages/domain/src/export-projection.ts`
- Create: `packages/db/src/repositories/export-projections.ts`
- Create: `packages/db/src/repositories/export-projections.integration.test.ts`
- Create: `packages/evidence-producer/package.json`
- Create: `packages/evidence-producer/tsconfig.json`
- Create: `packages/evidence-producer/src/platform-snapshot.ts`
- Create: `packages/evidence-producer/test/platform-snapshot.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_export_projection_registry/migration.sql`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: immutable `ExportProjectionDefinition`, `ExportExecution`, and `FrozenPlatformSnapshot`.
- Produces: tenant-scoped `SnapshotRepository.freezePlatformSnapshot(organizationId, runId)` as the sole freeze authority and `runProjection(organizationId, snapshotId, projection)` with content-addressed outputs.

- [ ] Write failing tests for projection publication, accepted definition versions, frozen dependency closure, exact producer revision, output artifacts, deterministic retry, and identical snapshot identity consumed by neutral/canonical projections.
- [ ] Add rejection tests for coverage inconsistency, dangling subjects/diagnostic inputs, running child executions, dirty/mismatched revisions, unavailable artifacts, mutation attempts, overwrite, retention deletion, and cross-tenant snapshots.
- [ ] Implement projection registry/executions and a deterministic internal neutral JSON projection.
- [ ] Run migrations, producer tests, lint, and typecheck; expect all to pass.
- [ ] Commit with `git commit -m "feat: add frozen export projection boundary"`.

### Task 8: Canonical Evidence Projection on the Platform

**Files:**
- Create: `packages/evidence-producer/src/build-document.ts`
- Create: `packages/evidence-producer/test/build-document.test.ts`
- Create: `packages/evidence-producer/src/serialize.ts`
- Create: `packages/evidence-producer/src/exchange-profile.ts`
- Create: `packages/evidence-producer/src/exchange-manifest.ts`
- Create: `packages/evidence-producer/src/export-run.ts`
- Create: `packages/evidence-producer/src/verify-exchange.ts`
- Modify: `packages/evidence-producer/package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `FrozenPlatformSnapshot` from Task 7.
- Produces: the accepted exact-byte `seo-crawl-evidence/0.1.0` document, profile preflight, 17-field manifest, export, and verification commands.

- [ ] Port the authoritative builder/serializer/profile/manifest tests from the accepted Stage A.2.4 plan to generalized snapshots.
- [ ] Add projection tests proving missing evidence remains unavailable, both projections consume the same frozen snapshot identity, source records remain unchanged, and unsupported definition versions are rejected.
- [ ] Implement canonical mapping, deterministic bytes, profile preflight, manifest, atomic export, and pair verification.
- [ ] Run producer, canonical contract, integration, lint, typecheck, and build gates.
- [ ] Commit with `git commit -m "feat: project observation snapshots to evidence exchange"`.

### Task 9: Platform Operations and First Exchange Readiness

**Files:**
- Create: `docs/operations/observation-definition-governance.md`
- Create: `docs/operations/observation-platform-migration.md`
- Create or modify: `docs/operations/stage-a2-synthetic-exchange.md`
- Modify: `README.md`

**Interfaces:**
- Produces: publication, deprecation, retention, migration, recovery, and exchange runbooks.

- [ ] Document definition ownership, review, schema limits, compatibility, deprecation, retention, and incident handling.
- [ ] Document expand/backfill/verify/switch/contract migration with rollback checkpoints and no destructive step in this phase.
- [ ] Run a clean database migration rehearsal and full `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` gate.
- [ ] Request a fresh whole-branch review focused on tenancy, immutability, dependency closure, schema safety, and projection non-mutation.
- [ ] Commit with `git commit -m "docs: add observation platform operations runbooks"`.

