# Observation Platform Migration and Recovery

The migration is non-destructive and proceeds per run through **expand → backfill → verify → switch → contract**. The legacy store remains authoritative until a run passes parity. Existing frozen legacy-only runs are never backfilled or silently made exportable.

## 1. Expand

Apply additive migrations, generate the Prisma client, publish pinned platform definitions, and deploy dual-write code with generalized reads disabled. Rehearse all migrations against a new empty PostgreSQL database. Rollback checkpoint: application code may return to legacy-only writes while additive tables remain unused.

## 2. Backfill

Backfill only explicitly eligible, unfrozen runs in bounded batches. Reuse stable run-local identities, persist a checkpoint after each batch, and make replay idempotent. Do not infer missing observations or reconstruct unavailable evidence. Rollback checkpoint: stop workers; legacy reads remain authoritative and incomplete generalized rows remain quarantined.

## 3. Verify

Compare counts, subjects, exact definition versions, status/value/reason envelopes, URL identities, ordered redirects/headers, Persian Unicode, provenance, limitations, diagnostics, and artifacts. Compute deterministic parity digests without sorting evidentiary arrays. Reject active executions, dangling dependencies, unavailable artifacts, unsafe payloads, or tenant mismatches. Rollback checkpoint: mark the run failed-parity and leave its read authority unchanged.

Persist the successful checkpoint and 64-character parity digest through `SnapshotRepository.recordParityCheckpoint`. The operation locks the run, is immutable on replay, and rejects any run already frozen by the legacy path.

## 4. Switch

Switch reads and snapshot eligibility per run only after recorded parity success. Freeze through `SnapshotRepository`; it verifies terminal lifecycle, coverage, dependency closure, artifact availability, exact producer revision, and tenant ownership. Monitor error, latency, parity, and export validation metrics. Rollback checkpoint: before any generalized snapshot/export exists, return the run to legacy reads; after freeze, never mutate or downgrade the snapshot—create an auditable superseding workflow instead.

Invoke `SnapshotRepository.switchToGeneralizedReads` before freeze. The persisted migration state must show `readAuthority = generalized` and a switch timestamp; freeze refuses a legacy authority or a historical legacy-frozen run. Evidence writes, diagnostic writes, artifact registration, and freeze serialize on the run lock.

## 5. Contract

Not authorized in this phase. Do not remove legacy tables, aliases, repository paths, or rollback data. Contract requires separate approval, retention analysis, backup/restore rehearsal, consumer migration evidence, and a destructive-change window.

## Recovery procedures

- Failed migration: stop deployment, retain the database, inspect migration history, correct with a new forward migration, and rehearse again on a fresh database.
- Interrupted backfill: resume from the durable checkpoint; stable IDs make completed writes idempotent.
- Parity mismatch: quarantine the run, preserve both stores, identify the first differing stable record, add a regression test, and replay only after review.
- Projection failure: source snapshots remain unchanged. Correct projection code with a new version and new execution; never overwrite artifacts.
- Artifact unavailable: block freeze/export, restore exact content-addressed bytes and verify hash/length, or truthfully record unavailability before a new collection.
- Tenant/security incident: disable affected operations, revoke authorization, preserve audit evidence, and follow the governance incident procedure.
