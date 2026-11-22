# Observation Definition Governance

## Ownership and publication

WebsiteBotScroll Engineering owns the global observation, collector, diagnostic-rule, and export-projection registries. Tenant-facing code cannot publish definitions. Publication requires the internal repository capability and two-person review of identity, schema, scopes, statuses, sensitivity, retention, compatibility, and fixtures.

Published `(key, version)` content is immutable. A correction creates a new strict `MAJOR.MINOR.PATCH` version. Deprecation prevents new executions but never invalidates historical evidence. Definitions referenced by observations, diagnostics, snapshots, or exports are not deleted.

## Review checklist

Before publication:

1. Confirm the key and version satisfy platform identity rules and do not reuse different semantics.
2. Confirm JSON Schema is closed, local, data-only, and contains no remote references or executable behavior.
3. Run schema compilation plus valid, invalid, depth, property, array, and byte-limit tests.
4. Review allowed scopes/statuses and the `observed`/`partial` versus unavailable payload rules.
5. Classify sensitivity and retention; raw HTML, credentials, cookies, authorization, unrestricted headers, and signed request material remain prohibited.
6. Pin collector capabilities, diagnostic inputs/outcomes/policy versions, or projection dependencies to exact versions.
7. Run tenant, immutability, idempotency, and compatibility tests against PostgreSQL.

Platform limits are 1 MiB schema/payload bytes, depth 32, 1,024 aggregate object properties, and 10,000 aggregate array items. Artifact policy is capped at 50 MiB per artifact and 250 MiB per execution.

## Compatibility and deprecation

- Patch: same meaning and compatible validation correction; historical payloads remain valid.
- Minor: additive semantics explicitly understood by pinned consumers.
- Major: incompatible payload, scope, status, identity, or interpretation change.

Consumers must reject unknown versions. They must not silently reinterpret, default, normalize, or repair evidence. Deprecation requires an announced replacement, migration impact, last-publish date, rollback owner, and monitoring window.

## Retention and incidents

Frozen snapshot dependencies and projection outputs are pinned. Ordinary update/deletion is prohibited; snapshot rows also have a database immutability trigger. A future privileged archival workflow must verify all references and preserve an audit record before retention removal.

For schema drift, cross-tenant access, secret persistence, hash mismatch, or mutable frozen evidence: stop publication/export, preserve identifiers and structured logs, revoke affected authorization, isolate artifacts, reproduce with read-only queries, and publish a new version or migration. Never edit delivered bytes. Record impact, exact revisions, affected tenants/runs, containment, recovery evidence, and follow-up tests.
