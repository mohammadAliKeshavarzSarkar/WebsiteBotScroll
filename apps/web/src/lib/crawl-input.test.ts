import { describe, expect, it } from "vitest";
import { parseAuthorizationInput, parseStartCrawlInput } from "./crawl-input";

describe("crawl authorization input", () => {
  it("accepts an explicit owner declaration", () => {
    expect(parseAuthorizationInput({ declaration: "on" })).toEqual({ declarationAccepted: true });
  });

  it.each([
    undefined,
    null,
    {},
    { declaration: "" },
    { declaration: "true" },
    { declaration: true },
    { declaration: ["on"] },
  ])("rejects an absent or unexpected declaration value %#", (input) => {
    expect(() => parseAuthorizationInput(input)).toThrow("Confirm that you are authorized to crawl this website");
  });
});

describe("manual crawl input", () => {
  it.each([
    [undefined, { maxPages: 25, maxDepth: 1, maxDurationMs: 60_000, maxResponseBytes: 5_242_880 }],
    [{}, { maxPages: 25, maxDepth: 1, maxDurationMs: 60_000, maxResponseBytes: 5_242_880 }],
    [
      { maxPages: "", maxDepth: "", maxDurationSeconds: "" },
      { maxPages: 25, maxDepth: 1, maxDurationMs: 60_000, maxResponseBytes: 5_242_880 },
    ],
    [
      { maxPages: "1", maxDepth: "0", maxDurationSeconds: "10" },
      { maxPages: 1, maxDepth: 0, maxDurationMs: 10_000, maxResponseBytes: 5_242_880 },
    ],
    [
      { maxPages: "100", maxDepth: "3", maxDurationSeconds: "300" },
      { maxPages: 100, maxDepth: 3, maxDurationMs: 300_000, maxResponseBytes: 5_242_880 },
    ],
  ])("parses bounded form values %#", (input, expected) => {
    expect(parseStartCrawlInput(input)).toEqual(expected);
  });

  it.each([
    [{ maxPages: "0" }, "Maximum pages must be a whole number from 1 to 100"],
    [{ maxPages: "101" }, "Maximum pages must be a whole number from 1 to 100"],
    [{ maxPages: "1.5" }, "Maximum pages must be a whole number from 1 to 100"],
    [{ maxPages: 25 }, "Maximum pages must be a whole number from 1 to 100"],
    [{ maxPages: " 25 " }, "Maximum pages must be a whole number from 1 to 100"],
    [{ maxDepth: "-1" }, "Maximum depth must be a whole number from 0 to 3"],
    [{ maxDepth: "4" }, "Maximum depth must be a whole number from 0 to 3"],
    [{ maxDepth: "1.5" }, "Maximum depth must be a whole number from 0 to 3"],
    [{ maxDepth: true }, "Maximum depth must be a whole number from 0 to 3"],
    [{ maxDurationSeconds: "9" }, "Maximum duration must be a whole number from 10 to 300 seconds"],
    [{ maxDurationSeconds: "301" }, "Maximum duration must be a whole number from 10 to 300 seconds"],
    [{ maxDurationSeconds: "60.5" }, "Maximum duration must be a whole number from 10 to 300 seconds"],
    [{ maxDurationSeconds: ["60"] }, "Maximum duration must be a whole number from 10 to 300 seconds"],
  ])("rejects coercible, fractional, or out-of-range values %#", (input, message) => {
    expect(() => parseStartCrawlInput(input)).toThrow(message);
  });

  it.each([null, [], "maxPages=25", 25])("rejects a non-record crawl request %#", (input) => {
    expect(() => parseStartCrawlInput(input)).toThrow("Crawl controls must be submitted as form fields");
  });
});
