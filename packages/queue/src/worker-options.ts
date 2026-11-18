export const CRAWL_QUEUE_NAME = "crawl";
export const RUN_CRAWL_JOB_NAME = "run-crawl";
export const PROCESS_PAGE_JOB_NAME = "process-page";

export const crawlWorkerOptions = {
  concurrency: 2,
  lockDuration: 60_000,
  maxStalledCount: 2,
} as const;

export const crawlJobOptions = {
  attempts: 3,
  backoff: { type: "custom", delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 1_000,
} as const;
