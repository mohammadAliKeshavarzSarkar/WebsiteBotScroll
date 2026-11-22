/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseEvidenceJson } from "@website-bot-scroll/evidence-contract";
import { CONTRACT_SOURCE_COMMIT, SCHEMA_SHA256 } from "./exchange-manifest.js";
import { EXCHANGE_PROFILE, preflightExchangeBytes } from "./exchange-profile.js";

const KEYS = ["contract", "exchange_profile", "contract_source_commit", "producer_commit", "schema_sha256", "evidence_sha256", "checksum_algorithm", "evidence_filename", "evidence_bytes", "run_id", "authorization_ref", "authorized_scope", "started_at", "finished_at", "coverage_limitations", "producer_validation", "producer_preflight"];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

export async function verifyExchangePair(options: { evidencePath: string; manifestPath: string }) {
  const [evidenceBytes, manifestBytes] = await Promise.all([readFile(options.evidencePath), readFile(options.manifestPath)]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, any>;
  if (JSON.stringify(Object.keys(manifest)) !== JSON.stringify(KEYS)) throw new Error("manifest fields mismatch");
  if (manifest.evidence_filename !== basename(options.evidencePath)) throw new Error("evidence filename mismatch");
  if (manifest.evidence_bytes !== evidenceBytes.byteLength) throw new Error("evidence byte length mismatch");
  const sha256 = createHash("sha256").update(evidenceBytes).digest("hex");
  if (manifest.evidence_sha256 !== sha256) throw new Error("evidence checksum mismatch");
  if (manifest.contract !== "seo-crawl-evidence/0.1.0" || manifest.exchange_profile !== EXCHANGE_PROFILE || manifest.contract_source_commit !== CONTRACT_SOURCE_COMMIT || manifest.schema_sha256 !== SCHEMA_SHA256 || manifest.checksum_algorithm !== "SHA-256" || manifest.producer_validation !== "pass" || manifest.producer_preflight !== "pass") throw new Error("manifest identity mismatch");
  const parsed = parseEvidenceJson(evidenceBytes.toString("utf8"));
  if (!parsed.valid) throw new Error("canonical evidence validation failed");
  const preflight = preflightExchangeBytes(evidenceBytes); if (!preflight.eligible) throw new Error("exchange profile preflight failed");
  const document = parsed.document as any;
  if (manifest.run_id !== document.run.id || manifest.producer_commit !== document.producer.version || JSON.stringify(stable(manifest.authorized_scope)) !== JSON.stringify(stable(document.run.scope)) || manifest.started_at !== document.run.started_at || manifest.finished_at !== document.run.finished_at) throw new Error("manifest evidence mismatch");
  return { evidenceSha256: sha256, evidenceBytes: evidenceBytes.byteLength, runId: document.run.id };
}
