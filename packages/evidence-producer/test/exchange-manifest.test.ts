import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExchangeManifest } from "../src/exchange-manifest.js";

describe("frozen exchange manifest", () => {
  it("emits exactly the accepted 17 fields with exact-byte metadata", () => {
    const bytes = Buffer.from("{}\n");
    const manifest = createExchangeManifest({ evidenceBytes: bytes, evidenceFilename: "run-1.evidence.json", producerCommit: "a".repeat(40), runId: "run-1", authorizationRef: "auth-1", authorizedScope: { allowed_hosts: ["example.test"] }, startedAt: "2026-11-21T00:00:00.000Z", finishedAt: "2026-11-21T00:00:01.000Z", coverageLimitations: [] });
    expect(Object.keys(manifest)).toEqual(["contract", "exchange_profile", "contract_source_commit", "producer_commit", "schema_sha256", "evidence_sha256", "checksum_algorithm", "evidence_filename", "evidence_bytes", "run_id", "authorization_ref", "authorized_scope", "started_at", "finished_at", "coverage_limitations", "producer_validation", "producer_preflight"]);
    expect(manifest.contract).toEqual({ name: "seo-crawl-evidence", version: "0.1.0" });
    expect(manifest.evidence_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(manifest.evidence_bytes).toBe(3); expect(manifest.producer_validation).toBe("pass"); expect(manifest.producer_preflight).toBe("pass");
  });

  it("rejects unsafe evidence basenames", () => expect(() => createExchangeManifest({ evidenceBytes: Buffer.from("{}\n"), evidenceFilename: "../evidence.json", producerCommit: "a".repeat(40), runId: "r", authorizationRef: "a", authorizedScope: {}, startedAt: "2026-11-21T00:00:00Z", finishedAt: "2026-11-21T00:00:01Z", coverageLimitations: [] })).toThrow("filename"));
});
