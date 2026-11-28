import { createHash } from "node:crypto";

const COMMIT = /^[a-f0-9]{40}$/;
const stableObjects = (value: unknown): unknown => Array.isArray(value) ? value.map(stableObjects) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableObjects(item)])) : value;

export function buildNeutralSnapshot(snapshot: unknown): { bytes: Buffer; sha256: string } {
  const revision = (snapshot as { run?: { producerRevision?: unknown } })?.run?.producerRevision;
  if (typeof revision !== "string" || !COMMIT.test(revision)) throw new TypeError("exact producer revision is required");
  const bytes = Buffer.from(`${JSON.stringify(stableObjects(snapshot))}\n`, "utf8");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
