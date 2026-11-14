# Automated SEO Platform — Product Design

**Date:** 2026-11-14  
**Status:** Draft for approval

## 1. Product intent

Build a configurable SEO operations product that begins by auditing and monitoring the owner's websites, then grows into a multi-customer service capable of applying safe, approved fixes. The product must improve SEO through evidence-based website changes—not artificial searches, visits, clicks, or repeated indexing requests.

The first release will support the owner's websites while preserving the domain, account, job, and permission boundaries needed for a future multi-tenant SaaS.

## 2. Product principles

1. **Evidence before action.** Findings must include the affected URL, observed evidence, likely impact, confidence, and recommended resolution.
2. **Changes create value.** Repeated crawling alone does not improve rankings. The system exists to discover, prioritize, verify, and eventually repair meaningful problems.
3. **Safe by default.** Version one is read-only. Later writes require explicit permissions, previews, audit logs, rollback where possible, and configurable approval policies.
4. **Standards-compliant.** Respect `robots.txt`, rate limits, authentication boundaries, search-engine policies, and API quotas.
5. **Incremental processing.** Content hashes and crawl history prevent unchanged pages from being repeatedly analyzed.
6. **Outcome tracking.** Track indexing, impressions, clicks, position trends, conversions where available, and issue recurrence—not only an arbitrary health score.
7. **People-first content.** The product must not mass-produce low-value pages or manipulate search engines.

## 3. Goals

- Accept a verified website and automatically discover its crawlable pages.
- Detect high-value technical, on-page, structured-data, internal-linking, indexing, and performance issues.
- Prioritize findings by severity, confidence, page importance, traffic opportunity, and repair cost.
- Run appropriate checks on hourly, daily, weekly, or event-driven schedules.
- Connect verified sites to Google Search Console and later Bing Webmaster Tools/IndexNow.
- Record crawl snapshots and issue history so users can see regressions and resolved problems.
- Produce understandable recommendations suitable for both technical and nontechnical users.
- Establish a modular foundation for multiple customers, CMS/repository integrations, and controlled automatic fixes.

## 4. Non-goals for the MVP

- Fake traffic, automated Google searches, click simulation, or rank manipulation.
- Scraping Google result pages for rank tracking.
- Fully autonomous changes to production websites.
- AI-generated bulk articles or programmatic keyword pages.
- Backlink purchasing, outreach automation, or competitor content copying.
- Supporting every CMS and hosting platform.
- Enterprise billing, advanced agency white-labeling, or large-site distributed crawling.
- Guaranteed rankings or indexing.

## 5. Anti-goals

The product is a failure even if technically functional when it:

- overloads a customer's website;
- reports large numbers of low-value warnings without prioritization;
- treats a score increase as success without measurable search or user benefit;
- changes a site without clear authorization and recovery paths;
- submits unchanged URLs repeatedly;
- recommends schema or content that is misleading or invisible to users;
- creates a single-site architecture that must be discarded to become a SaaS.

## 6. Chosen approach

### Considered approaches

1. **Audit-first platform — chosen.** Build the crawler, diagnostic engine, evidence model, prioritization, integrations, reporting, and history first. Lowest risk and fastest path to a useful MVP.
2. **Automation-first platform.** Begin with CMS/repository write access and repairs. More immediately impressive, but too risky and integration-heavy before findings have proven accurate.
3. **AI SEO agent first.** Begin with a conversational agent that proposes and performs work. Strong product story, but unreliable without a deterministic audit and measurement foundation.

### Evolution path

`Audit engine → monitoring platform → approved automation → policy-controlled SEO agent`

AI will initially explain and summarize deterministic evidence. It will not be the source of truth for HTTP, indexing, schema, or performance findings.

## 7. Users and permissions

### MVP roles

- **Owner:** creates sites, configures crawling, connects external services, and views all results.
- **Viewer:** deferred until multi-user collaboration is needed.

### Future roles

- Account owner, administrator, SEO manager, developer, content editor, and read-only client.
- Permissions are scoped by organization and site.

### Domain verification

Public pages may be inspected for a preview, but persistent monitoring, external-service connections, and all write operations require ownership verification. Supported verification will progress from a DNS TXT record to HTML file/meta-tag methods where useful.

## 8. Core product experience

1. User creates an account and adds a domain.
2. System canonicalizes the origin and performs a safe preflight.
3. User verifies ownership.
4. System discovers `robots.txt`, sitemap declarations, submitted sitemaps, and internal links.
5. A bounded baseline crawl runs and creates an inventory of URLs.
6. The diagnostic engine creates deduplicated findings with evidence.
7. The dashboard presents health, urgent issues, opportunities, affected templates, and changes since the previous run.
8. User opens a finding to see why it matters and how to fix it.
9. Scheduled monitoring detects new issues and verifies resolved ones.
10. Search Console data gradually enriches prioritization and outcome reporting.

