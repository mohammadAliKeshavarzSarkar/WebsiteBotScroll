import { defineRendererSession, type RendererSessionInput } from "@website-bot-scroll/domain/renderer-session";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : value;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));

export class RendererSessionRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async createSession(organizationId: string, raw: RendererSessionInput): Promise<void> {
    const input = defineRendererSession(raw);
    const execution = await this.prisma.observationExecution.findFirst({ where: { id: input.executionId, organizationId }, include: { collector: true } });
    if (!execution || execution.collector.executionMode !== "renderer" || execution.status !== "running") throw new Error("active renderer execution not found");
    const comparable = {
      executionId: input.executionId, engine: input.engine, engineVersion: input.engineVersion,
      viewportWidth: input.viewport.width, viewportHeight: input.viewport.height, deviceScaleFactor: input.viewport.deviceScaleFactor,
      locale: input.locale, userAgent: input.userAgent, timingPolicy: input.timingPolicy,
    };
    const existing = await this.prisma.rendererSession.findUnique({ where: { executionId: input.executionId } });
    if (existing) {
      if (!same({ ...existing, createdAt: undefined }, comparable)) throw new Error("immutable renderer session conflict");
      return;
    }
    await this.prisma.rendererSession.create({ data: { ...comparable, timingPolicy: asJson(input.timingPolicy) } });
  }

  async getSession(organizationId: string, executionId: string) {
    const session = await this.prisma.rendererSession.findFirst({ where: { executionId, execution: { organizationId } }, include: { execution: true } });
    if (!session) throw new Error("renderer session not found");
    return session;
  }

  async finishSession(organizationId: string, input: { executionId: string; status: "completed" | "partial" | "failed" | "cancelled"; finishedAt: string; error?: unknown }): Promise<void> {
    if (input.status === "failed" && input.error === undefined) throw new Error("renderer failure details are required");
    const session = await this.getSession(organizationId, input.executionId);
    if (session.execution.status !== "running") throw new Error("renderer execution is not running");
    await this.prisma.observationExecution.update({ where: { id: input.executionId }, data: {
      status: input.status, finishedAt: new Date(input.finishedAt), ...(input.error === undefined ? {} : { error: asJson(input.error) }),
    } });
  }
}
