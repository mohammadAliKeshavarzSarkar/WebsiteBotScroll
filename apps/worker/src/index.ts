import { loadEnv, type AppEnv } from "@website-bot-scroll/config";

export function startWorker(
  source: NodeJS.ProcessEnv,
  write: (message: string) => void = console.log,
): AppEnv {
  const environment = loadEnv(source);
  write(JSON.stringify({ component: "worker", event: "ready" }));
  return environment;
}

if (process.env.NODE_ENV !== "test") {
  startWorker(process.env);
}
