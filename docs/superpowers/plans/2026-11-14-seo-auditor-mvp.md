# SEO Auditor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a retained, read-only SEO auditing product that lets one owner verify sites, run bounded standards-compliant crawls, review prioritized evidence-backed findings, and monitor issue resolution over time.

**Architecture:** Use a pnpm TypeScript monorepo with a Next.js web/API process and a separate BullMQ worker process. PostgreSQL is the source of truth; Redis holds queues and short-lived coordination state. Crawling is HTTP-first, split into pure normalization/safety/extraction modules and an orchestrator so security and diagnostic behavior can be tested without live websites.

**Tech Stack:** Node.js 26 LTS, pnpm, TypeScript 5.4+, Next.js App Router, React, Tailwind CSS, PostgreSQL, Prisma ORM, Redis 6.2+, BullMQ, Zod, Cheerio, `robots-parser`, Vitest, Playwright, Lighthouse, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-14-automated-seo-platform-design.md`

## Global Constraints

- Version one is read-only; it must never modify a monitored website.
- Every persisted business record is scoped by `organizationId`; website records are also scoped by `siteId`.
- Respect RFC 9309 robots rules and identify the crawler as `WebsiteBotScroll/0.1 (+<configured public contact URL>)`.
- Never send automated Google searches, simulate clicks, or call unsupported indexing APIs.
- Resolve and validate every destination before the initial request and after every redirect; block loopback, private, link-local, multicast, unspecified, and cloud metadata destinations.
- Default per-site crawl budget: 500 HTML pages, 1,000 same-site image probes, depth 8, 250 MB transferred, 30 minutes, concurrency 2, minimum 500 ms between starts, 3 attempts, and at most 5 redirects.
- Stop scheduling new requests after `429`, three consecutive `5xx` responses, or five consecutive network failures; use exponential retry delays of 5, 30, and 120 seconds.
- Accept HTML responses up to 5 MB compressed and 20 MB decompressed; reject other response bodies above 10 MB.
- JavaScript rendering is opt-in per site and outside the first HTTP-crawler milestone; Lighthouse uses its own isolated browser process.
- Store normalized extracted fields and SHA-256 content hashes; do not retain full response bodies after analysis in the MVP.
- Use UTC in persistence and jobs; localize only at the presentation boundary.
- Queue jobs are idempotent and carry identifiers, never credentials or page content.
- TDD is mandatory for domain logic and security boundaries; each task must leave `pnpm lint`, `pnpm typecheck`, and its targeted tests passing.

## Review Focus

- A public URL that resolves or redirects to an internal address must be rejected before any internal request is sent; Task 3 pins redirect and DNS-rebinding behavior.
- Malformed or unavailable `robots.txt` must follow RFC 9309 access-result semantics without silently converting a server outage into permission; Task 4 pins `2xx`, `4xx`, and `5xx` cases.
- URL variants, fragments, tracking parameters, and canonical aliases must not create an unbounded frontier or duplicate findings; Tasks 3, 5, and 9 pin normalization and identity.
- An interrupted/retried queue job must not create a second crawl run or duplicate snapshots/findings; Tasks 6 and 9 pin idempotency.
- Hostile, huge, or malformed HTML and compressed responses must remain inside byte/time budgets and must not execute scripts in the web or worker processes; Tasks 5 and 7 pin resource limits and inert parsing.

---

## File map

```text
apps/web/                         Next.js dashboard, API route handlers, owner session UI
apps/worker/                      BullMQ worker entrypoint and job processors
packages/config/                  Environment schema and shared build/lint config
packages/db/                      Prisma schema, client, seed, and repositories
packages/domain/                  Shared IDs, states, policies, scoring, and contracts
packages/crawler/                 URL safety, robots, sitemap, fetching, extraction, frontier
packages/audits/                  Versioned deterministic SEO rules and finding identity
packages/queue/                   Queue names, payload schemas, producers, worker defaults
packages/test-sites/              Deterministic HTTP fixture server and hostile-site fixtures
tests/e2e/                        Browser-level owner workflows
docs/operations/                  Local runbook, crawler identity, incident/stop procedures
```

## Task 1: Repository foundation and executable health checks

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.env.example`
- Create: `compose.yaml`, `apps/web/**`, `apps/worker/src/index.ts`
- Create: `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `packages/config/package.json`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `envSchema`, `loadEnv(source?: NodeJS.ProcessEnv): AppEnv`; workspace scripts `dev`, `build`, `lint`, `typecheck`, `test`.

- [ ] **Step 1: Scaffold the pnpm workspace and failing environment tests**

Create tests asserting that `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (minimum 32 characters), `APP_BASE_URL`, `CRAWLER_CONTACT_URL`, `BOOTSTRAP_OWNER_EMAIL`, and `BOOTSTRAP_OWNER_PASSWORD` are required and parsed into `AppEnv`; require the bootstrap password to contain at least 16 characters and erase it from long-lived process state after seeding.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/config test`
Expected: FAIL because `loadEnv` is not implemented.

- [ ] **Step 3: Implement configuration, web health route, worker health startup, and local services**

Use `loadEnv(source?: NodeJS.ProcessEnv): AppEnv`; expose `GET /api/health` returning `{ status: "ok" }`; configure PostgreSQL and Redis with health checks in Compose. Lock exact dependency versions in `pnpm-lock.yaml` and use Node.js 26 LTS in CI and containers.

- [ ] **Step 4: Add CI and verify the workspace**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all commands exit 0; the health route is included in the production build.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: establish SEO auditor workspace"
```

