# Stage A.2 Synthetic Evidence Exchange

This runbook produces the first private `seo-crawl-evidence/0.1.0` pair from actual persisted collection. REST, MCP, strategic adapters, customer crawling, and operational integration remain deferred.

## Preconditions

- Use a publicly reachable synthetic site controlled by the owner; do not bypass SSRF/private-network protections.
- Record explicit authorization, exact seed URLs/allowed hosts, bounded limits, and a `MANUAL` trigger.
- Confirm DNS/TLS, robots behavior, deterministic routes, repeated headers, Persian content, redirects, malformed structured data, absent metadata, and bounded failures.
- Use the reviewed clean 40-character producer commit. The crawl run's producer revision and export commit must match.
- Keep `DATABASE_URL`, credentials, output directory, evidence, and manifest private.

## Collect and freeze

1. Apply migrations and start PostgreSQL, Redis, worker, and web processes.
2. Create the authorization and manual crawl run with bounded pages, depth, duration, and response bytes.
3. Execute the real crawler. Do not hand-assemble fixtures or reconstruct missing evidence.
4. Confirm terminal coverage arithmetic, stop reason, errors, limitations, generalized/legacy parity, terminal observation/diagnostic executions, and available artifacts.
5. Freeze exactly once through `SnapshotRepository`. Record organization ID, run ID, snapshot ID, authorization reference, producer revision, scope, coverage, and snapshot SHA-256.
6. Confirm the published `seo-crawl-evidence` `0.1.0` projection declares every observation definition and diagnostic rule present in the frozen snapshot.

## Export on Windows PowerShell

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/website_bot_scroll"
$producerCommit = git rev-parse HEAD
git status --porcelain # must produce no tracked source changes for the reviewed implementation
pnpm --filter @website-bot-scroll/evidence-producer evidence:export -- <organization-id> <snapshot-id> D:\Private\WebsiteBotScrollExchange $producerCommit
```

The destination files must not exist. Export replays canonical validation and profile preflight against exact serialized bytes, then creates the evidence and frozen 17-field manifest without overwrite.

The command also stores the exact evidence bytes below `<destination>\.artifacts`, records a completed projection execution, and prints its execution and output-artifact IDs. A missing projection definition, undeclared snapshot dependency, checksum mismatch, or unavailable artifact store fails the command. Evidence and manifest filenames must be distinct; partial two-file publication is rolled back.

## Verify and deliver

```powershell
pnpm --filter @website-bot-scroll/evidence-producer evidence:verify -- D:\Private\WebsiteBotScrollExchange\<run-id>.evidence.json D:\Private\WebsiteBotScrollExchange\<run-id>.manifest.json <expected-authorization-ref>
Get-FileHash D:\Private\WebsiteBotScrollExchange\<run-id>.evidence.json -Algorithm SHA256
```

Record filenames, SHA-256, byte length, contract/profile identities, producer commit, authorization/scope, timestamps, coverage, limitations, validation result, and preflight result. Never edit either file. Deliver the private pair through the separately approved secure channel and retain SEO Engineering's independent receipt for the same bytes.

Before delivery, read the recorded projection artifact back through the configured artifact store and confirm its bytes hash to the manifest's `evidence_sha256`. The automated release gate in `packages/evidence-producer/test/real-crawl-exchange.integration.test.ts` exercises this full persisted path with redirects, repeated headers, Persian text, a limitation, and a diagnostic dependency.

Any mismatch, BOM, malformed JSON, duplicate member, unsafe number, timestamp/URL profile failure, authorization mismatch, or changed byte keeps the exchange pending. Do not repair delivered evidence; correct collection/projection under a new execution. After acceptance, revoke temporary authorization and tear down the synthetic deployment according to the owner-approved retention schedule.
