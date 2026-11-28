# Front Page and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a credible public product page and a protected, tenant-aware website onboarding workspace.

**Architecture:** Keep the public narrative and authenticated workspace as server-rendered Next.js routes. Put site-origin validation in a pure module, expose site creation through an authenticated route with injected test seams, and reuse the existing Prisma-backed `SiteRepository` for persistence.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL, Vitest, plain CSS.

**Spec:** `docs/superpowers/specs/2026-11-23-front-page-onboarding-design.md`

## Global Constraints

- No new UI framework or runtime dependency.
- Never present crawl execution, scheduling, scores, or recommendations as available in this increment.
- Require tenant authentication in every protected page/action and preserve tenant-scoped repository calls.
- Accept absolute HTTP(S) URLs, reject credentials, and persist only the normalized origin without path, query, or fragment.
- Maintain keyboard accessibility, visible focus, semantic labels, and responsive layouts.

## Review Focus

- Domains pasted without a scheme receive a clear validation error rather than silent reinterpretation.
- Credentials are rejected; paths, queries, and fragments are safely discarded while only the normalized origin is persisted.
- An unauthenticated direct API request cannot create a site.
- One organization cannot list or create a site under another organization.
- Empty and long site names fail clearly without losing the user’s context.

---

### Task 1: Public product narrative and shared visual system

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/styles.css`
- Create: `apps/web/src/app/page.test.tsx`

**Interfaces:**
- Produces: public navigation, product narrative, workflow sections, and `/sites` primary CTA.
- Consumes: no authenticated data.

- [ ] Write a rendering test asserting the product promise, evidence workflow, read-only boundary, and `/sites` CTA.
- [ ] Run `pnpm --filter web exec vitest run src/app/page.test.tsx` and confirm it fails against the placeholder.
- [ ] Implement the responsive landing page, metadata, CSS tokens, focus states, and reduced-motion behavior.
- [ ] Run the focused test, `pnpm --filter web lint`, and `pnpm --filter web typecheck` green.
- [ ] Commit with `feat: build evidence-first product landing page`.

### Task 2: Site input contract

**Files:**
- Create: `apps/web/src/lib/site-input.ts`
- Create: `apps/web/src/lib/site-input.test.ts`

**Interfaces:**
- Produces: `parseCreateSiteInput(value: unknown): { name: string; origin: string }`.
- Consumes: submitted form-compatible values.

- [ ] Write tests for normalized HTTP(S) origins, stripping pasted paths/queries/fragments, and rejection of missing schemes, credentials, unsupported protocols, empty names, and names over 80 characters.
- [ ] Run the focused test and confirm missing parser failures.
- [ ] Implement the pure parser with `URL` and explicit error messages.
- [ ] Run focused tests green and commit with `feat: validate website onboarding input`.

### Task 3: Authenticated site creation action

**Files:**
- Create: `apps/web/src/app/api/sites/route.ts`
- Create: `apps/web/src/app/api/sites/route.test.ts`
- Create: `apps/web/src/lib/server-site-repository.ts`
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/proxy.test.ts`

**Interfaces:**
- Consumes: `parseCreateSiteInput`, `requireOwnerSession`, and `SiteRepository.create`.
- Produces: `createSite(request, dependencies): Promise<Response>` and `POST(request): Promise<Response>`.

- [ ] Write route tests proving authenticated tenant ownership, unauthenticated rejection, validation failure, and redirect-on-success.
- [ ] Write proxy test proving `/api/sites` is protected in addition to `/sites/*`.
- [ ] Run focused tests and confirm route/matcher behavior is missing.
- [ ] Implement injected action dependencies, production repository factory, and explicit session enforcement.
- [ ] Run focused tests, web lint, and web typecheck green.
- [ ] Commit with `feat: add authenticated site onboarding action`.

### Task 4: Protected sites workspace and login UX

**Files:**
- Create: `apps/web/src/app/sites/page.tsx`
- Create: `apps/web/src/app/sites/sites-view.tsx`
- Create: `apps/web/src/app/sites/sites-view.test.tsx`
- Modify: `apps/web/src/app/login/page.tsx`

**Interfaces:**
- Consumes: owner session, tenant-scoped `SiteRepository.list`, and `POST /api/sites`.
- Produces: accessible add-site form, tenant site list, onboarding empty state, and honest readiness labels.

- [ ] Write rendering tests for empty, populated, validation-error, and created-success states.
- [ ] Run focused tests and confirm the workspace is absent.
- [ ] Implement server data loading and the presentation component; show `Ready for authorization`, never a fabricated audit state.
- [ ] Restyle login to match the product while preserving its existing POST contract.
- [ ] Run web tests, lint, typecheck, and production build green.
- [ ] Commit with `feat: add owner website workspace`.

### Task 5: Release verification and operating guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/local-development.md` if present; otherwise create `docs/operations/web-onboarding.md`.

**Interfaces:**
- Consumes: completed public and protected flows.
- Produces: local usage instructions and verified UX release evidence.

- [ ] Document opening `/`, signing in, adding a domain, and the current authorization/crawl limitation.
- [ ] Run `git diff --check`, `pnpm lint`, `pnpm typecheck`, `pnpm -r --workspace-concurrency=1 test`, and `pnpm build`.
- [ ] Verify the page locally at desktop and narrow widths if preview infrastructure is available.
- [ ] Commit with `docs: explain website onboarding flow`.