## Task 2: Tenant-safe persistence and single-owner authentication

**Files:**
- Create: `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/repositories/sites.ts`, `packages/db/src/seed.ts`
- Create: `packages/domain/src/ids.ts`, `packages/domain/src/site.ts`
- Create: `apps/web/src/lib/auth.ts`, `apps/web/src/middleware.ts`, `apps/web/src/app/login/page.tsx`
- Test: `packages/db/src/repositories/sites.integration.test.ts`, `apps/web/src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `AppEnv` from Task 1.
- Produces: branded `OrganizationId`, `UserId`, `SiteId`; `SiteRepository.list(organizationId)`, `.create(input)`, `.get(organizationId, siteId)`; `requireOwnerSession()`.

- [ ] **Step 1: Write tenant-isolation and authentication tests**

Assert one organization cannot retrieve another's site even with its `siteId`; unauthenticated protected requests redirect to `/login`; valid owner credentials create a secure, HTTP-only session.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/db test -- sites.integration && pnpm --filter web test -- auth`
Expected: FAIL because schema, repository, and auth boundary do not exist.

- [ ] **Step 3: Add the initial schema and migration**

Define `Organization`, `User`, `Session`, `Site`, `DomainVerification`, and `AuditEvent`; use UUID primary keys, UTC timestamps, and compound organization/site indexes. Hash the bootstrap password with Argon2id, store only the hash, and use random opaque session tokens whose SHA-256 digests—not raw tokens—are persisted.

- [ ] **Step 4: Implement scoped repositories and owner session checks**

Never expose an unscoped `findUnique(siteId)` from the repository. Record login, logout, site creation, and verification changes in `AuditEvent`.

- [ ] **Step 5: Verify migration, isolation, and auth**

Run: `pnpm db:migrate:test && pnpm --filter @website-bot-scroll/db test && pnpm --filter web test`
Expected: PASS with cross-organization access returning `null`/404.

- [ ] **Step 6: Commit**

```bash
git add packages/db packages/domain apps/web
git commit -m "feat: add tenant-safe persistence and owner auth"
```

## Task 3: URL normalization and network-boundary enforcement

**Files:**
- Create: `packages/crawler/src/url/normalize.ts`, `packages/crawler/src/url/policy.ts`, `packages/crawler/src/network/resolve-public.ts`
- Test: `packages/crawler/src/url/normalize.test.ts`, `packages/crawler/src/network/resolve-public.test.ts`

**Interfaces:**
- Produces: `normalizeUrl(input: string, policy: UrlPolicy): NormalizedUrl`; `assertAllowedDestination(url: URL, resolver: DnsResolver): Promise<ResolvedDestination>`; `isSameSite(candidate, sitePolicy): boolean`.

- [ ] **Step 1: Write URL identity and unsafe-network tests**

