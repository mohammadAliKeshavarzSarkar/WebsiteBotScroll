# `seo-crawl-evidence` 0.1.0 field dictionary

WebsiteBotScroll owns this Draft 2020-12 contract. All objects are closed. Fields marked nullable use JSON `null`; omission is not a substitute for an unavailable observation.

## Envelope

| Path | Meaning |
| --- | --- |
| `contract.name` | Constant `seo-crawl-evidence`. |
| `contract.version` | Exact contract version, currently `0.1.0`. |
| `producer` | Producer name plus independently versioned producer, schema, normalization policy, extractor, renderer, and diagnostic rules. |
| `run` | Authorization scope, lifecycle, limits, measured coverage, termination, and limitations for one crawl. |
| `pages[]` | Run-local page evidence records. |
| `diagnostics` | Optional deterministic diagnostics stage, represented as an observation group. |
| `errors[]` | Structured collection or extraction errors; never strategic recommendations. |

## Run

`run.id` is unique within an exported package. `trigger` is `manual`, `scheduled`, or `api`. `lifecycle` is `queued`, `running`, `completed`, `partial`, `failed`, or `cancelled`. `started_at` and nullable `finished_at` are RFC 3339 timestamps. Terminal lifecycles require `finished_at`; nonterminal lifecycles forbid it.

`scope.seed_urls` and `scope.allowed_hosts` state the authorized boundary. Optional include/exclude patterns retain producer syntax. `limits` records configured page, depth, duration, and optional response-byte limits. `coverage` records discovered, attempted, collected, failed, and optionally unattempted counts. `stop_reason` states why collection stopped. `limitations[]` supplies stable `code`, human-readable `message`, and optional `page_id`.

## Page identity

`pages[].id` is run-local and stable. `depth` is discovery depth. `url_identity` keeps `discovered_url`, `requested_url`, `normalized_url`, `final_url`, and declared `canonical_urls[]` separate. Equality never causes automatic identity merging.

## Observation groups

Every group has a unique `id`, one of the seven `status` values, a `value`, `reasons[]`, optional group `provenance`, and optional `field_overrides[]`. Provenance records collection `method`, `collected_at`, source (`http`, `source_html`, `rendered_dom`, or `derived`), and optional method `version`. A field override identifies its value by JSON Pointer and supplies independent provenance or reasons.

Page groups are:

- `http`: ordered HTTP transactions and the final transaction ID.
- `metadata`: title, meta description, canonical declarations, robots tokens, and language.
- `headings`: ordered heading level/text pairs.
- `structured_data`: format, parse outcome, discovered types, parse error, and optional raw fragment hash.
- `content`: separate raw-byte and normalized-content SHA-256 values, hash-method version, and visible-text summary. Raw HTML is excluded.
- `links`: target URL, internal/external kind, discovery method, optional target page reference, and whether the target was inspected.
- `rendering`: rendered URL and DOM hash when browser collection exists.

## HTTP transactions and headers

Transactions retain request and response URLs, method, status, timestamps, byte measurements, ordered headers, and nullable redirect target. Header names are lower-case allowlisted names. Each header's `values[]` preserves repeated values and their order. `Content-Length` is not substituted for transferred or decoded bytes.

Allowed names are `location`, `content-type`, `x-robots-tag`, `link`, `content-language`, `content-length`, `content-encoding`, `retry-after`, `cache-control`, `vary`, `etag`, `last-modified`, and `age`. Cookies, authorization, credentials, signed request data, and unrestricted request headers are excluded.

## Diagnostics and errors

A diagnostic has stable `id`, `rule_id`, `rule_version`, `policy_version`, `subject_page_id`, outcome (`pass`, `fail`, `inconclusive`, or `not_applicable`), referenced `observation_ids`, and limitations. An error has stable `id`, stage, code, message, timestamp, retryability, and optional page/observation references.

## Reason-code categories

Reason strings are stable machine-readable identifiers. Initial categories are lifecycle (`stage_not_run`), configuration (`browser_rendering_disabled`), coverage (`page_limit_reached`, `target_not_inspected`, `incomplete_evidence`), collection (`timeout`, `network_error`), capability (`unsupported_method`), and applicability (`not_applicable_to_resource`). New codes may be added only in a reviewed contract version.
