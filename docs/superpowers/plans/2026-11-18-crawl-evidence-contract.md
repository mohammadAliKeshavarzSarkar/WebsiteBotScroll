# Crawl Evidence Contract 0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reviewable WebsiteBotScroll-owned `seo-crawl-evidence` 0.1.0 schema, semantics, synthetic fixtures, and TypeScript validators for Stage A.1 interoperability review.

**Architecture:** A dependency-light workspace package owns the canonical Draft 2020-12 schema and validation. Ajv performs closed, non-coercing structural validation; focused TypeScript code enforces cross-record semantic invariants that JSON Schema cannot express. The package remains independent of crawler, database, queue, web, and SEO Engineering internals.

**Tech Stack:** TypeScript 5.9, JSON Schema Draft 2020-12, Ajv 8, ajv-formats, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-18-crawl-evidence-contract-design.md`

## Global Constraints

- Contract identity is exactly `seo-crawl-evidence` version `0.1.0`.
- WebsiteBotScroll is the canonical schema and fixture owner.
- Objects are closed unless explicitly documented; validators do not coerce, default, strip, or reinterpret input.
- `observed`, `partial`, `unknown`, `not_collected`, `failed`, `unsupported`, and `not_applicable` retain their agreed semantics.
- Raw HTML, credentials, cookies, authorization values, signed URLs, customer evidence, REST, MCP, and Python consumer code are out of scope.
- Diagnostics remain optional and separate from strategic intelligence.
- No crawler behavior or persistence changes are part of Stage A.1.

## Review Focus

- Observed empty arrays versus failed/null observations must validate differently; Task 2 pins both cases.
- Unknown properties and unsupported versions must fail instead of being stripped or accepted; Task 1 pins strict Ajv behavior.
- Duplicate and dangling identities must fail despite structural validity; Task 3 pins semantic reference integrity.
- Partial coverage must not imply definitive absence or complete discovery; Tasks 2 and 3 pin required reason codes and coverage consistency.
- Repeated headers and Persian UTF-8 must round-trip unchanged; Task 2 pins serialization fixtures.

---

### Task 1: Package foundation and canonical structural schema

**Files:**
- Create: `packages/evidence-contract/package.json`
- Create: `packages/evidence-contract/tsconfig.json`
- Create: `packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/schema.json`
- Create: `packages/evidence-contract/src/types.ts`
- Create: `packages/evidence-contract/src/validate.ts`
- Test: `packages/evidence-contract/test/schema.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `COLLECTION_STATUSES`; `EVIDENCE_SCHEMA_VERSION`; `validateEvidence(input: unknown): ValidationResult` where `ValidationResult` is `{ valid: true } | { valid: false; errors: ValidationIssue[] }`.

- [ ] **Step 1: Write failing strict-schema tests**

Assert the minimal complete envelope validates; versions other than `0.1.0`, unknown properties, coerced numbers, missing formats, unavailable states with non-null values, observed states with null values, and non-finite numbers fail. Assert validator input is not mutated.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- schema`
Expected: FAIL because the package and validator do not exist.

- [ ] **Step 3: Implement the canonical schema and structural validator**

Use Ajv's Draft 2020-12 build with `strict: true`, `allErrors: true`, `coerceTypes: false`, `useDefaults: false`, `removeAdditional: false`, and ajv-formats. Define closed schemas for producer, run scope/limits/coverage, page URL identity, per-method observation groups, HTTP transactions, metadata, headings, structured-data results, content hashes, links, optional diagnostics, errors, and limitations.

- [ ] **Step 4: Verify schema tests, lint, and type checking**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- schema && pnpm --filter @website-bot-scroll/evidence-contract lint && pnpm --filter @website-bot-scroll/evidence-contract typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-contract pnpm-lock.yaml
git commit -m "feat: define crawl evidence schema"
```

### Task 2: Field dictionary, semantic rules, and compatibility fixtures

**Files:**
- Create: `packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/field-dictionary.md`
- Create: `packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/semantic-rules.md`
- Create: `packages/evidence-contract/fixtures/valid/*.json`
- Create: `packages/evidence-contract/fixtures/invalid/*.json`
- Test: `packages/evidence-contract/test/fixtures.test.ts`

**Interfaces:**
- Consumes: `validateEvidence(input)` from Task 1.
- Produces: authoritative synthetic fixtures and documented field semantics for SEO Engineering review.

- [ ] **Step 1: Write the fixture matrix and failing fixture harness**

Valid fixtures: complete page, observed absent metadata, partial crawl, redirect with repeated headers, rendering not collected, malformed structured data recorded without aborting the page, internal links with uninspected targets, and Persian UTF-8. Invalid fixtures: failed-as-empty, duplicate structural property, unsupported version, unexpected property, missing partial reason, malformed timestamp, and invalid status/value pairing.

