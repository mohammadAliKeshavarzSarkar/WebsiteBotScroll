import { describe, expect, it } from "vitest";
import { defineRendererSession, RENDERER_ARTIFACT_ROLES, SYNTHETIC_RENDERER_DEFINITION } from "./renderer-session.js";

const valid = {
  executionId: "execution-render-1", engine: "synthetic" as const, engineVersion: "1.0.0",
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }, locale: "fa-IR", userAgent: "WebsiteBotScroll Renderer/1.0",
  timingPolicy: { navigationTimeoutMs: 30_000, settleDelayMs: 500, waitUntil: "networkidle" as const },
};

describe("renderer sessions", () => {
  it("pins a complete renderer environment and artifact roles", () => {
    expect(defineRendererSession(valid)).toEqual(valid);
    expect(RENDERER_ARTIFACT_ROLES).toEqual(["screenshot", "trace", "dom_snapshot"]);
    expect(SYNTHETIC_RENDERER_DEFINITION.executionMode).toBe("renderer");
  });

  it.each([
    { ...valid, engineVersion: "" },
    { ...valid, viewport: { ...valid.viewport, width: 0 } },
    { ...valid, viewport: { ...valid.viewport, deviceScaleFactor: 0 } },
    { ...valid, timingPolicy: { ...valid.timingPolicy, navigationTimeoutMs: -1 } },
    { ...valid, locale: "" },
    { ...valid, userAgent: "" },
  ])("rejects incomplete or unsafe renderer configuration", (input) => {
    expect(() => defineRendererSession(input)).toThrow();
  });
});
