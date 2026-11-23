import { describe, expect, it } from "vitest";
import { parseCreateSiteInput } from "./site-input";

describe("website onboarding input", () => {
  it.each([
    [{ name: "  Main shop  ", origin: "https://Example.COM:443/catalog?q=1#top" }, { name: "Main shop", origin: "https://example.com" }],
    [{ name: "Docs", origin: "http://docs.example.com:80/start" }, { name: "Docs", origin: "http://docs.example.com" }],
  ])("normalizes %o to its safe origin", (input, expected) => {
    expect(parseCreateSiteInput(input)).toEqual(expected);
  });

  it.each([
    [{ name: "Site", origin: "example.com" }, "absolute HTTP(S) URL"],
    [{ name: "Site", origin: "https://user:secret@example.com" }, "credentials"],
    [{ name: "Site", origin: "ftp://example.com" }, "HTTP or HTTPS"],
    [{ name: "   ", origin: "https://example.com" }, "name is required"],
    [{ name: "x".repeat(81), origin: "https://example.com" }, "80 characters"],
  ])("rejects unsafe input %o", (input, message) => {
    expect(() => parseCreateSiteInput(input)).toThrow(message);
  });
});
