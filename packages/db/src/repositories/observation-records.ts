import {
  defineObservationRecord,
  type ObservationExecutionInput,
  type ObservationRecordInput,
  type ObservationSubjectInput,
  type ObservationExecutionStatus,
} from "@website-bot-scroll/domain/observation-platform";
import { compileBoundedSchema, validateBoundedPayload } from "@website-bot-scroll/observation-schema";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const normalize = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(normalize) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : value;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
const terminal = new Set<ObservationExecutionStatus>(["completed", "partial", "failed", "cancelled"]);

export class ObservationRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  private async requireRun(organizationId: string, runId: string, mutable = true) {
    const run = await this.prisma.crawlRun.findFirst({ where: { id: runId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    if (mutable && run.frozenAt) throw new Error("crawl run evidence is frozen");
    return run;
  }

  async appendSubject(organizationId: string, input: ObservationSubjectInput): Promise<void> {
    const run = await this.requireRun(organizationId, input.runId);
    const existing = await this.prisma.observationSubject.findUnique({ where: { id: input.id }, include: { members: { orderBy: { position: "asc" } } } });
    const members = input.members ?? [];
    if (existing) {
      const actual = { runId: existing.crawlRunId, kind: existing.kind, identity: existing.identity, members: existing.members.map(({ memberSubjectId }) => memberSubjectId) };
      if (!same(actual, { runId: input.runId, kind: input.kind, identity: input.identity, members })) throw new Error("immutable subject conflict");
      return;
    }
    if (input.kind === "run" && input.identity.runId !== input.runId) throw new Error("run subject ownership mismatch");
    if (input.kind === "site" && input.identity.siteId !== run.siteId) throw new Error("site subject ownership mismatch");
    if (input.kind === "page") {
      const page = await this.prisma.evidencePage.findFirst({ where: { id: String(input.identity.pageId ?? ""), crawlRunId: input.runId } });
      if (!page) throw new Error("page ownership mismatch");
    }
    if (input.kind === "resource") {
      let host = ""; try { host = new URL(String(input.identity.url ?? "")).hostname; } catch { throw new Error("resource ownership mismatch"); }
      const allowedHosts = (run.scope as { allowed_hosts?: unknown } | null)?.allowed_hosts;
      if (!Array.isArray(allowedHosts) || !allowedHosts.includes(host)) throw new Error("resource ownership mismatch");
    }
    const memberRows = members.length === 0 ? [] : await this.prisma.observationSubject.findMany({ where: { id: { in: members }, organizationId, crawlRunId: input.runId } });
    if (memberRows.length !== members.length || input.kind !== "cross_page" && members.length > 0) throw new Error("subject member ownership mismatch");
    const position = await this.prisma.observationSubject.count({ where: { crawlRunId: input.runId } });
    await this.prisma.observationSubject.create({ data: {
      id: input.id, organizationId, crawlRunId: input.runId, position, kind: input.kind, identity: asJson(input.identity),
      members: { create: members.map((memberSubjectId, index) => ({ memberSubjectId, position: index })) },
    } });
  }

  async startExecution(organizationId: string, input: ObservationExecutionInput) {
    await this.requireRun(organizationId, input.runId);
    const collector = await this.prisma.collectorDefinition.findUnique({ where: { key_version: { key: input.collectorKey, version: input.collectorVersion } } });
    if (!collector || collector.status !== "published") throw new Error("collector definition not found");
    const existing = await this.prisma.observationExecution.findUnique({ where: { id: input.id } });
    if (existing) {
      const expected = { organizationId, crawlRunId: input.runId, collectorDefinitionId: collector.id, parentExecutionId: input.parentExecutionId ?? null, stableKey: input.stableKey, attempt: input.attempt, trigger: input.trigger, configuration: input.configuration, startedAt: new Date(input.startedAt) };
      const actual = { organizationId: existing.organizationId, crawlRunId: existing.crawlRunId, collectorDefinitionId: existing.collectorDefinitionId, parentExecutionId: existing.parentExecutionId, stableKey: existing.stableKey, attempt: existing.attempt, trigger: existing.trigger, configuration: existing.configuration, startedAt: existing.startedAt };
      if (!same(actual, expected)) throw new Error("immutable execution conflict");
      return existing;
    }
    const configResult = validateBoundedPayload(compileBoundedSchema(collector.configurationSchema), input.configuration);
    if (!configResult.valid) throw new Error("collector configuration validation failed");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) throw new Error("attempt sequence invalid");
    const latest = await this.prisma.observationExecution.findFirst({ where: { crawlRunId: input.runId, stableKey: input.stableKey }, orderBy: { attempt: "desc" } });
    if (input.attempt !== (latest ? latest.attempt + 1 : 0)) throw new Error("attempt sequence invalid");
    if (input.parentExecutionId) {
      const parent = await this.prisma.observationExecution.findFirst({ where: { id: input.parentExecutionId, organizationId, crawlRunId: input.runId, status: "running" } });
      if (!parent) throw new Error("parent execution not running");
    }
    return this.prisma.observationExecution.create({ data: {
      id: input.id, organizationId, crawlRunId: input.runId, collectorDefinitionId: collector.id,
      parentExecutionId: input.parentExecutionId ?? null, stableKey: input.stableKey, attempt: input.attempt,
      trigger: input.trigger, configuration: asJson(input.configuration), startedAt: new Date(input.startedAt), status: "running",
    } });
  }

  async finishExecution(organizationId: string, input: { executionId: string; status: Exclude<ObservationExecutionStatus, "pending" | "running">; finishedAt: string; error?: unknown }): Promise<void> {
    if (!terminal.has(input.status)) throw new Error("terminal execution status required");
    const execution = await this.prisma.observationExecution.findFirst({ where: { id: input.executionId, organizationId } });
    if (!execution) throw new Error("observation execution not found");
    await this.requireRun(organizationId, execution.crawlRunId);
    const expected = { status: input.status, finishedAt: new Date(input.finishedAt), error: input.error ?? null };
    if (terminal.has(execution.status as ObservationExecutionStatus)) {
      if (!same({ status: execution.status, finishedAt: execution.finishedAt, error: execution.error }, expected)) throw new Error("immutable execution conflict");
      return;
    }
    if (execution.status !== "running") throw new Error("running observation execution not found");
    const activeChild = await this.prisma.observationExecution.findFirst({ where: { parentExecutionId: execution.id, status: { in: ["pending", "running"] } } });
    if (activeChild) throw new Error("child execution remains active");
    await this.prisma.observationExecution.update({ where: { id: execution.id }, data: { status: input.status, finishedAt: new Date(input.finishedAt), ...(input.error === undefined ? {} : { error: asJson(input.error) }) } });
  }

  async appendObservation(organizationId: string, raw: ObservationRecordInput): Promise<void> {
    const input = defineObservationRecord(raw);
    await this.requireRun(organizationId, input.runId);
    const [subject, execution, definition] = await Promise.all([
      this.prisma.observationSubject.findFirst({ where: { id: input.subjectId, organizationId, crawlRunId: input.runId } }),
      this.prisma.observationExecution.findFirst({ where: { id: input.executionId, organizationId, crawlRunId: input.runId }, include: { collector: { include: { capabilities: true } } } }),
      this.prisma.observationDefinition.findUnique({ where: { key_version: { key: input.definitionKey, version: input.definitionVersion } } }),
    ]);
    if (!subject || !execution) throw new Error("observation ownership mismatch");
    if (!definition || definition.status !== "published") throw new Error("observation definition not found");
    if (!(definition.scopes as string[]).includes(subject.kind)) throw new Error("observation definition scope mismatch");
    if (!(definition.statuses as string[]).includes(input.status)) throw new Error("observation definition status mismatch");
    if (!execution.collector.capabilities.some(({ observationDefinitionId }) => observationDefinitionId === definition.id)) throw new Error("collector capability mismatch");
    if (input.payload !== null) {
      const result = validateBoundedPayload(compileBoundedSchema(definition.schema), input.payload);
      if (!result.valid) throw new Error("payload validation failed");
    }
    const comparable = { organizationId, crawlRunId: input.runId, subjectId: input.subjectId, executionId: input.executionId, observationDefinitionId: definition.id, sequence: input.sequence, status: input.status, payload: input.payload, reasons: input.reasons, provenance: input.provenance, collectedAt: new Date(input.collectedAt) };
    const existing = await this.prisma.platformObservation.findUnique({ where: { id: input.id } });
    if (existing) { if (!same(existing, { id: existing.id, createdAt: existing.createdAt, ...comparable })) throw new Error("immutable observation conflict"); return; }
    await this.prisma.platformObservation.create({ data: { id: input.id, ...comparable, payload: input.payload === null ? Prisma.JsonNull : asJson(input.payload), reasons: input.reasons, provenance: asJson(input.provenance) } });
  }

  async loadRunRecords(organizationId: string, runId: string) {
    await this.requireRun(organizationId, runId, false);
    const [subjects, executions, observations] = await Promise.all([
      this.prisma.observationSubject.findMany({ where: { organizationId, crawlRunId: runId }, orderBy: { position: "asc" }, include: { members: { orderBy: { position: "asc" } } } }),
      this.prisma.observationExecution.findMany({ where: { organizationId, crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }] }),
      this.prisma.platformObservation.findMany({ where: { organizationId, crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }] }),
    ]);
    return { subjects: subjects.map((subject) => ({ ...subject, members: subject.members.map(({ memberSubjectId, position }) => ({ subjectId: memberSubjectId, position })) })), executions, observations };
  }
}
