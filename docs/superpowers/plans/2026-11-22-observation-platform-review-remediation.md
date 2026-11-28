# Observation Platform Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generalized observation platform capable of freezing, projecting, exporting, and independently verifying a real persisted HTTP crawl without mutable-source or manifest-integrity gaps.

**Architecture:** Add a persisted per-run migration gate and a shared PostgreSQL advisory lock for every evidence mutation/freeze boundary. Build snapshots through explicit typed mappings, route projection bytes through the artifact store and execution registry, and make profile/manifest validation structural and field-specific. Preserve legacy reads until parity is recorded; do not contract legacy storage.

**Tech Stack:** TypeScript, Prisma, PostgreSQL, Vitest, Node.js filesystem/crypto APIs, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-19-generalized-observation-platform-design.md`

## Global Constraints

- Canonical evidence remains `seo-crawl-evidence/0.1.0`; exchange profile remains `seo-crawl-evidence-exchange-profile/0.1.0`.
- No observation, diagnostic, limitation, or provenance may be fabricated, normalized, rounded, or reconstructed.
- Published definitions and frozen snapshots remain immutable; changes are additive migrations and new versioned records.
- Legacy reads remain authoritative until a persisted parity checkpoint explicitly switches one eligible run.
- Frozen dependency deletion and legacy-table contraction remain deferred.

## Review Focus

- A nonempty HTTP page containing Prisma `Date` and `BigInt` values must freeze deterministically and preserve exact ISO timestamps and safe integers.
- Freeze racing any observation, diagnostic, artifact, or execution write must serialize on one run lock and leave a self-consistent snapshot.
- Valid U+FFFD/backslashes outside URL-bearing fields must pass, while invalid UTF-8, Unicode surrogates, DEL/control characters, and backslashes in URL values must fail.
- Identical artifact bytes used by two runs must retain run ownership while sharing content-addressed storage safely.
- A delivered pair with any changed typed manifest field, limitation, filename, byte count, checksum, or identity must fail verification and remain recoverable on retry.

---

### Task 1: Persist migration parity and serialize freeze

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261122120000_platform_migration_gate/migration.sql`
- Modify: `packages/db/src/repositories/observation-records.ts`
- Modify: `packages/db/src/repositories/diagnostics.ts`
- Modify: `packages/db/src/repositories/artifacts.ts`
- Modify: `packages/db/src/repositories/export-projections.ts`
- Test: `packages/db/src/repositories/export-projections.integration.test.ts`
- Test: `packages/db/src/repositories/observation-records.integration.test.ts`
- Test: `packages/db/src/repositories/diagnostics.integration.test.ts`

**Interfaces:**
- Produces: persisted `platformMigrationState`, parity digest/checkpoint, read authority, and a common transaction-scoped run advisory lock.
- Consumes: existing tenant/run ownership and terminal lifecycle checks.

- [ ] Write failing PostgreSQL tests proving freeze rejects legacy-only/unverified runs, accepts a verified generalized authority, rejects historical legacy-frozen runs, makes terminal execution replay immutable, and serializes concurrent writes.
- [ ] Run the targeted database tests and confirm failures name the missing gate/lock/transition behavior.
- [ ] Add the migration and repository helpers; require the same advisory lock in all source mutations and freeze, and allow only running-to-terminal execution transitions.
- [ ] Generate Prisma, apply the migration to the test database, and run the targeted tests green.
- [ ] Commit with `fix: enforce platform freeze migration gate`.

### Task 2: Build a typed, complete neutral snapshot

**Files:**
- Modify: `packages/db/src/repositories/export-projections.ts`
- Test: `packages/db/src/repositories/export-projections.integration.test.ts`

**Interfaces:**
- Produces: JSON-safe snapshot rows with ISO dates, safe integer byte counts, collector definitions, renderer sessions, and exact ordered transaction references.
- Consumes: the Task 1 gated/locked freeze transaction.

- [ ] Write a failing nonempty PostgreSQL test containing an HTTP transaction, repeated headers, a renderer session, Persian payload, diagnostic dependency, and byte counts; assert the stored snapshot round-trips all values.
- [ ] Run the test and confirm the current `BigInt` serialization/timestamp loss failure.
- [ ] Replace generic Prisma-row canonicalization with explicit typed mappers and safe-integer checks; include collector and renderer provenance.
- [ ] Run the targeted test and all database tests green.
- [ ] Commit with `fix: serialize complete platform snapshots`.

