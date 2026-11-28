# WebsiteBotScroll

WebsiteBotScroll is a read-only, evidence-based SEO auditing platform. The repository is currently an MVP under active development.

## Current status

The following foundations are runnable today:

- Evidence-first product landing page and owner login
- Protected, tenant-scoped website registration workspace
- Owner-declared crawl authorization with exact registered-origin scope
- Bounded manual crawl submission and persisted run status
- BullMQ worker consumption with production DNS and HTTP(S) adapters
- PostgreSQL persistence and tenant-safe repositories
- Owner authentication and session storage
- URL normalization and SSRF/network-boundary protection
- `robots.txt` evaluation and bounded sitemap discovery

An authenticated owner can register a website, record an owner declaration, and start one bounded manual crawl. The detail page shows persisted lifecycle, coverage, stop reason, and safe collection errors. This is not technical domain verification, scheduled monitoring, or an SEO findings/recommendations product.

## Requirements

- Node.js 26 or newer
- pnpm 11.25.0
- Docker Desktop with Docker Compose, for PostgreSQL and Redis
- Git

Check the installed versions:

```powershell
node --version
pnpm --version
docker --version
docker compose version
```

If pnpm is unavailable, enable the package manager bundled with Node:

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
```

## Quick start on Windows

Run these commands from the repository root.

### 1. Install dependencies

```powershell
pnpm install
```

### 2. Create local environment settings

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace at least these development placeholders:

```dotenv
AUTH_SECRET=replace-with-a-random-secret-of-at-least-32-characters
CRAWLER_CONTACT_URL=https://your-domain.example/crawler
BOOTSTRAP_OWNER_PASSWORD=replace-with-at-least-16-characters
```

Generate a suitable authentication secret with Node:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The worker and database commands currently read configuration from the process environment. Load `.env` into the active PowerShell session:

```powershell
Get-Content .env | Where-Object { $_ -match '^[^#].*=.*$' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "Env:$name" -Value $value
}
```

Repeat that command in each new terminal before running the worker, migrations, or integration tests.

The web process also records the exact source revision on every crawl. Set it from the checked-out commit in each application terminal:

```powershell
$env:SOURCE_REVISION = git rev-parse HEAD
```

### 3. Start PostgreSQL and Redis

```powershell
docker compose up -d
docker compose ps
```

The default services are available at:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### 4. Generate the database client and apply migrations

```powershell
pnpm db:generate
pnpm db:migrate:test
```

Despite its historical name, `db:migrate:test` applies the committed migrations to the database selected by `DATABASE_URL`.

### 5. Start the application

```powershell
pnpm dev
```

Open:

- Web application: <http://localhost:3000>
- Health endpoint: <http://localhost:3000/api/health>
- Login page: <http://localhost:3000/login>
- Owner website workspace: <http://localhost:3000/sites>

The worker prints a JSON `ready` event after configuration is valid and its BullMQ runtime is created. Redis must remain running while crawl requests are submitted and processed.

Open the home page, select **Open workspace**, and sign in with the owner account already bootstrapped in your local database. In `/sites`, register an absolute HTTP(S) URL, open the website row, and record the owner declaration. Choose maximum pages (1–100), depth (0–3), and duration (10–300 seconds), then start the crawl. The response limit is fixed at 5 MiB, scope cannot expand beyond the registered host, and only one run can be active per website. Refresh the detail page to inspect persisted status; active runs refresh automatically every five seconds.

Owner bootstrap logic exists in `packages/db/src/seed.ts`, but a production-style seed command is not wired yet. A fresh database therefore needs an owner record created through the existing bootstrap function before the login flow can be used.

## Run quality checks

Fast checks that do not require the database:

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

Run all unit tests:

```powershell
pnpm test
```

Database integration tests run only when `TEST_DATABASE_URL` is defined. They clear data in that database, so never point it at a database containing important data.

Create a separate local test database:

```powershell
docker compose exec postgres createdb -U postgres website_bot_scroll_test
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/website_bot_scroll_test"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm db:migrate:test
pnpm test
```

To run only crawler tests:

```powershell
pnpm --filter @website-bot-scroll/crawler test
```

## Stop local services

Stop the web and worker processes with `Ctrl+C` in the terminal running `pnpm dev`. Then stop containers while preserving their data:

```powershell
docker compose down
```

Stop containers and remove the local PostgreSQL and Redis volumes:

```powershell
docker compose down --volumes
```

The second command permanently deletes the local container data.

## Repository structure

```text
apps/web             Next.js application and authentication routes
apps/worker          Background worker entry point
packages/config      Validated environment configuration
packages/crawler     URL, network, robots, and sitemap crawler foundations
packages/evidence-contract  Canonical crawl-evidence schema, fixtures, and validators
packages/db          Prisma schema, migrations, repositories, and owner seed logic
packages/domain      Shared domain identifiers and types
packages/test-sites  Hostile and edge-case crawler fixtures
docs/superpowers     Product specification and phased implementation plan
```

## Product and implementation documents

- [Product design](docs/superpowers/specs/2026-11-14-automated-seo-platform-design.md)
- [MVP implementation plan](docs/superpowers/plans/2026-11-14-seo-auditor-mvp.md)
- [Observation definition governance](docs/operations/observation-definition-governance.md)
- [Observation platform migration and recovery](docs/operations/observation-platform-migration.md)
- [Stage A.2 synthetic exchange runbook](docs/operations/stage-a2-synthetic-exchange.md)
- [Web onboarding guide](docs/operations/web-onboarding.md)

## Evidence interoperability

Stage A.1 defines the reviewable `seo-crawl-evidence` 0.1.0 boundary without coupling this repository to an SEO intelligence engine. See the [interoperability architecture](docs/architecture/evidence-interoperability.md), [evidence preservation gaps](docs/architecture/evidence-preservation-gaps.md), and the package's machine-readable [review manifest](packages/evidence-contract/review-manifest.json).

### Export and verify a frozen evidence snapshot

Load the private database URL in PowerShell, then export with the exact reviewed producer commit:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/website_bot_scroll"
pnpm --filter @website-bot-scroll/evidence-producer evidence:export -- <organization-id> <snapshot-id> D:\Private\WebsiteBotScrollExchange <40-character-producer-commit>
```

