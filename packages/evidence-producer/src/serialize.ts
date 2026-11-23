const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, stable(item)])) : value;

export function serializeEvidence(document: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(stable(document), null, 2)}\n`, "utf8");
}
