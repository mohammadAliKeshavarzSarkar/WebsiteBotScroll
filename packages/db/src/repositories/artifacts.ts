import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  describeArtifact,
  validateArtifactPolicy,
  type ArtifactDescriptor,
  type ArtifactPutPolicy,
  type ArtifactStore,
} from "@website-bot-scroll/domain/evidence-artifact";
import { PLATFORM_LIMITS } from "@website-bot-scroll/domain/observation-platform";
import type { DatabaseClient } from "../client.js";

export class FilesystemArtifactStore implements ArtifactStore {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  async put(bytes: Uint8Array, policy: ArtifactPutPolicy): Promise<ArtifactDescriptor> {
    const derived = describeArtifact(bytes, policy.mediaType);
    validateArtifactPolicy({ ...derived, sensitivity: policy.sensitivity, retentionClass: policy.retentionClass }, policy);
    const relativeDirectory = join("sha256", derived.sha256.slice(0, 2));
    const locator = join(relativeDirectory, derived.sha256);
    const directory = join(this.root, relativeDirectory);
    const storagePath = join(this.root, locator);
    await mkdir(directory, { recursive: true });
    try {
      const existing = await readFile(storagePath);
      if (!existing.equals(Buffer.from(bytes))) throw new Error("content-address collision");
      return { ...derived, locator, sensitivity: policy.sensitivity, retentionClass: policy.retentionClass };
    } catch (error) {
      if (error instanceof Error && error.message === "content-address collision") throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = join(directory, `${derived.sha256}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      try { await link(temporary, storagePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(storagePath);
        if (!existing.equals(Buffer.from(bytes))) throw new Error("content-address collision");
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return { ...derived, locator, sensitivity: policy.sensitivity, retentionClass: policy.retentionClass };
  }

  async read(locator: string): Promise<Uint8Array> {
    if (isAbsolute(locator) || locator.includes("..")) throw new Error("artifact locator must be server relative");
    return readFile(join(this.root, locator));
  }
}

export class ArtifactRepository {
  private readonly maxExecutionBytes: number;
  constructor(private readonly prisma: DatabaseClient, options: { maxExecutionBytes?: number } = {}) {
    this.maxExecutionBytes = options.maxExecutionBytes ?? PLATFORM_LIMITS.maxExecutionArtifactBytes;
  }

  async register(organizationId: string, runId: string, descriptor: ArtifactDescriptor) {
    if (!/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error("artifact hash is invalid");
    if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0 || descriptor.byteLength > PLATFORM_LIMITS.maxArtifactBytes) throw new Error("artifact byte limit exceeded");
    if (isAbsolute(descriptor.locator) || descriptor.locator.includes("..")) throw new Error("artifact locator must be server relative");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("crawl run evidence is frozen");
      const existing = await tx.evidenceArtifact.findUnique({ where: { crawlRunId_sha256: { crawlRunId: runId, sha256: descriptor.sha256 } } });
      if (existing) {
        if (existing.byteLength !== descriptor.byteLength || existing.mediaType !== descriptor.mediaType || existing.locator !== descriptor.locator || existing.sensitivity !== descriptor.sensitivity || existing.retentionClass !== descriptor.retentionClass) throw new Error("artifact metadata conflict");
        return existing;
      }
      return tx.evidenceArtifact.create({ data: { organizationId, crawlRunId: runId, ...descriptor } });
    });
  }

  async linkObservation(organizationId: string, observationId: string, artifactId: string, role: string, position: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const observation = await tx.platformObservation.findFirst({ where: { id: observationId, organizationId } });
      if (!observation) throw new Error("artifact link ownership mismatch");
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${observation.crawlRunId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const [run, artifact] = await Promise.all([
        tx.crawlRun.findFirst({ where: { id: observation.crawlRunId, organizationId } }),
        tx.evidenceArtifact.findFirst({ where: { id: artifactId, organizationId } }),
      ]);
      if (!run || !artifact || artifact.crawlRunId !== observation.crawlRunId) throw new Error("artifact link ownership mismatch");
      if (artifact.availability !== "available") throw new Error("artifact is unavailable");
      if (run.frozenAt) throw new Error("frozen artifact dependencies are immutable");
      const existingLinks = await tx.observationArtifact.findMany({ where: { observation: { executionId: observation.executionId } }, include: { artifact: true } });
      const total = existingLinks.reduce((sum, link) => sum + link.artifact.byteLength, 0) + artifact.byteLength;
      if (total > this.maxExecutionBytes) throw new Error("execution artifact byte limit exceeded");
      const existing = await tx.observationArtifact.findUnique({ where: { observationId_artifactId: { observationId, artifactId } } });
      if (existing) {
        if (existing.role !== role || existing.position !== position) throw new Error("immutable artifact link conflict");
        return;
      }
      await tx.observationArtifact.create({ data: { observationId, artifactId, role, position } });
    });
  }

  async listObservationArtifacts(organizationId: string, observationId: string) {
    const observation = await this.prisma.platformObservation.findFirst({ where: { id: observationId, organizationId } });
    if (!observation) throw new Error("observation not found");
    return this.prisma.observationArtifact.findMany({ where: { observationId }, orderBy: { position: "asc" }, include: { artifact: true } });
  }
}
