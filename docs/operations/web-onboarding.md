# Web onboarding guide

The web experience currently supports a public product overview, owner sign-in, and tenant-scoped website registration. It deliberately stops before authorization and crawl execution.

## Use the local web flow

1. Start PostgreSQL and apply the committed migrations as described in the repository README.
2. Ensure the local database contains the owner created by `bootstrapOwner` in `packages/db/src/seed.ts`. The repository does not yet expose a production-style seed command.
3. Load the required environment variables into the terminal and run `pnpm dev`.
4. Open <http://localhost:3000>. The page explains the evidence-first workflow and collection boundaries.
5. Select **Open workspace**. An unauthenticated request is redirected to `/login`.
6. Sign in with the bootstrap owner email and password configured when that owner was created.
7. In `/sites`, enter:
   - a descriptive name of 1–80 characters;
   - an absolute HTTP or HTTPS URL, including its scheme.
8. Select **Add website**. The site is persisted for the signed-in organization and appears with the state **Ready for authorization**.

The URL parser rejects credentials, unsupported protocols, missing schemes, and malformed URLs. It stores only the normalized origin, so paths, query strings, and fragments are intentionally discarded.

## Current product boundary

Website registration does not authorize crawling and does not start network activity. The current interface has no crawl-start button, scheduler, SEO score, findings view, recommendations, public signup, or billing flow. Authorization and bounded crawl controls are the next product increment. Until those controls exist, `Ready for authorization` means only that the tenant-owned website record was created successfully.

## Quick verification

Run the web checks from the repository root:

```powershell
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
```

Database integration tests require `TEST_DATABASE_URL`. Use a disposable test database because those tests clear their target data.