## 9. System boundaries and architecture

### Initial technology choices (builder calls)

- **Language:** TypeScript end to end for shared contracts and a small initial team.
- **Web application/API:** Next.js for the dashboard and API boundary.
- **Database:** PostgreSQL with Prisma migrations.
- **Background work:** Redis-backed BullMQ workers for crawl, analysis, integrations, and scheduled jobs.
- **Fetcher:** standards-aware HTTP client first; Playwright rendering only for pages that require JavaScript and within strict resource limits.
- **Object storage:** S3-compatible storage for optional large artifacts; the MVP stores normalized metadata and limited snapshots in PostgreSQL.
- **Deployment:** containerized services with separate web and worker processes. Local development uses Docker Compose.
- **Observability:** structured logs, job metrics, error tracking, and crawl-level correlation IDs.

These choices optimize delivery speed and provide clear service boundaries. They are not user-approved constraints until this document is approved.

### Logical components

- **Web/dashboard:** onboarding, site configuration, issues, reports, and integrations.
- **Application API:** authentication, authorization, validation, and product operations.
- **Scheduler:** creates idempotent jobs based on site policy and past results.
- **Crawler worker:** robots evaluation, sitemap parsing, URL frontier management, fetching, throttling, and extraction.
- **Analysis worker:** deterministic rules, page comparisons, site-wide aggregation, and prioritization.
- **Integration worker:** Search Console, IndexNow, email/webhook notifications, and later CMS/repository adapters.
- **PostgreSQL:** tenants, users, sites, verification, crawl runs, pages, snapshots, findings, integrations, and audit events.
- **Redis:** job queues, distributed locks, rate-limit state, and short-lived crawl frontier state.

### Tenant model

Every business record carries an `organization_id`; every website-scoped record also carries a `site_id`. Authorization is enforced at the service/repository boundary, not only in UI routes. The first deployment has one organization but uses the same boundaries as the SaaS version.

## 10. Crawl policy

- Fetch and parse `/robots.txt` according to RFC 9309 before crawling.
- Use a transparent product user agent with a public information/contact URL.
- Default to low concurrency per host and configurable delays.
- Apply exponential backoff and pause on `429`, repeated `5xx`, timeouts, or latency degradation.
- Restrict navigation to the verified site and explicitly allowed subdomains.
- Normalize URLs, strip fragments, and apply configurable parameter rules.
- Reject unsafe schemes and prevent server-side request forgery by blocking private, loopback, link-local, and metadata-service destinations after every DNS resolution and redirect.
- Enforce page, byte, duration, depth, and render budgets per crawl.
- Prefer sitemap and HTTP discovery; render JavaScript only when necessary.
- Store content hashes and important extracted fields; do not retain sensitive page content unnecessarily.
- Never submit unchanged URLs merely because a schedule ran.

## 11. Diagnostic scope

### MVP checks

- HTTP status, redirect chains/loops, soft-404 indicators, timeouts, and oversized responses.
- Indexability: robots rules, meta robots, `X-Robots-Tag`, canonical targets, and conflicting directives.
- Discovery: sitemap validity, orphan candidates, broken internal links, non-crawlable links, and excessive depth.
- Page metadata: missing/duplicate/poorly formed titles and descriptions, missing or multiple primary headings.
- URL consistency: protocol/host variants, trailing-slash conflicts, parameters, and canonical inconsistencies.
- Content signals: empty/thin-page indicators and exact/near duplicate clusters. These are review signals, not automatic quality judgments.
- Images: missing alternative text, broken images, dimensions, and excessive payload indicators.
- Structured data: JSON-LD parsing, supported types, required fields, and consistency with extracted visible content where deterministic checks are possible.
- Internationalization: basic `hreflang` validity and reciprocity when configured.
- Performance: Lighthouse lab sampling for representative page groups; Search Console/Core Web Vitals field data when available.
- Security/quality basics relevant to search: HTTPS consistency, mixed-content indicators, and mobile viewport presence.

### Later checks

- Template-level regression detection, log-file analysis, faceted-navigation modeling, advanced JavaScript rendering parity, accessibility signals, content decay, keyword cannibalization, entity/content coverage, and conversion-aware opportunity scoring.

## 12. Finding and prioritization model

Each finding contains:

- rule identifier and version;
- site, URL or URL group, and crawl run;
- severity and confidence;
- observed evidence and expected state;
- likely consequence;
- affected-page count and representative examples;
- first seen, last seen, status, and recurrence count;
- recommended resolution and verification method;
- source category: crawler, Search Console, performance, or integration;
- optional estimated impact and effort.

