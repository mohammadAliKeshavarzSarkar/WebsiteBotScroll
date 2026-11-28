/* eslint-disable @typescript-eslint/no-explicit-any */
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEvidenceJson } from "@website-bot-scroll/evidence-contract";
import { buildEvidenceDocument } from "./build-document.js";
import { createExchangeManifest } from "./exchange-manifest.js";
import { preflightExchangeBytes } from "./exchange-profile.js";
import { serializeEvidence } from "./serialize.js";

const safe = (name: string) => basename(name) === name && /^[A-Za-z0-9._-]+$/.test(name);
const publishExact = async (temporary: string, final: string, expected: Uint8Array) => {
  try {
    const existing = await readFile(final);
    if (!existing.equals(Buffer.from(expected))) throw new Error(`output conflict: ${final}`);
    return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { await link(temporary, final); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(final);
    if (!existing.equals(Buffer.from(expected))) throw new Error(`output conflict: ${final}`);
  }
};

export async function exportFrozenSnapshot(options: { snapshot: any; destinationDirectory: string; evidenceFilename: string; manifestFilename: string; producerCommit: string }) {
  if (!safe(options.evidenceFilename) || !safe(options.manifestFilename)) throw new Error("output filename is unsafe");
  if (options.evidenceFilename === options.manifestFilename) throw new Error("evidence and manifest filenames must be distinct");
  if (options.snapshot.payload.run.producerRevision !== options.producerCommit) throw new Error("producer revision mismatch");
  const destination = resolve(options.destinationDirectory); await mkdir(destination, { recursive: true });
  const evidencePath = join(destination, options.evidenceFilename); const manifestPath = join(destination, options.manifestFilename);
  const document = buildEvidenceDocument(options.snapshot, { producerVersion: options.producerCommit });
  const evidenceBytes = serializeEvidence(document);
  const validation = parseEvidenceJson(Buffer.from(evidenceBytes).toString("utf8")); if (!validation.valid) throw new Error(`canonical evidence validation failed: ${JSON.stringify(validation.errors)}`);
  const preflight = preflightExchangeBytes(evidenceBytes); if (!preflight.eligible) throw new Error("exchange profile preflight failed");
  const run = options.snapshot.payload.run;
  const projectedRun = document.run as { limitations?: unknown[] };
  const manifest = createExchangeManifest({ evidenceBytes, evidenceFilename: options.evidenceFilename, producerCommit: options.producerCommit, runId: run.id, authorizationRef: run.authorizationRef, authorizedScope: run.scope, startedAt: run.startedAt, finishedAt: run.finishedAt, coverageLimitations: projectedRun.limitations ?? [] });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const evidenceTemporary = join(destination, `.${options.evidenceFilename}.${randomUUID()}.tmp`); const manifestTemporary = join(destination, `.${options.manifestFilename}.${randomUUID()}.tmp`);
  try {
    await writeFile(evidenceTemporary, evidenceBytes, { flag: "wx" }); await writeFile(manifestTemporary, manifestBytes, { flag: "wx" });
    await publishExact(evidenceTemporary, evidencePath, evidenceBytes);
    await publishExact(manifestTemporary, manifestPath, manifestBytes);
  } finally { await rm(evidenceTemporary, { force: true }); await rm(manifestTemporary, { force: true }); }
  return { evidencePath, manifestPath, evidenceSha256: manifest.evidence_sha256, evidenceBytes: manifest.evidence_bytes };
}