The destination must be private and the generated evidence and manifest files must not already exist. Verify the delivered pair without modifying either file:

```powershell
pnpm --filter @website-bot-scroll/evidence-producer evidence:verify -- D:\Private\WebsiteBotScrollExchange\<run-id>.evidence.json D:\Private\WebsiteBotScrollExchange\<run-id>.manifest.json <expected-authorization-ref>
```

The verifier checks the exact evidence byte length and SHA-256 before parsing, then independently replays canonical validation, exchange-profile preflight, and type-sensitive manifest consistency.

## Troubleshooting

### Environment validation fails

Make sure all values from `.env.example` are loaded into the current terminal. `AUTH_SECRET` must contain at least 32 characters and `BOOTSTRAP_OWNER_PASSWORD` at least 16.

### PostgreSQL connection fails

```powershell
docker compose ps
docker compose logs postgres
```

Confirm that `DATABASE_URL` is:

```text
postgresql://postgres:postgres@localhost:5432/website_bot_scroll
```

### Port 3000 is already in use

Start only the web app on another port:

```powershell
pnpm --filter web dev -- --port 3001
```

### Crawl submission says the queue is unavailable

Confirm Redis and the worker are running, and that `SOURCE_REVISION` is the exact 40-character output of `git rev-parse HEAD`:

```powershell
docker compose ps
docker compose logs redis
$env:SOURCE_REVISION
```

If publication fails, the newly-created pending run is removed so it does not permanently block a retry.

### Generated Prisma client is stale

```powershell
pnpm db:generate
pnpm typecheck
```