Priority is calculated from severity, confidence, affected page importance, number of affected URLs, impressions/clicks when available, recurrence, and estimated effort. The score must expose its factors rather than presenting unexplained AI certainty.

## 13. Scheduling model

“Hourly” is one available cadence, not the global default.

- **Hourly/event-driven:** availability of critical pages, newly published/changed URLs, integration events, and urgent regression verification.
- **Daily:** lightweight crawl of priority URLs, sitemap/robots changes, broken critical links, and Search Console synchronization when data availability warrants it.
- **Weekly:** broader site crawl, duplicate clustering, performance sampling, and site-wide reports.
- **On demand:** baseline audits, post-deployment verification, and user-requested rechecks.

Jobs are idempotent, resumable, bounded, and protected by per-site locks. Scheduler jitter prevents all tenants from running simultaneously.

## 14. External integrations

### Google Search Console

- OAuth connection to verified properties.
- Import search analytics, sitemap state, and selected URL inspection data.
- Respect quotas and prioritize representative or valuable URLs.
- Submit sitemaps when appropriate; do not pretend that the restricted Indexing API supports ordinary pages.

### Bing and IndexNow

- Add IndexNow after the product can reliably detect new, updated, and deleted URLs.
- Submit only real changes and retain delivery/audit status.

### Future write integrations

- GitHub/GitLab pull requests, WordPress, Shopify, and generic webhooks/API adapters.
- Write adapters implement capability discovery, preview, approval, execution, verification, and rollback metadata.

## 15. Security, privacy, and abuse prevention

- Strong tenant isolation and authorization tests.
- Encrypt OAuth tokens and credentials at rest; never place secrets in logs.
- DNS rebinding and SSRF defenses throughout crawling and redirect handling.
- Domain verification before persistent or privileged operations.
- Per-tenant quotas, rate limits, crawl budgets, and abuse monitoring.
- Sanitize untrusted HTML; never execute page scripts in the application process.
- Sandboxed browser workers with network and resource restrictions.
- Data retention controls and site deletion/export workflows before public launch.
- Immutable audit events for permission, integration, submission, and future write actions.
- Clear disclaimer that findings are recommendations and rankings/indexing are not guaranteed.

## 16. Phased roadmap

### Phase 0 — Retained foundations and technical validation

**Purpose:** prove safe crawling and establish the retained product skeleton. This is not throwaway work.

- Monorepo/application setup, local containers, configuration, migrations, and CI.
- Core data model with organization/site boundaries.
- Single-owner authentication.
- URL normalization, robots parser, safe fetcher, sitemap discovery, and bounded frontier.
- Minimal crawl-run visibility and structured logging.
- Initial tests for robots behavior, URL normalization, SSRF protection, redirects, and budgets.

**Exit:** one owned test site can be crawled safely and repeatably; extracted pages and crawl errors are visible; critical safety tests pass.

### Phase 1 — MVP: automated SEO auditor

**Purpose:** deliver useful, read-only SEO monitoring for the owner's sites.

- Domain onboarding and DNS verification.
- Baseline/on-demand crawls plus daily/weekly scheduling.
- MVP diagnostic rules and versioned finding model.
- Dashboard: sites, crawl status, issue summary, prioritized finding list, finding detail, and URL inventory.
- Crawl comparisons, content hashes, issue lifecycle, and email/webhook summary.
- Representative Lighthouse lab checks.
- Export findings as CSV/JSON.

**Exit:** the system finds known seeded defects, explains them with evidence, avoids duplicate noise, tracks resolution across crawls, and operates unattended on the owner's sites.

### Phase 2 — Measurement and smarter monitoring

**Purpose:** connect technical findings to real search outcomes.

- Google Search Console OAuth and property mapping.
- Search Analytics, sitemap, URL inspection sampling, and field performance data.
- Traffic-aware prioritization and page-group/template views.
- Configurable schedules, thresholds, exclusions, URL parameter rules, and alert policies.
- IndexNow for genuinely changed URLs.
- Trend reports covering indexing, impressions, clicks, issue history, and Core Web Vitals.

**Exit:** recommendations are ranked using real performance data and users can see whether fixes correlate with improved outcomes.

### Phase 3 — Private beta SaaS

**Purpose:** safely onboard external customers.

- Self-service accounts, organizations, invitations, roles, and site limits.
- Secure OAuth/token lifecycle, tenant administration, onboarding assistance, and support tooling.
- Subscription/billing integration and plan-based quotas.
- Scalable worker deployment, fair scheduling, per-tenant budgets, retention policies, backups, and operational dashboards.
- Privacy policy, terms, deletion/export, incident response, and abuse controls.
- Product analytics and feedback workflows.

