import {
  defineDiagnosticResult,
  defineDiagnosticRule,
  type DiagnosticExecutionInput,
  type DiagnosticResultInput,
  type DiagnosticRuleDefinitionInput,
} from "@website-bot-scroll/domain/diagnostics";
import { compileBoundedSchema, validateBoundedPayload } from "@website-bot-scroll/observation-schema";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

type PublicationAccess = { canPublish: boolean };
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const normalize = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(normalize) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)])) : value;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));

export class DiagnosticRepository {
  constructor(private readonly prisma: DatabaseClient, private readonly access: PublicationAccess = { canPublish: false }) {}

  async publishRule(input: DiagnosticRuleDefinitionInput) {
    if (!this.access.canPublish) throw new Error("diagnostic publication authority required");
    const defined = defineDiagnosticRule(input);
    compileBoundedSchema(defined.configurationSchema);
    const observationDefinitions = await Promise.all(defined.acceptedInputs.map(({ observationKey: key, observationVersion: version }) =>
      this.prisma.observationDefinition.findUnique({ where: { key_version: { key, version } } })));
    if (observationDefinitions.some((definition) => !definition || definition.status !== "published")) throw new Error("diagnostic input definition not found");
    const existing = await this.prisma.diagnosticRuleDefinition.findUnique({
      where: { key_version: { key: defined.key, version: defined.version } },
      include: { inputs: { orderBy: { position: "asc" }, include: { observation: true } } },
    });
    const expectedInputs = defined.acceptedInputs.map((accepted) => ({
      observationKey: accepted.observationKey, observationVersion: accepted.observationVersion,
      scopes: accepted.scopes, required: accepted.required,
    }));
    if (existing) {
      const actualInputs = existing.inputs.map(({ observation, scopes, required }) => ({
        observationKey: observation.key, observationVersion: observation.version, scopes, required,
      }));
      if (existing.configurationSchemaSha256 !== defined.configurationSchemaSha256 || existing.policyVersion !== defined.policyVersion
        || existing.supportsUnavailableInputs !== defined.supportsUnavailableInputs || !same(existing.outcomes, defined.outcomes)
        || !same(actualInputs, expectedInputs)) throw new Error("definition conflict");
      return existing;
    }
    return this.prisma.diagnosticRuleDefinition.create({ data: {
      key: defined.key, version: defined.version, policyVersion: defined.policyVersion,
      configurationSchema: json(defined.configurationSchema), configurationSchemaSha256: defined.configurationSchemaSha256,
      outcomes: defined.outcomes, supportsUnavailableInputs: defined.supportsUnavailableInputs,
      inputs: { create: observationDefinitions.map((observation, position) => ({
        observationDefinitionId: observation!.id, position, scopes: [...defined.acceptedInputs[position]!.scopes],
        required: defined.acceptedInputs[position]!.required,
      })) },
    }, include: { inputs: { orderBy: { position: "asc" }, include: { observation: true } } } });
  }

