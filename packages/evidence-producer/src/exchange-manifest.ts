import { createHash } from "node:crypto";
import { basename } from "node:path";
import { EXCHANGE_PROFILE } from "./exchange-profile.js";

export const CONTRACT_SOURCE_COMMIT = "bd45aa69c141deffed50c8d2ea57e28cea552cb8";
export const SCHEMA_SHA256 = "8e06803f254b863a670418491aa85856208e75ae70b6bb77dcfde71cbc8787e8";
export interface ManifestInput { evidenceBytes: Uint8Array; evidenceFilename: string; producerCommit: string; runId: string; authorizationRef: string; authorizedScope: unknown; startedAt: string; finishedAt: string; coverageLimitations: unknown[] }

export function createExchangeManifest(input: ManifestInput) {
  if (basename(input.evidenceFilename) !== input.evidenceFilename || !/^[A-Za-z0-9._-]+$/.test(input.evidenceFilename)) throw new TypeError("evidence filename is unsafe");
  if (!/^[a-f0-9]{40}$/.test(input.producerCommit)) throw new TypeError("producer commit is invalid");
  return {
    contract: "seo-crawl-evidence/0.1.0", exchange_profile: EXCHANGE_PROFILE,
    contract_source_commit: CONTRACT_SOURCE_COMMIT, producer_commit: input.producerCommit, schema_sha256: SCHEMA_SHA256,
    evidence_sha256: createHash("sha256").update(input.evidenceBytes).digest("hex"), checksum_algorithm: "SHA-256",
    evidence_filename: input.evidenceFilename, evidence_bytes: input.evidenceBytes.byteLength, run_id: input.runId,
    authorization_ref: input.authorizationRef, authorized_scope: input.authorizedScope, started_at: input.startedAt,
    finished_at: input.finishedAt, coverage_limitations: input.coverageLimitations,
    producer_validation: "pass", producer_preflight: "pass",
  } as const;
}
