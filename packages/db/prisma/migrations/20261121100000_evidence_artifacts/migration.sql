CREATE TABLE "evidence_artifacts" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "sha256" CHAR(64) NOT NULL,
  "byte_length" INTEGER NOT NULL, "media_type" TEXT NOT NULL, "locator" TEXT NOT NULL, "sensitivity" TEXT NOT NULL,
  "retention_class" TEXT NOT NULL, "availability" TEXT NOT NULL DEFAULT 'available', "pinned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "evidence_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evidence_artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "evidence_artifacts_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "evidence_artifacts_organization_id_sha256_key" ON "evidence_artifacts"("organization_id", "sha256");
CREATE INDEX "evidence_artifacts_organization_id_crawl_run_id_availability_idx" ON "evidence_artifacts"("organization_id", "crawl_run_id", "availability");
CREATE TABLE "observation_artifacts" (
  "observation_id" TEXT NOT NULL, "artifact_id" UUID NOT NULL, "position" INTEGER NOT NULL, "role" TEXT NOT NULL,
  CONSTRAINT "observation_artifacts_pkey" PRIMARY KEY ("observation_id", "artifact_id"),
  CONSTRAINT "observation_artifacts_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "platform_observations"("id") ON DELETE CASCADE,
  CONSTRAINT "observation_artifacts_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "evidence_artifacts"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "observation_artifacts_observation_id_position_key" ON "observation_artifacts"("observation_id", "position");