  async startExecution(organizationId: string, input: DiagnosticExecutionInput) {
    const run = await this.prisma.crawlRun.findFirst({ where: { id: input.runId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    if (run.frozenAt) throw new Error("crawl run evidence is frozen");
    const rule = await this.prisma.diagnosticRuleDefinition.findUnique({ where: { key_version: { key: input.ruleKey, version: input.ruleVersion } } });
    if (!rule || rule.status !== "published") throw new Error("diagnostic rule not found");
    if (!validateBoundedPayload(compileBoundedSchema(rule.configurationSchema), input.configuration).valid) throw new Error("diagnostic configuration validation failed");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) throw new Error("attempt sequence invalid");
    const comparable = { organizationId, crawlRunId: input.runId, ruleDefinitionId: rule.id, stableKey: input.stableKey, attempt: input.attempt, configuration: input.configuration, startedAt: new Date(input.startedAt) };
    const existing = await this.prisma.diagnosticExecution.findUnique({ where: { id: input.id } });
    if (existing) {
      const actual = { organizationId: existing.organizationId, crawlRunId: existing.crawlRunId, ruleDefinitionId: existing.ruleDefinitionId, stableKey: existing.stableKey, attempt: existing.attempt, configuration: existing.configuration, startedAt: existing.startedAt };
      if (!same(actual, comparable)) throw new Error("immutable diagnostic execution conflict");
      return existing;
    }
    const latest = await this.prisma.diagnosticExecution.findFirst({ where: { crawlRunId: input.runId, stableKey: input.stableKey }, orderBy: { attempt: "desc" } });
    if (input.attempt !== (latest ? latest.attempt + 1 : 0)) throw new Error("attempt sequence invalid");
    return this.prisma.diagnosticExecution.create({ data: { id: input.id, ...comparable, configuration: json(input.configuration) } });
  }

  async finishExecution(organizationId: string, input: { executionId: string; status: "completed" | "partial" | "failed" | "cancelled"; finishedAt: string; error?: unknown }) {
    const execution = await this.prisma.diagnosticExecution.findFirst({ where: { id: input.executionId, organizationId } });
    if (!execution) throw new Error("diagnostic execution not found");
    const run = await this.prisma.crawlRun.findFirst({ where: { id: execution.crawlRunId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    if (run.frozenAt) throw new Error("crawl run evidence is frozen");
    if (input.status === "failed" && input.error === undefined) throw new Error("diagnostic failure details are required");
    const expected = { status: input.status, finishedAt: new Date(input.finishedAt), error: input.error ?? null };
    if (["completed", "partial", "failed", "cancelled"].includes(execution.status)) {
      if (!same({ status: execution.status, finishedAt: execution.finishedAt, error: execution.error }, expected)) throw new Error("immutable diagnostic execution conflict");
      return execution;
    }
    if (execution.status !== "running") throw new Error("running diagnostic execution not found");
    await this.prisma.diagnosticExecution.update({ where: { id: execution.id }, data: { status: input.status, finishedAt: new Date(input.finishedAt), ...(input.error === undefined ? {} : { error: json(input.error) }) } });
  }

  async appendResult(organizationId: string, raw: DiagnosticResultInput): Promise<void> {
    const input = defineDiagnosticResult(raw);
    const run = await this.prisma.crawlRun.findFirst({ where: { id: input.runId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    if (run.frozenAt) throw new Error("crawl run evidence is frozen");
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || new Set(input.inputObservationIds).size !== input.inputObservationIds.length) throw new Error("diagnostic result ordering is invalid");
    const execution = await this.prisma.diagnosticExecution.findFirst({
      where: { id: input.executionId, organizationId, crawlRunId: input.runId, status: "running" },
      include: { rule: { include: { inputs: { orderBy: { position: "asc" }, include: { observation: true } } } } },
    });
    const subject = await this.prisma.observationSubject.findFirst({
      where: { id: input.subjectId, organizationId, crawlRunId: input.runId }, include: { members: { orderBy: { position: "asc" } } },
    });
    if (!execution || !subject) throw new Error("diagnostic result ownership mismatch");
    if (!(execution.rule.outcomes as string[]).includes(input.outcome)) throw new Error("diagnostic outcome is not supported");
    const observations = input.inputObservationIds.length === 0 ? [] : await this.prisma.platformObservation.findMany({
      where: { id: { in: input.inputObservationIds }, organizationId, crawlRunId: input.runId }, include: { definition: true },
    });
    const byId = new Map(observations.map((observation) => [observation.id, observation]));
    if (observations.length !== input.inputObservationIds.length) throw new Error("diagnostic input observation not found");
    const relevantSubjects = new Set([subject.id, ...(subject.kind === "cross_page" ? subject.members.map(({ memberSubjectId }) => memberSubjectId) : [])]);
    const accepted = new Map(execution.rule.inputs.map((ruleInput) => [`${ruleInput.observation.key}@${ruleInput.observation.version}`, ruleInput]));
    const suppliedKeys = new Set<string>();
    for (const observationId of input.inputObservationIds) {
      const observation = byId.get(observationId)!;
      const key = `${observation.definition.key}@${observation.definition.version}`;
      const ruleInput = accepted.get(key);
      if (!ruleInput || !(ruleInput.scopes as string[]).includes(subject.kind)) throw new Error("diagnostic input definition is not accepted");
      if (!relevantSubjects.has(observation.subjectId)) throw new Error("diagnostic input subject is not relevant");
      if (ruleInput.required && !execution.rule.supportsUnavailableInputs && !["observed", "partial"].includes(observation.status)) throw new Error("required diagnostic input unavailable");
      suppliedKeys.add(key);
    }
    if (execution.rule.inputs.some((ruleInput) => ruleInput.required && !suppliedKeys.has(`${ruleInput.observation.key}@${ruleInput.observation.version}`))) throw new Error("required diagnostic input missing");
    const comparable = {
      organizationId, crawlRunId: input.runId, executionId: input.executionId, subjectId: input.subjectId, sequence: input.sequence,
      outcome: input.outcome, messageData: input.messageData, limitations: input.limitations, collectedAt: new Date(input.collectedAt),
      inputObservationIds: input.inputObservationIds,
    };
    const existing = await this.prisma.diagnosticResult.findUnique({ where: { id: input.id }, include: { inputs: { orderBy: { position: "asc" } } } });
    if (existing) {
      const actual = { organizationId: existing.organizationId, crawlRunId: existing.crawlRunId, executionId: existing.executionId, subjectId: existing.subjectId, sequence: existing.sequence, outcome: existing.outcome, messageData: existing.messageData, limitations: existing.limitations, collectedAt: existing.collectedAt, inputObservationIds: existing.inputs.map(({ observationId }) => observationId) };
      if (!same(actual, comparable)) throw new Error("immutable diagnostic result conflict");
      return;
    }
    await this.prisma.diagnosticResult.create({ data: {
      id: input.id, organizationId, crawlRunId: input.runId, executionId: input.executionId, subjectId: input.subjectId,
      sequence: input.sequence, outcome: input.outcome, messageData: json(input.messageData), limitations: input.limitations,
      collectedAt: new Date(input.collectedAt), inputs: { create: input.inputObservationIds.map((observationId, position) => ({ observationId, position })) },
    } });
  }

  async loadRunDiagnostics(organizationId: string, runId: string) {
    const run = await this.prisma.crawlRun.findFirst({ where: { id: runId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    const [executions, results] = await Promise.all([
      this.prisma.diagnosticExecution.findMany({ where: { organizationId, crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }] }),
      this.prisma.diagnosticResult.findMany({ where: { organizationId, crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }], include: { inputs: { orderBy: { position: "asc" } } } }),
    ]);
    return { executions, results };
  }
}
