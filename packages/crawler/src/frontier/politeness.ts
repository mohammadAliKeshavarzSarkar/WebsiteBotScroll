export interface HostPolitenessOptions {
  concurrency?: number;
  minimumStartIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface HostLease { release(): void }
interface HostState { active: number; lastStart: number; waiters: Array<() => void> }

export class HostPoliteness {
  private readonly states = new Map<string, HostState>();
  private readonly concurrency: number;
  private readonly interval: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: HostPolitenessOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.interval = options.minimumStartIntervalMs ?? 500;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async acquire(hostname: string): Promise<HostLease> {
    let state = this.states.get(hostname);
    if (!state) this.states.set(hostname, state = { active: 0, lastStart: Number.NEGATIVE_INFINITY, waiters: [] });
    if (state.active >= this.concurrency) await new Promise<void>((resolve) => state!.waiters.push(resolve));
    const delay = Math.max(0, state.lastStart + this.interval - this.now());
    if (delay > 0) await this.sleep(delay);
    state.active += 1;
    state.lastStart = this.now();
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;
      state!.active -= 1;
      state!.waiters.shift()?.();
    } };
  }
}
