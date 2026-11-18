-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrawlTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RETRY');

-- CreateTable
CREATE TABLE "crawl_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "trigger" "CrawlTrigger" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'PENDING',
    "active_site_key" UUID,
    "frontier" JSONB NOT NULL DEFAULT '[]',
    "processed_urls" JSONB NOT NULL DEFAULT '[]',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_errors" (
    "id" UUID NOT NULL,
    "crawl_run_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crawl_errors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crawl_runs_active_site_key_key" ON "crawl_runs"("active_site_key");
CREATE UNIQUE INDEX "crawl_runs_site_id_idempotency_key_key" ON "crawl_runs"("site_id", "idempotency_key");
CREATE INDEX "crawl_runs_organization_id_created_at_idx" ON "crawl_runs"("organization_id", "created_at");
CREATE INDEX "crawl_runs_site_id_status_idx" ON "crawl_runs"("site_id", "status");
CREATE INDEX "crawl_errors_crawl_run_id_created_at_idx" ON "crawl_errors"("crawl_run_id", "created_at");

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crawl_errors" ADD CONSTRAINT "crawl_errors_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
