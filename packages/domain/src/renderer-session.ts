import type { CollectorDefinitionInput } from "./observation-platform.js";

export const RENDERER_ARTIFACT_ROLES = ["screenshot", "trace", "dom_snapshot"] as const;
export type RendererArtifactRole = (typeof RENDERER_ARTIFACT_ROLES)[number];
export interface RendererSessionInput {
  executionId: string;
  engine: "chromium" | "firefox" | "webkit" | "synthetic";
  engineVersion: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  locale: string;
  userAgent: string;
  timingPolicy: { navigationTimeoutMs: number; settleDelayMs: number; waitUntil: "load" | "domcontentloaded" | "networkidle" };
}

const nonEmpty = (value: string, name: string): void => { if (value.trim() === "") throw new TypeError(`${name} is required`); };
export function defineRendererSession(input: RendererSessionInput): RendererSessionInput {
  nonEmpty(input.executionId, "executionId"); nonEmpty(input.engineVersion, "engineVersion"); nonEmpty(input.locale, "locale"); nonEmpty(input.userAgent, "userAgent");
  if (!Number.isSafeInteger(input.viewport.width) || input.viewport.width <= 0 || input.viewport.width > 16_384) throw new TypeError("viewport width is invalid");
  if (!Number.isSafeInteger(input.viewport.height) || input.viewport.height <= 0 || input.viewport.height > 16_384) throw new TypeError("viewport height is invalid");
  if (!Number.isFinite(input.viewport.deviceScaleFactor) || input.viewport.deviceScaleFactor <= 0 || input.viewport.deviceScaleFactor > 8) throw new TypeError("device scale factor is invalid");
  if (!Number.isSafeInteger(input.timingPolicy.navigationTimeoutMs) || input.timingPolicy.navigationTimeoutMs < 0) throw new TypeError("navigation timeout is invalid");
  if (!Number.isSafeInteger(input.timingPolicy.settleDelayMs) || input.timingPolicy.settleDelayMs < 0) throw new TypeError("settle delay is invalid");
  return { ...input, viewport: { ...input.viewport }, timingPolicy: { ...input.timingPolicy } };
}

export const SYNTHETIC_RENDERER_DEFINITION: CollectorDefinitionInput = {
  key: "renderer.synthetic", version: "1.0.0", configurationSchema: { type: "object", additionalProperties: false },
  capabilities: [{ observationKey: "page.rendering", observationVersion: "1.0.0" }], executionMode: "renderer",
};
