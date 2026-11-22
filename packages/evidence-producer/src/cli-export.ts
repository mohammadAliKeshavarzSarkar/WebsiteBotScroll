import { createPrismaClient } from "@website-bot-scroll/db";
import { SnapshotRepository } from "@website-bot-scroll/db/export-projections";
import { exportFrozenSnapshot } from "./export-run.js";

const [organizationId, snapshotId, destinationDirectory, producerCommit] = process.argv.slice(2);
if (!organizationId || !snapshotId || !destinationDirectory || !producerCommit || !process.env.DATABASE_URL) throw new Error("usage: evidence:export <organization-id> <snapshot-id> <destination-directory> <producer-commit>; DATABASE_URL is required");
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  const snapshot = await new SnapshotRepository(prisma).loadSnapshot(organizationId, snapshotId);
  const receipt = await exportFrozenSnapshot({ snapshot, destinationDirectory, evidenceFilename: `${snapshot.crawlRunId}.evidence.json`, manifestFilename: `${snapshot.crawlRunId}.manifest.json`, producerCommit });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally { await prisma.$disconnect(); }
