import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportFrozenSnapshot } from "../src/export-run.js";
import { verifyExchangePair } from "../src/verify-exchange.js";

const commit = "a".repeat(40);
const snapshot = { id: "snapshot-1", payload: { run: { id: "run-1", authorizationRef: "auth-1", trigger: "manual", status: "completed", startedAt: "2026-11-21T00:00:00.000Z", finishedAt: "2026-11-21T00:00:01.000Z", scope: { seed_urls: ["https://example.test/"], allowed_hosts: ["example.test"] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 1000 }, producerRevision: commit, normalizationPolicyVersion: "1.0.0", extractorVersion: "1.0.0", stopReason: "frontier_exhausted", coverage: { discovered: 0, attempted: 0, collected: 0, failed: 0, unattempted: 0 } }, subjects: [], observations: [], diagnosticExecutions: [], diagnosticResults: [], evidencePages: [], evidenceLimitations: [], evidenceErrors: [] } };

describe("evidence exchange export", () => {
  it("atomically exports and re-verifies exact evidence and manifest bytes", async () => {
    const destinationDirectory = await mkdtemp(join(tmpdir(), "wbs-exchange-"));
    const receipt = await exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: "run-1.evidence.json", manifestFilename: "run-1.manifest.json", producerCommit: commit });
    const verified = await verifyExchangePair({ evidencePath: receipt.evidencePath, manifestPath: receipt.manifestPath });
    expect(verified.evidenceSha256).toBe(receipt.evidenceSha256);
    await expect(exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: "run-1.evidence.json", manifestFilename: "run-1.manifest.json", producerCommit: commit })).rejects.toThrow("already exists");
    const original = await readFile(receipt.evidencePath); await writeFile(receipt.evidencePath, Buffer.concat([original.subarray(0, -1), Buffer.from(" ")]));
    await expect(verifyExchangePair({ evidencePath: receipt.evidencePath, manifestPath: receipt.manifestPath })).rejects.toThrow("checksum");
  });

  it("rejects traversal filenames before writing", async () => {
    const destinationDirectory = await mkdtemp(join(tmpdir(), "wbs-exchange-"));
    await expect(exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: "../outside.json", manifestFilename: "manifest.json", producerCommit: commit })).rejects.toThrow("filename");
  });

  it("rejects equal output names without leaving a partial final file", async () => {
    const destinationDirectory = await mkdtemp(join(tmpdir(), "wbs-exchange-"));
    const output = join(destinationDirectory, "same.json");
    await expect(exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: "same.json", manifestFilename: "same.json", producerCommit: commit })).rejects.toThrow("distinct");
    await expect(access(output)).rejects.toThrow();
  });
});
