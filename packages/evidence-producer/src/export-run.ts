/* eslint-disable @typescript-eslint/no-explicit-any */
import { access, link, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEvidenceJson } from "@website-bot-scroll/evidence-contract";
import { buildEvidenceDocument } from "./build-document.js";
import { createExchangeManifest } from "./exchange-manifest.js";
import { preflightExchangeBytes } from "./exchange-profile.js";
import { serializeEvidence } from "./serialize.js";

const safe = (name: string) => basename(name) === name && /^[A-Za-z0-9._-]+$/.test(name);
const absent = async (path: string) => { try { await access(path); throw new Error(`output already exists: ${path}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };

export async function exportFrozenSnapshot(options: { snapshot: any; destinationDirectory: string; evidenceFilename: string; manifestFilename: string; producerCommit: string }) {
  if (!safe(options.evidenceFilename) || !safe(options.manifestFilename)) throw new Error("output filename is unsafe");
  if (options.evidenceFilename === options.manifestFilename) throw new Error("evidence and manifest filenames must be distinct");
  if (options.snapshot.payload.run.producerRevision !== options.producerCommit) throw new Error("producer revision mismatch");
  const destination = resolve(options.destinationDirectory); await mkdir(destination, { recursive: true });
  const evidencePath = join(destination, options.evidenceFilename); const manifestPath = join(destination, options.manifestFilename);
  await Promise.all([absent(evidencePath), absent(manifestPath)]);
  const document = buildEvidenceDocument(options.snapshot, { producerVersion: options.producerCommit });
  const evidenceBytes = serializeEvidence(document);
  const validation = parseEvidenceJson(Buffer.from(evidenceBytes).toString("utf8")); if (!validation.valid) throw new Error(`canonical evidence validation failed: ${JSON.stringify(validation.errors)}`);
  const preflight = preflightExchangeBytes(evidenceBytes); if (!preflight.eligible) throw new Error("exchange profile preflight failed");
  const run = options.snapshot.payload.run;
  const projectedRun = document.run as { limitations?: unknown[] };
  const manifest = createExchangeManifest({ evidenceBytes, evidenceFilename: options.evidenceFilename, producerCommit: options.producerCommit, runId: run.id, authorizationRef: run.authorizationRef, authorizedScope: run.scope, startedAt: run.startedAt, finishedAt: run.finishedAt, coverageLimitations: projectedRun.limitations ?? [] });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const evidenceTemporary = join(destination, `.${options.evidenceFilename}.${randomUUID()}.tmp`); const manifestTemporary = join(destination, `.${options.manifestFilename}.${randomUUID()}.tmp`);
  let evidencePublished = false; let manifestPublished = false;
  try {
    await writeFile(evidenceTemporary, evidenceBytes, { flag: "wx" }); await writeFile(manifestTemporary, manifestBytes, { flag: "wx" });
    await link(evidenceTemporary, evidencePath); evidencePublished = true;
    await link(manifestTemporary, manifestPath); manifestPublished = true;
  } catch (error) {
    if (evidencePublished && !manifestPublished) await rm(evidencePath, { force: true });
    if (manifestPublished && !evidencePublished) await rm(manifestPath, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("output already exists");
    throw error;
  } finally { await rm(evidenceTemporary, { force: true }); await rm(manifestTemporary, { force: true }); }
  return { evidencePath, manifestPath, evidenceSha256: manifest.evidence_sha256, evidenceBytes: manifest.evidence_bytes };
}
