import { loadEnv, type AppEnv } from "@website-bot-scroll/config";
import { createCrawlWorker } from "./crawl-worker.js";

type WorkerRuntime = { close(): Promise<void> };

export function startWorker(
  source: NodeJS.ProcessEnv,
  write: (message: string) => void = console.log,
  createRuntime: (environment: AppEnv) => WorkerRuntime = createCrawlWorker,
): WorkerRuntime {
  const environment = loadEnv(source);
  const runtime = createRuntime(environment);
  write(JSON.stringify({ component: "worker", event: "ready" }));
  return runtime;
}

if (process.env.NODE_ENV !== "test") {
  const runtime = startWorker(process.env);
  const shutdown = async () => { await runtime.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