**Exit:** a small group of external customers can onboard independently, remain isolated, understand reports, and operate within predictable cost and performance limits.

### Phase 4 — Assisted fixes

**Purpose:** convert trustworthy findings into safe implementation workflows.

- Fix specifications tied to rule versions.
- Git-based pull-request integration first, producing reviewable changes rather than direct production writes.
- Preview, approval, test, deploy-status, post-deploy verification, and rollback metadata.
- Selected low-risk fixes: metadata/templates, sitemap configuration, broken internal links, supported schema, and image attributes where context is unambiguous.
- AI explanations and drafts grounded in crawler evidence, with mandatory human approval.

**Exit:** approved fixes are reproducible, auditable, tested, and verified after deployment without silently changing production.

### Phase 5 — Policy-controlled SEO agent

**Purpose:** automate recurring work within explicit customer policies.

- Site-specific goals, protected paths, risk levels, approval thresholds, and maintenance windows.
- Agent plans grounded in deterministic findings and integration capabilities.
- Automatic execution only for allowlisted, reversible, low-risk operations.
- Experiment tracking, guardrails, anomaly detection, stop controls, and outcome evaluation.
- CMS adapters and an integration SDK.

**Exit:** the agent can resolve selected issue classes end to end while respecting policy, producing complete evidence and audit history, and escalating ambiguous decisions.

## 17. MVP acceptance criteria

- An owner can add and verify at least one domain.
- The crawler respects robots rules and configured limits.
- It cannot be redirected to private/internal network targets.
- It discovers URLs from sitemaps and crawlable internal links.
- Interrupted crawl jobs can retry without corrupting or duplicating results.
- Every check listed under **MVP checks** in Section 11 is either implemented with versioned, evidence-backed findings or explicitly deferred through an approved scope change.
- Findings are deduplicated, prioritized, filterable, and tracked from open to resolved/recurred.
- Unchanged pages do not trigger redundant deep analysis.
- A scheduled crawl and an on-demand crawl both work.
- Critical failures produce an alert and do not overwhelm the target site.
- Automated tests cover security boundaries and representative diagnostic fixtures.
- The system contains no automated search-query/click behavior and no unsupported indexing submission.

## 18. Success measures

### MVP product measures

- Percentage of crawls completing within configured budgets.
- False-positive rate from owner review.
- Percentage of high-priority findings acted upon and verified resolved.
- Issue recurrence rate and mean time to detection.
- Noise ratio: duplicate or low-value findings per actionable finding.

### Later customer/outcome measures

- Time to first useful finding.
- Activation: verified site plus completed baseline audit.
- Retention and monitored-site activity.
- Search impressions/click trends for affected pages, treated as contextual rather than guaranteed causation.
- Percentage of assisted fixes merged, deployed, and verified.
- Automation rollback/escalation rate.

## 19. Testing strategy

- Unit tests for normalization, robots evaluation, extraction, rules, scoring, and state transitions.
- Fixture sites covering redirects, canonicals, directives, duplicate pages, schema, malformed HTML, and JavaScript rendering.
- Integration tests for queue idempotency, retries, crawl budgets, database constraints, and tenant isolation.
- Security tests for SSRF, redirect pivots, DNS changes, oversized responses, decompression bombs, and hostile HTML.
- Contract tests for external integrations with recorded/synthetic responses.
- End-to-end tests for onboarding, verification, crawl, finding review, and resolution.
- Controlled canary crawls before enabling new rule versions or fetch behavior broadly.

## 20. Risks and mitigations

- **False positives:** version rules, expose evidence, group template issues, and collect user feedback.
- **Crawler cost:** incremental processing, strict budgets, HTTP-first fetching, and representative rendering/performance samples.
- **Target-site impact:** per-host throttling, backoff, maintenance windows, and emergency stop controls.
- **Security exposure:** verification, SSRF defenses, sandboxing, secret encryption, and tenant isolation.
- **API limitations:** quota-aware sampling, caching, backoff, and clear product messaging.
- **SEO overpromising:** measure outcomes while explicitly avoiding guarantees.
- **Premature automation:** require proven diagnostic precision before enabling a fix type.
- **Architecture overhead:** keep logical boundaries in one deployable codebase initially; split services only with operational evidence.

## 21. Decisions left to implementation planning

- Exact package layout and UI component system.
- Authentication provider versus self-hosted authentication.
- Hosting provider and managed PostgreSQL/Redis vendors.
- Email provider and error-tracking vendor.
- The initial set and precise thresholds of diagnostic rules.
- Which owner-controlled websites will serve as crawl fixtures and production pilots.

These decisions do not change the product direction, but the implementation plan must state its choices before code is written.

