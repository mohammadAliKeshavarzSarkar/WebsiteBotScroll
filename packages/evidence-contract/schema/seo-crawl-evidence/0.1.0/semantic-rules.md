# `seo-crawl-evidence` 0.1.0 semantic rules

## Collection states

- `observed`: collection established the supplied non-null value. An empty array is inspected absence.
- `partial`: the non-null value contains useful evidence but coverage is incomplete; at least one reason is mandatory.
- `unknown`: a reliable value cannot be established; value is null and reasons are mandatory.
- `not_collected`: the supported operation was not performed; value is null and reasons are mandatory.
- `failed`: collection was attempted and failed; value is null and reasons are mandatory.
- `unsupported`: this producer cannot collect the information; value is null and reasons are mandatory.
- `not_applicable`: the observation does not apply; value is null and reasons are mandatory.

Failed collection must never be encoded as an observed empty array. Partial evidence cannot establish definitive absence or complete discovery.

## Lifecycle and coverage

Operational completion and discovery completeness are independent. `completed` means the run stopped normally; it does not assert that every possible site URL was discovered. Coverage counters must be nonnegative and satisfy `collected + failed = attempted`, `attempted <= discovered`, and, when supplied, `unattempted = discovered - attempted`. The number of page records equals collected coverage.

Terminal lifecycles (`completed`, `partial`, `failed`, `cancelled`) require `finished_at`; `queued` and `running` require it to be null. Partial runs require a stop reason and a limitation explaining incomplete coverage.

## Identity and references

Page, observation, diagnostic, transaction, link, and error IDs are run-local. Page, observation, diagnostic, and error IDs must be unique in their namespaces. Every page or observation reference must resolve. Canonical declarations are evidence, not identity aliases.

HTTP transactions are ordered. Each redirect target must equal the next transaction's request URL. `final_transaction_id` names the last transaction, whose response URL must equal `url_identity.final_url`.

## Diagnostics

Diagnostics are optional and deterministic. Each diagnostic identifies both its rule version and the policy version used to interpret evidence. `subject_page` evidence must be owned by the subject page. `cross_page` rules declare every related page explicitly; evidence may come only from the subject and declared related pages. A `pass` requires directly referenced page observations with status `observed`; partial or unavailable evidence and the diagnostics envelope itself cannot support a pass. Rule-specific prerequisites may narrow this further in later compatible versions. A technical result carries no strategic priority and grants no authorization to change a site.

Field override paths are RFC 6901 JSON Pointers relative to the observation `value`. Every path must resolve. Duplicate paths and parent/child overlaps are conflicts and invalidate the document; consumers never choose a winner.

## Serialization and privacy

UTF-8 strings and repeated-header value order are preserved exactly. Producers do not coerce, default, strip, or reinterpret values. Raw HTML, cookies, credentials, authorization values, and signed URLs are outside version 0.1.0. Exported URL fields reject userinfo and recognizable signing/query-secret names. Producers must redact sensitive header URL values that cannot be recognized generically before export.

Duplicate JSON object member names must be rejected by the transport parser before schema validation because parsed JavaScript objects cannot retain duplicate members. The invalid duplicate-member fixture pins this transport requirement.
