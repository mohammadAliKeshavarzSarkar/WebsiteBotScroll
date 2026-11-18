export const largeResponseFixtures = {
  htmlOverDecompressedLimit: (bytes = 20 * 1024 * 1024 + 1): string => `<html><body>${"x".repeat(Math.max(0, bytes - 26))}</body></html>`,
  binaryOverLimit: (bytes = 10 * 1024 * 1024 + 1): Uint8Array => new Uint8Array(bytes),
} as const;