### Task 3: Correct artifacts, projection execution, and export publication

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: additive artifact-ownership migration if required by the chosen content/reference split.
- Modify: `packages/db/src/repositories/artifacts.ts`
- Modify: `packages/db/src/repositories/export-projections.ts`
- Modify: `packages/evidence-producer/src/cli-export.ts`
- Modify: `packages/evidence-producer/src/export-run.ts`
- Test: `packages/db/src/repositories/artifacts.integration.test.ts`
- Test: `packages/db/src/repositories/export-projections.integration.test.ts`
- Test: `packages/evidence-producer/test/export-run.integration.test.ts`

**Interfaces:**
- Produces: relative content locators, run-owned artifact references, stored projection bytes, recorded projection execution/receipt, and atomic/recoverable two-file publication.
- Consumes: Task 2 frozen snapshot bytes and projection dependency declarations.

- [ ] Write failing tests for `put → register → link`, identical bytes across two runs, missing projection dependencies, artifact byte retrieval by digest, equal output names, and interruption between final publications.
- [ ] Run targeted tests and verify each fails for the reviewed defect.
- [ ] Implement relative locators and the minimal additive ownership model; make projection service generate/validate/store bytes before completing execution; route CLI through it and make publication rollback/retry safe.
- [ ] Run targeted package suites green.
- [ ] Commit with `fix: persist verified projection artifacts`.

### Task 4: Enforce collected shapes and exact evidence references

**Files:**
- Modify: `packages/crawler/src/evidence/definitions.ts`
- Modify: `packages/crawler/src/evidence/platform-sink.ts`
- Modify: `packages/evidence-producer/src/build-document.ts`
- Test: `packages/crawler/src/evidence/platform-sink.test.ts`
- Test: `packages/evidence-producer/test/build-document.test.ts`

**Interfaces:**
- Produces: method-specific schemas, stable legacy-to-platform aliases, and exact ordered transaction references.
- Consumes: existing collector outputs and canonical contract identities.

- [ ] Write failing tests for invalid payload shapes, dangling legacy error references, and an HTTP observation referencing only its own ordered transactions.
- [ ] Run targeted tests and confirm shape/reference failures.
- [ ] Publish closed schemas for all seven crawler observation types and persist/resolve stable aliases without inventing evidence.
- [ ] Run crawler and producer suites green.
- [ ] Commit with `fix: preserve exact collected evidence identities`.

### Task 5: Harden exchange lexical and manifest verification

**Files:**
- Modify: `packages/evidence-producer/src/exchange-profile.ts`
- Modify: `packages/evidence-producer/src/serialize.ts`
- Modify: `packages/evidence-producer/src/verify-exchange.ts`
- Test: `packages/evidence-producer/test/serialize-profile.test.ts`
- Test: `packages/evidence-producer/test/export-run.integration.test.ts`

**Interfaces:**
- Produces: fatal UTF-8 decoding, duplicate-member and token-aware number checks, field-specific URL/timestamp validation, locale-independent key ordering, and strict typed 17-field manifest comparison.
- Consumes: exact evidence and manifest bytes from Task 3.

- [ ] Write failing boundary tests for U+FFFD, invalid UTF-8, unpaired surrogate escapes, URL DEL/backslash/control characters, ordinary backslashes, duplicate members, numeric spellings, authorization type, and changed limitations.
- [ ] Run targeted tests and confirm the current false positives/false negatives.
- [ ] Implement a structural lexical scanner plus decoded field traversal; compare all manifest fields and projected limitations exactly; use code-unit key ordering.
- [ ] Run producer tests green.
- [ ] Commit with `fix: harden evidence exchange verification`.

### Task 6: Real persisted exchange release gate

**Files:**
- Create: `packages/evidence-producer/test/real-crawl-exchange.integration.test.ts`
- Modify: `docs/operations/observation-platform-migration.md`
- Modify: `docs/operations/stage-a2-synthetic-exchange.md`

**Interfaces:**
- Produces: one automated PostgreSQL path from persisted nonempty collection through parity switch, locked freeze, registered projection artifact, private export, and independent verification.
- Consumes: Tasks 1–5.

- [ ] Write the failing end-to-end test with a redirect, repeated headers, Persian content, limitation, and diagnostic referencing collected evidence.
- [ ] Run it and confirm the first unmet integration boundary.
- [ ] Wire only the missing orchestration needed by the documented commands; update runbooks to match executable state transitions.
- [ ] Run the end-to-end test, clean 11-migration rehearsal, `pnpm lint`, `pnpm typecheck`, sequential full tests, and `pnpm build`.
- [ ] Commit with `test: gate real platform evidence exchange`.

