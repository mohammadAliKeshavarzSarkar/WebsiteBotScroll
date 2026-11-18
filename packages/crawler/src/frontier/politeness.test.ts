import { describe, expect, it } from "vitest";

import { HostPoliteness } from "./politeness.js";

describe("HostPoliteness", () => {
  it("allows two concurrent requests per host and spaces starts by 500ms", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const policy = new HostPoliteness({ concurrency: 2, minimumStartIntervalMs: 500, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    const first = await policy.acquire("example.com");
    const second = await policy.acquire("example.com");
    let thirdAcquired = false;
    const thirdPromise = policy.acquire("example.com").then((lease) => { thirdAcquired = true; return lease; });
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);
    first.release();
    const third = await thirdPromise;
    expect(sleeps).toEqual([500, 500]);
    second.release();
    third.release();
  });
});
