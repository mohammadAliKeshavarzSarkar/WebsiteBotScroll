import { createPrismaClient } from "@website-bot-scroll/db";
import { FilesystemArtifactStore } from "@website-bot-scroll/db/artifacts";
import { ExportProjectionRepository, SnapshotRepository } from "@website-bot-scroll/db/export-projections";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exportFrozenSnapshot } from "./export-run.js";

const [organizationId, snapshotId, destinationDirectory, producerCommit] = process.argv.slice(2);
if (!organizationId || !snapshotId || !destinationDirectory || !producerCommit || !process.env.DATABASE_URL) throw new Error("usage: evidence:export <organization-id> <snapshot-id> <destination-directory> <producer-commit>; DATABASE_URL is required");
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  const snapshot = await new SnapshotRepository(prisma).loadSnapshot(organizationId, snapshotId);
  const receipt = await exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: `${snapshot.crawlRunId}.evidence.json`, manifestFilename: `${snapshot.crawlRunId}.manifest.json`, producerCommit });
  const bytes = await readFile(receipt.evidencePath);
  const projections = new ExportProjectionRepository(prisma, { canPublish: false }, new FilesystemArtifactStore(join(destinationDirectory, ".artifacts")));
  const execution = await projections.runProjection(organizationId, snapshot.id, { id: `seo-crawl-evidence:${snapshot.id}:0`, key: "seo-crawl-evidence", version: "0.1.0", stableKey: "seo-crawl-evidence/0.1.0", attempt: 0, bytes, sha256: receipt.evidenceSha256 });
  process.stdout.write(`${JSON.stringify({ ...receipt, projectionExecutionId: execution.id, outputArtifactId: execution.outputArtifactId })}\n`);
} finally { await prisma.$disconnect(); }
