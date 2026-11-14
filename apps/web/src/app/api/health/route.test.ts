import { describe, expect, it } from "vitest";
import { GET } from "./route.js";

describe("GET /api/health", () => {
  it("reports a healthy process", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