- [ ] **Step 2: Verify fixture tests fail**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- fixtures`
Expected: FAIL because fixtures and documentation are absent.

- [ ] **Step 3: Add fixtures and documentation**

Document every root field, identity, lifecycle, coverage, observation group, header, diagnostic, error, reason-code category, and version field. State that observed empty differs from failed null; partial data cannot establish absence; complete lifecycle differs from complete coverage; and raw HTML is excluded.

- [ ] **Step 4: Verify every valid fixture passes and every invalid fixture fails structurally**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- fixtures`
Expected: PASS and UTF-8/repeated-header assertions preserve exact values and order.

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-contract
git commit -m "test: add crawl evidence compatibility fixtures"
```

### Task 3: Cross-record semantic validation

**Files:**
- Create: `packages/evidence-contract/src/semantic-validation.ts`
- Test: `packages/evidence-contract/test/semantic-validation.test.ts`
- Modify: `packages/evidence-contract/src/validate.ts`
- Add: `packages/evidence-contract/fixtures/invalid/duplicate-identities.json`
- Add: `packages/evidence-contract/fixtures/invalid/dangling-observation-reference.json`
- Add: `packages/evidence-contract/fixtures/invalid/inconsistent-coverage.json`
- Add: `packages/evidence-contract/fixtures/invalid/redirect-final-url-mismatch.json`

**Interfaces:**
- Produces: `validateEvidenceSemantics(document: EvidenceDocument): ValidationIssue[]`; `validateEvidence` runs structural validation first and semantic validation only for structurally valid documents.

- [ ] **Step 1: Write failing semantic-invariant tests**

Assert rejection of duplicate page/observation/diagnostic/error IDs, dangling diagnostic references, terminal runs without `finished_at`, nonterminal runs with `finished_at`, coverage counters inconsistent with represented records, partial groups without reasons, redirect chains that do not lead to the final URL, and diagnostics that pass with unavailable required evidence.

- [ ] **Step 2: Verify semantic tests fail**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- semantic-validation`
Expected: FAIL because semantic validation does not exist.

- [ ] **Step 3: Implement semantic validation as pure deterministic checks**

Return stable issues containing `code`, JSON Pointer `path`, and `message`. Do not mutate the document, perform I/O, infer missing values, or add strategic meaning.

- [ ] **Step 4: Verify all contract tests**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test`
Expected: PASS for structural, fixture, and semantic suites.

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-contract
git commit -m "feat: validate crawl evidence semantics"
```

### Task 4: Roadmap integration map and Stage A.1 review bundle

**Files:**
- Create: `docs/architecture/evidence-interoperability.md`
- Create: `docs/architecture/evidence-preservation-gaps.md`
- Modify: `README.md`
- Test: `packages/evidence-contract/test/review-bundle.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a consumer-review bundle identifying canonical paths, version, schema checksum, fixture checksums, known deferrals, and the exact minimal Task 3–7 preservation changes.

- [ ] **Step 1: Write a failing review-bundle completeness test**

Assert documented canonical schema/version, Draft 2020-12 dialect, ownership, checksum algorithm, Stage A.1 versus A.2 boundary, header allowlist, raw-HTML policy, deferred capabilities, and every authoritative fixture path.

- [ ] **Step 2: Verify the review-bundle test fails**

Run: `pnpm --filter @website-bot-scroll/evidence-contract test -- review-bundle`
Expected: FAIL because the architecture bundle is absent.

- [ ] **Step 3: Document the implementation-impact map**

Record current-source gaps without modifying crawler behavior: Task 3 normalization policy identity; Task 4 robots/sitemap provenance; Task 5 transactions, repeated headers, redirects, structured failures, and timestamps; Task 6 limits, consumption, coverage, and stop reasons; Task 7 observation-oriented persistence. Include schema and fixture SHA-256 generation instructions for the SEO Engineering pinned copy.

- [ ] **Step 4: Run package and repository verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: PASS; existing crawler, queue, database, worker, and web behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs README.md packages/evidence-contract
git commit -m "docs: prepare evidence contract review bundle"
```

## Self-review result

- Spec coverage: all agreed Stage A.1 WebsiteBotScroll deliverables are assigned; Python validation, adapters, operational export, REST, MCP, rendering, performance, and historical comparison remain explicitly deferred.
- Type consistency: `validateEvidence` is the public entry point; semantic validation operates only on structurally valid `EvidenceDocument` values.
- Review-focus coverage: strictness, status semantics, references, partial coverage, repeated headers, and UTF-8 are pinned to Tasks 1–3.
- Proportion: four independently reviewable tasks cover schema, fixtures/documentation, semantic validation, and review packaging without implementing crawler changes prematurely.
