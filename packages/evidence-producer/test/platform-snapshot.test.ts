import { describe, expect, it } from "vitest";
import { buildNeutralSnapshot } from "../src/platform-snapshot.js";

describe("neutral platform snapshot", () => {
  it("serializes deterministically without changing ordered arrays", () => {
    const snapshot = { run: { id: "run-1", producerRevision: "a".repeat(40) }, subjects: [{ id: "b" }, { id: "a" }], observations: [{ sequence: 1 }, { sequence: 0 }] };
    const first = buildNeutralSnapshot(snapshot);
    const second = buildNeutralSnapshot({ observations: snapshot.observations, subjects: snapshot.subjects, run: snapshot.run });
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(first.bytes.toString("utf8")).subjects.map(({ id }: { id: string }) => id)).toEqual(["b", "a"]);
  });

  it("rejects dirty or non-commit producer revisions", () => {
    expect(() => buildNeutralSnapshot({ run: { producerRevision: "abc-dirty" } })).toThrow("producer revision");
  });
});
