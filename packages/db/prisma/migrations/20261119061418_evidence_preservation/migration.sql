-- AlterTable
ALTER TABLE "crawl_runs" ADD COLUMN     "attempted_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "authorization_id" TEXT,
ADD COLUMN     "collected_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discovered_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extractor_version" TEXT,
ADD COLUMN     "failed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "frozen_at" TIMESTAMP(3),
ADD COLUMN     "limits" JSONB,
ADD COLUMN     "normalization_policy_version" TEXT,
ADD COLUMN     "producer_version" TEXT,
ADD COLUMN     "scope" JSONB,
ADD COLUMN     "stop_reason" TEXT,
ADD COLUMN     "unattempted_count" INTEGER;

-- CreateTable
CREATE TABLE "export_authorizations" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "export_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_pages" (
    "id" TEXT NOT NULL,
    "crawl_run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "discovered_url" TEXT NOT NULL,
    "requested_url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "final_url" TEXT NOT NULL,
    "canonical_urls" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_transactions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "request_url" TEXT NOT NULL,
    "response_url" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "transferred_bytes" BIGINT NOT NULL,
    "decoded_bytes" BIGINT NOT NULL,
    "redirect_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_headers" (
    "id" UUID NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "evidence_headers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_header_values" (
    "id" UUID NOT NULL,
    "header_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "evidence_header_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_observations" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "value" JSONB,
    "reasons" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "field_overrides" JSONB,
    "raw_hash" TEXT,
    "normalized_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_limitations" (
    "id" TEXT NOT NULL,
    "crawl_run_id" UUID NOT NULL,
    "page_id" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_limitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_errors" (
    "id" TEXT NOT NULL,
    "crawl_run_id" UUID NOT NULL,
    "page_id" TEXT,
    "observation_id" TEXT,
    "stage" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "retryable" BOOLEAN NOT NULL,

    CONSTRAINT "evidence_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_authorizations_organization_id_site_id_idx" ON "export_authorizations"("organization_id", "site_id");

-- CreateIndex
CREATE INDEX "evidence_pages_crawl_run_id_id_idx" ON "evidence_pages"("crawl_run_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_pages_crawl_run_id_position_key" ON "evidence_pages"("crawl_run_id", "position");

-- CreateIndex
CREATE INDEX "evidence_transactions_page_id_id_idx" ON "evidence_transactions"("page_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_transactions_page_id_position_key" ON "evidence_transactions"("page_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_headers_transaction_id_position_key" ON "evidence_headers"("transaction_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_header_values_header_id_position_key" ON "evidence_header_values"("header_id", "position");

-- CreateIndex
CREATE INDEX "evidence_observations_page_id_id_idx" ON "evidence_observations"("page_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_observations_page_id_method_key" ON "evidence_observations"("page_id", "method");

-- CreateIndex
CREATE INDEX "evidence_limitations_crawl_run_id_id_idx" ON "evidence_limitations"("crawl_run_id", "id");

-- CreateIndex
CREATE INDEX "evidence_errors_crawl_run_id_id_idx" ON "evidence_errors"("crawl_run_id", "id");

-- AddForeignKey
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "export_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_authorizations" ADD CONSTRAINT "export_authorizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_authorizations" ADD CONSTRAINT "export_authorizations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_pages" ADD CONSTRAINT "evidence_pages_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_transactions" ADD CONSTRAINT "evidence_transactions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "evidence_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_headers" ADD CONSTRAINT "evidence_headers_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "evidence_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_header_values" ADD CONSTRAINT "evidence_header_values_header_id_fkey" FOREIGN KEY ("header_id") REFERENCES "evidence_headers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_observations" ADD CONSTRAINT "evidence_observations_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "evidence_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_limitations" ADD CONSTRAINT "evidence_limitations_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_limitations" ADD CONSTRAINT "evidence_limitations_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "evidence_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_errors" ADD CONSTRAINT "evidence_errors_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_errors" ADD CONSTRAINT "evidence_errors_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "evidence_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_errors" ADD CONSTRAINT "evidence_errors_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "evidence_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