Cover lowercase hosts, default ports, fragments, dot segments, sorted query keys, configurable removal of `utm_*`/`gclid`, punycode, unsupported schemes, credentials in URLs, IPv4/IPv6 private ranges, mixed DNS answers, redirect-to-private, and a resolver that changes answers between calls.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/crawler test -- url network`
Expected: FAIL because the functions do not exist.

- [ ] **Step 3: Implement deterministic normalization and public-address validation**

Pin the validated IP address to the request connection; a later redirect must run a new validation. Reject if any resolved address is forbidden rather than choosing a public answer from a mixed set.

- [ ] **Step 4: Verify tests and property invariants**

Run: `pnpm --filter @website-bot-scroll/crawler test -- url network`
Expected: PASS; normalizing an already normalized URL produces the identical value.

- [ ] **Step 5: Commit**

```bash
git add packages/crawler
git commit -m "feat: enforce crawler URL and network safety"
```

## Task 4: Robots and sitemap discovery

**Files:**
- Create: `packages/crawler/src/robots/fetch-robots.ts`, `packages/crawler/src/robots/policy.ts`
- Create: `packages/crawler/src/sitemap/parse.ts`, `packages/crawler/src/sitemap/discover.ts`
- Test: `packages/crawler/src/robots/*.test.ts`, `packages/crawler/src/sitemap/*.test.ts`
- Fixtures: `packages/test-sites/src/routes/robots.ts`, `packages/test-sites/src/routes/sitemaps.ts`

**Interfaces:**
- Consumes: Task 3 destination policy.
- Produces: `loadRobots(origin, fetcher): Promise<RobotsDecisionSource>`; `canCrawl(source, url, userAgent): boolean`; `discoverSitemaps(origin, robots, fetcher, limits): AsyncIterable<SitemapUrl>`.

- [ ] **Step 1: Write RFC access-result and sitemap bomb tests**

Assert `2xx` rules are honored, `404/410` means no rules, network errors and `5xx` temporarily disallow crawling, redirects remain safe, UTF-8 parsing is bounded, nested indexes stop at depth 3/50 files/50,000 URLs, and entity expansion or compressed-size overflow is rejected.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/crawler test -- robots sitemap`
Expected: FAIL because loaders and parsers do not exist.

- [ ] **Step 3: Implement robots evaluation and streaming sitemap discovery**

Cache robots results for at most 24 hours, but do not reuse a transient failure beyond its retry window. Support sitemap declarations in robots and `/sitemap.xml` fallback.

- [ ] **Step 4: Run targeted tests**

Run: `pnpm --filter @website-bot-scroll/crawler test -- robots sitemap`
Expected: PASS for status semantics, limits, and hostile fixtures.

- [ ] **Step 5: Commit**

```bash
git add packages/crawler packages/test-sites
git commit -m "feat: add standards-aware robots and sitemap discovery"
```

## Task 5: Bounded HTTP fetcher and crawl frontier

**Files:**
- Create: `packages/crawler/src/http/fetch-page.ts`, `packages/crawler/src/http/budget.ts`, `packages/crawler/src/frontier/frontier.ts`, `packages/crawler/src/frontier/politeness.ts`
- Test: corresponding `*.test.ts` files
- Fixtures: `packages/test-sites/src/routes/failures.ts`, `packages/test-sites/src/routes/large.ts`

**Interfaces:**
- Consumes: Task 3 safety and Task 4 robots policy.
- Produces: `fetchPage(request: FetchPageRequest): Promise<FetchPageResult>`; `probeResource(request: ProbeResourceRequest): Promise<ResourceObservation>`; `CrawlBudget.consume(event): BudgetDecision`; `CrawlFrontier.add(candidate)` and `.next(): Promise<FrontierItem | null>`.

- [ ] **Step 1: Write failing budget, redirect, retry, and politeness tests**

Pin all Global Constraint limits; include `429`, consecutive `5xx`, timeouts, decompression overflow, non-HTML payloads, same-site rules, duplicate normalized URLs, depth 9, two concurrent requests to the same host, image probe `HEAD` fallback to bounded `GET`, and exhaustion of the separate 1,000-image budget.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/crawler test -- http frontier`
Expected: FAIL because fetch and frontier contracts are absent.

- [ ] **Step 3: Implement the inert HTTP fetch path and bounded frontier**

Stream responses while enforcing compressed/decompressed limits; never evaluate HTML or scripts. Keep host politeness independent from global worker concurrency.

- [ ] **Step 4: Run crawler tests**

Run: `pnpm --filter @website-bot-scroll/crawler test -- http frontier`
Expected: PASS with timing assertions allowing documented CI tolerance.

- [ ] **Step 5: Commit**

```bash
git add packages/crawler packages/test-sites
git commit -m "feat: add bounded fetcher and polite crawl frontier"
```

## Task 6: Queue contracts and idempotent crawl orchestration

**Files:**
- Create: `packages/queue/src/contracts.ts`, `packages/queue/src/client.ts`, `packages/queue/src/worker-options.ts`
- Create: `apps/worker/src/jobs/run-crawl.ts`, `apps/worker/src/jobs/process-page.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Test: `apps/worker/src/jobs/run-crawl.integration.test.ts`, `packages/queue/src/contracts.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `enqueueCrawl({ organizationId, siteId, trigger, idempotencyKey }): Promise<CrawlRunId>`; Zod-validated `RunCrawlJob` and `ProcessPageJob`; `processRunCrawl(job)`.

- [ ] **Step 1: Write failing queue validation and retry-idempotency tests**

Assert malformed payloads are rejected, secrets/content are absent, the same idempotency key returns one `CrawlRun`, worker retry resumes it, per-site overlap is prevented, and terminal states are `COMPLETED`, `PARTIAL`, `FAILED`, or `CANCELLED`.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter worker test -- run-crawl && pnpm --filter @website-bot-scroll/queue test`
Expected: FAIL because queue contracts and crawl persistence do not exist.

- [ ] **Step 3: Add crawl persistence and queue producers/processors**

Add `CrawlRun`, `CrawlError`, and unique `(siteId, idempotencyKey)`. Persist frontier progress in PostgreSQL checkpoints; Redis locks coordinate active workers but are not the only source of truth.

- [ ] **Step 4: Verify worker restart and duplicate delivery behavior**

Run: `pnpm --filter worker test -- run-crawl`
Expected: PASS with one run and no duplicate processed URL after simulated retry.

- [ ] **Step 5: Commit**

```bash
git add packages/queue packages/db apps/worker
git commit -m "feat: orchestrate idempotent crawl jobs"
```

## Task 7: HTML extraction, page inventory, and snapshots

**Files:**
- Create: `packages/crawler/src/extract/html.ts`, `packages/crawler/src/extract/structured-data.ts`, `packages/crawler/src/extract/hash.ts`
- Create: `packages/db/src/repositories/pages.ts`
- Modify: `packages/db/prisma/schema.prisma`, `apps/worker/src/jobs/process-page.ts`
- Test: `packages/crawler/src/extract/*.test.ts`, `packages/db/src/repositories/pages.integration.test.ts`

**Interfaces:**
- Produces: `extractPage(input: HtmlDocument): ExtractedPage`; `hashExtractedPage(page): ContentHash`; `PageRepository.upsertSnapshot(input): Promise<{ changed: boolean; snapshotId: string }>`; persisted `ResourceObservation` records for probed images.

- [ ] **Step 1: Write extraction and hostile-HTML tests**

Assert extraction of title, description, robots, canonical, headings, links, images, language, viewport, JSON-LD, byte size, and visible text summary. Include malformed markup, script tags, inline event handlers, invalid JSON-LD, base tags, duplicate attributes, and a 20 MB boundary fixture.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/crawler test -- extract`
Expected: FAIL because extraction functions do not exist.

- [ ] **Step 3: Implement inert parsing and snapshot persistence**

Add `Page`, `PageSnapshot`, and `ResourceObservation`; keep current inventory on `Page`, historical extracted metadata on snapshots, probe normalized same-site images through Task 5 without downloading successful bodies unnecessarily, and skip a new deep-analysis job when the content hash and relevant response metadata are unchanged.

- [ ] **Step 4: Verify extraction and unchanged-page behavior**

Run: `pnpm --filter @website-bot-scroll/crawler test -- extract && pnpm --filter @website-bot-scroll/db test -- pages`
Expected: PASS; hostile scripts never execute and identical snapshots report `changed: false`.

- [ ] **Step 5: Commit**

```bash
git add packages/crawler packages/db apps/worker
git commit -m "feat: extract and persist crawl snapshots"
```

## Task 8: Versioned page-level audit rules

**Files:**
- Create: `packages/audits/src/contracts.ts`, `packages/audits/src/registry.ts`
- Create: `packages/audits/src/rules/http.ts`, `indexability.ts`, `metadata.ts`, `headings.ts`, `images.ts`, `structured-data.ts`, `international.ts`, `quality.ts`
- Test: matching `*.test.ts` and `packages/audits/test/fixtures.ts`

**Interfaces:**
- Consumes: `ExtractedPage` and image `ResourceObservation` values from Task 7.
- Produces: `AuditRule<TContext>`, `AuditCandidate`; `pageRuleRegistry.run(context): AuditCandidate[]`.

- [ ] **Step 1: Write table-driven failing tests for the MVP page rules**

Cover status/redirect/soft-404 indicators, conflicting index directives, canonical errors, missing/duplicate/length-warning metadata, zero/multiple H1s, broken/missing-alt images, non-crawlable internal links, invalid JSON-LD and required fields, viewport absence, HTTPS/mixed content, empty/thin indicators, and basic `hreflang` syntax.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/audits test`
Expected: FAIL because registry and rules do not exist.

- [ ] **Step 3: Implement pure versioned rules**

Each candidate includes `ruleId`, integer `ruleVersion`, `severity`, `confidence`, evidence, expected state, consequence, recommendation, and verification text. Label title/description length and thin-content results as review warnings, never definitive quality failures.

- [ ] **Step 4: Verify all page rules**

Run: `pnpm --filter @website-bot-scroll/audits test`
Expected: PASS with deterministic candidate ordering and no network/database access.

- [ ] **Step 5: Commit**

```bash
git add packages/audits
git commit -m "feat: add versioned page-level SEO audits"
```

## Task 9: Site-wide audits, finding identity, scoring, and lifecycle

**Files:**
- Create: `packages/audits/src/site/analyze-site.ts`, `packages/audits/src/finding-key.ts`
- Create: `packages/domain/src/finding.ts`, `packages/domain/src/priority.ts`
- Create: `packages/db/src/repositories/findings.ts`
- Modify: `packages/db/prisma/schema.prisma`, `apps/worker/src/jobs/run-crawl.ts`
- Test: matching unit and integration tests

**Interfaces:**
- Consumes: Task 8 candidates and completed page inventory.
- Produces: `analyzeSite(context): AuditCandidate[]`; `findingKey(candidate): string`; `scoreFinding(input): PriorityBreakdown`; `FindingRepository.reconcile(crawlRunId, candidates)`.

- [ ] **Step 1: Write failing site analysis and lifecycle tests**

Cover broken internal links, redirect chains/loops, exact/near duplicate clusters, sitemap mismatch, orphan candidates, depth, canonical inconsistency, duplicate titles/descriptions, and reciprocal `hreflang`. Assert repeated normalized URL variants yield one finding; reruns preserve `firstSeenAt`, update `lastSeenAt`, resolve absent findings, and mark later return as `RECURRED`.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @website-bot-scroll/audits test -- site && pnpm --filter @website-bot-scroll/db test -- findings`
Expected: FAIL because site analysis and lifecycle do not exist.

- [ ] **Step 3: Implement site rules, stable keys, transparent priority, and reconciliation**

Use a documented 0–100 breakdown from severity, confidence, affected-page share, page importance, recurrence, and estimated effort; persist every factor so the UI can explain the score.

- [ ] **Step 4: Verify idempotent reconciliation and scoring**

Run: `pnpm --filter @website-bot-scroll/audits test && pnpm --filter @website-bot-scroll/db test -- findings`
Expected: PASS with no duplicate findings after retry or URL aliasing.

- [ ] **Step 5: Commit**

```bash
git add packages/audits packages/domain packages/db apps/worker
git commit -m "feat: prioritize and track SEO finding lifecycle"
```

## Task 10: Domain onboarding and DNS ownership verification

**Files:**
- Create: `apps/web/src/app/sites/new/page.tsx`, `apps/web/src/app/api/sites/route.ts`
- Create: `apps/web/src/app/api/sites/[siteId]/verify/route.ts`
- Create: `packages/domain/src/verification.ts`, `apps/worker/src/jobs/verify-domain.ts`
- Test: route/domain/worker tests

**Interfaces:**
- Consumes: Tasks 2, 3, and 6.
- Produces: `createVerificationChallenge(siteId): VerificationChallenge`; `verifyDnsChallenge(site, resolver): Promise<VerificationResult>`.

- [ ] **Step 1: Write failing onboarding and verification tests**

Assert canonical HTTPS origin storage, rejection of paths/query/credentials/non-HTTP schemes, a random `_websitebotscroll` TXT challenge, expiration after 72 hours, correct/incorrect DNS behavior, tenant authorization, and no crawl before verification.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter web test -- sites verification && pnpm --filter worker test -- verify-domain`
Expected: FAIL because onboarding routes and verifier do not exist.

- [ ] **Step 3: Implement site creation, verification UI/API, and audit events**

Rate-limit verification attempts to 10 per site per hour. After successful verification, allow the owner to enqueue the first baseline crawl explicitly.

- [ ] **Step 4: Verify onboarding workflow**

Run: `pnpm --filter web test -- sites verification && pnpm --filter worker test -- verify-domain`
Expected: PASS for authorization, expiration, rate limit, and successful verification.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/worker packages/domain packages/db
git commit -m "feat: onboard and verify monitored domains"
```

## Task 11: Audit dashboard and crawl controls

**Files:**
- Create: `apps/web/src/app/(dashboard)/sites/page.tsx`
- Create: `apps/web/src/app/(dashboard)/sites/[siteId]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/sites/[siteId]/findings/[findingId]/page.tsx`
- Create: `apps/web/src/app/api/sites/[siteId]/crawls/route.ts`, `apps/web/src/components/**`
- Test: component/route tests and `tests/e2e/audit-workflow.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 9, and 10.
- Produces: owner-visible site list, crawl status, issue summary, filters, finding evidence/detail, URL inventory, and cancel/recheck controls.

- [ ] **Step 1: Write failing route and UI workflow tests**

Assert organization scoping, unverified-site crawl rejection, one-click baseline crawl, active progress, priority/severity/status filters, finding score explanation, affected URL examples, resolved/recurred labels, and crawl cancellation.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter web test && pnpm playwright test tests/e2e/audit-workflow.spec.ts`
Expected: FAIL because dashboard surfaces do not exist.

- [ ] **Step 3: Implement accessible server-rendered dashboard and APIs**

Use server components for reads and route handlers for mutations. Poll active crawl state with bounded intervals; do not expose Redis directly to the browser.

- [ ] **Step 4: Verify unit and browser flows**

Run: `pnpm --filter web test && pnpm playwright test tests/e2e/audit-workflow.spec.ts`
Expected: PASS at desktop and 390 px viewport with keyboard-accessible controls.

- [ ] **Step 5: Commit**

```bash
git add apps/web tests/e2e
git commit -m "feat: add SEO audit dashboard and crawl controls"
```

## Task 12: Scheduling, alerts, and operational stop controls

**Files:**
- Create: `apps/worker/src/scheduler.ts`, `apps/worker/src/jobs/send-summary.ts`
- Create: `packages/domain/src/schedule.ts`, `packages/queue/src/emergency-stop.ts`
- Create: `apps/web/src/app/api/sites/[siteId]/schedule/route.ts`
- Test: scheduler, alert, and stop integration tests

**Interfaces:**
- Produces: `computeNextRun(schedule, now): Date`; `scheduleDueCrawls(now)`; `setGlobalCrawlStop(enabled, actor)`; summary notifier interface.

- [ ] **Step 1: Write failing scheduling and stop tests**

Cover daily/weekly UTC schedules, deterministic per-site jitter up to 15 minutes, daylight-saving-safe display conversion, no overlap, disabled sites, global emergency stop, per-site pause, and one alert per terminal crawl state.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter worker test -- scheduler summary stop`
Expected: FAIL because scheduling and stop controls do not exist.

- [ ] **Step 3: Implement schedules and an email/webhook notifier boundary**

The MVP may log notifications when provider credentials are absent. Audit every schedule, pause, and emergency-stop mutation.

- [ ] **Step 4: Verify schedule and failure behavior**

Run: `pnpm --filter worker test -- scheduler summary stop`
Expected: PASS; stopped systems enqueue no crawl work and queued crawl processors exit safely.

- [ ] **Step 5: Commit**

```bash
git add apps/worker apps/web packages/domain packages/queue
git commit -m "feat: schedule audits and add crawl stop controls"
```

## Task 13: Representative Lighthouse audits and exports

**Files:**
- Create: `apps/worker/src/jobs/run-lighthouse.ts`, `packages/domain/src/performance.ts`
- Create: `apps/web/src/app/api/sites/[siteId]/exports/route.ts`, `packages/domain/src/export.ts`
- Modify: site dashboard files
- Test: Lighthouse selection and CSV/JSON export tests

**Interfaces:**
- Produces: `selectRepresentativePages(inventory, limit = 10): PageId[]`; `runLighthouseAudit(url, policy): PerformanceSnapshot`; `exportFindings(format, query): ReadableStream`.

- [ ] **Step 1: Write failing sampling, isolation, and export tests**

Assert deterministic selection across page groups, maximum 10 pages per broad crawl, browser timeout/resource limits, no private-network browser access, storage of LCP/CLS/TBT lab values with Lighthouse version, correct CSV escaping, JSON schema version, and organization scoping.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter worker test -- lighthouse && pnpm --filter web test -- exports`
Expected: FAIL because performance and export modules do not exist.

- [ ] **Step 3: Implement isolated Lighthouse worker and streamed exports**

Run Chromium as an unprivileged worker with a fresh profile and validated/pinned destination. Label results as lab data and do not invent INP from Lighthouse; display TBT as a diagnostic proxy only.

- [ ] **Step 4: Verify performance and export behavior**

Run: `pnpm --filter worker test -- lighthouse && pnpm --filter web test -- exports`
Expected: PASS with stable fixture metrics ranges and valid CSV/JSON downloads.

- [ ] **Step 5: Commit**

```bash
git add apps/worker apps/web packages/domain
git commit -m "feat: add performance sampling and finding exports"
```

## Task 14: Full-system hardening, seeded defect acceptance, and runbooks

**Files:**
- Create: `packages/test-sites/src/scenarios/seo-defects.ts`
- Create: `tests/e2e/baseline-audit.spec.ts`, `tests/security/crawler-boundaries.test.ts`
- Create: `docs/operations/local-development.md`, `docs/operations/crawler-policy.md`, `docs/operations/emergency-stop.md`
- Modify: `README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a reproducible acceptance environment and operator documentation.

- [ ] **Step 1: Build the seeded fixture-site acceptance test**

Seed at least one example of every Section 11 MVP check, run two crawls, repair selected fixtures between runs, and assert expected findings, deduplication, resolution, recurrence, unchanged-page skipping, and bounded completion.

- [ ] **Step 2: Add the independent security suite**

Exercise private IPv4/IPv6, redirect pivots, mixed DNS answers, DNS rebinding, metadata IPs, oversized/decompression responses, hostile HTML, malformed robots/sitemaps, and cross-tenant identifiers against the running system.

- [ ] **Step 3: Write runbooks and crawler identity documentation**

Document prerequisites, setup, migrations, owner bootstrap, worker operation, public crawler-contact page requirements, crawl budgets, emergency stop, data stored, data not stored, and known MVP limitations.

- [ ] **Step 4: Run the complete quality gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:security && pnpm test:e2e && pnpm build`
Expected: every command exits 0; the seeded baseline audit produces the exact expected rule IDs and no unexpected high-severity findings.

- [ ] **Step 5: Perform a controlled pilot crawl**

Run the default budget against a user-selected verified domain after confirming the public crawler contact URL. Expected: no emergency-stop triggers, crawl stays within all budgets, and the owner can review/export findings. Do not make this a CI dependency.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "test: verify SEO auditor MVP end to end"
```

## Completion gate

The MVP is complete only when Task 14's full quality gate passes from a clean checkout, the controlled pilot remains within its configured crawl budget, and every MVP acceptance criterion in the design document has corresponding automated or documented pilot evidence. Phase 2 (Search Console, IndexNow, field performance, and traffic-aware prioritization) begins under a separate approved implementation plan.

