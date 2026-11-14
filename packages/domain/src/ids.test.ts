import { describe, expect, it } from "vitest";
import { organizationId, siteId, userId } from "./ids.js";

describe("branded identifiers", () => {
  it("preserves a non-empty identifier value", () => {
    expect(organizationId("org-1")).toBe("org-1");
    expect(userId("user-1")).toBe("user-1");
    expect(siteId("site-1")).toBe("site-1");
  });

  it("rejects an empty or whitespace-only identifier", () => {
    expect(() => organizationId(" ")).toThrow("OrganizationId must not be empty");
  });
});
