# Web onboarding guide

The web experience supports owner sign-in, tenant-scoped website registration, an explicit owner authorization declaration, one bounded queued crawl per website, and persisted run status.

## Use the local web flow

1. Start PostgreSQL and Redis and apply the committed migrations as described in the repository README.
2. Ensure the local database contains the owner created by `bootstrapOwner` in `packages/db/src/seed.ts`. The repository does not yet expose a production-style seed command.
3. Load the required environment variables, set `$env:SOURCE_REVISION = git rev-parse HEAD`, and run `pnpm dev`. This starts both the web app and BullMQ worker.
4. Open <http://localhost:3000>. The page explains the evidence-first workflow and collection boundaries.
5. Select **Open workspace**. An unauthenticated request is redirected to `/login`.
6. Sign in with the bootstrap owner email and password configured when that owner was created.
7. In `/sites`, enter:
   - a descriptive name of 1–80 characters;
   - an absolute HTTP or HTTPS URL, including its scheme.
8. Select **Register website**. The site is persisted for the signed-in organization and appears with the state **Ready for authorization**.
9. Open the website row. Read the declaration carefully, check that you own the site or have permission to crawl it, and select **Record authorization**. This records permission; it is not DNS, file, or meta-tag verification.
10. Confirm that the displayed seed URL and allowed host match the registered origin. They are derived server-side and cannot be expanded by submitted form fields.
11. Choose maximum pages (1–100, default 25), maximum depth (0–3, default 1), and maximum duration (10–300 seconds, default 60). Every response is capped at 5 MiB.
12. Select **Start bounded crawl**. Only one `PENDING` or `RUNNING` crawl can hold the website's active lock.
13. The detail page shows persisted status (`PENDING`, `RUNNING`, or a terminal state), discovered/attempted/collected/failed coverage, stop reason, and safe errors. Active pages refresh every five seconds; terminal pages remain stable.

The URL parser rejects credentials, unsupported protocols, missing schemes, and malformed URLs. It stores only the normalized origin, so paths, query strings, and fragments are intentionally discarded.

## Operational behavior

- PostgreSQL stores authorization, run lifecycle, coverage, and errors. Redis transports the job; the worker performs collection.
- A Redis publication failure removes only the pending run created by that request, allowing a later retry. Previously stored idempotent runs remain replayable.
- Worker exceptions mark the run `FAILED`, clear the active-site lock, and persist a generic structured error rather than raw infrastructure details.
- Each redirect is resolved and checked again. HTTP connects to the validated address while preserving the registered hostname for `Host` and HTTPS SNI.
- `COMPLETED` means the bounded run finished; it does not claim complete internet discovery.

There is no schedule, recurring monitoring, SEO score, recommendations, rankings, public signup, or billing flow.

## Stop the local stack

Press `Ctrl+C` in the `pnpm dev` terminal to close the web and worker processes gracefully. Preserve PostgreSQL and Redis data with:

```powershell
docker compose down
```

Use `docker compose down --volumes` only when you intentionally want to permanently delete local container data.

## Quick verification

Run the web checks from the repository root:

```powershell
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter worker test
pnpm --filter worker typecheck
```

Database integration tests require `TEST_DATABASE_URL`. Use a disposable test database because those tests clear their target data.
