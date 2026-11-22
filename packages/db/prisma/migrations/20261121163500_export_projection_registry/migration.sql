CREATE TABLE "export_projection_definitions" (
  "id" UUID NOT NULL, "key" TEXT NOT NULL, "version" TEXT NOT NULL, "format" TEXT NOT NULL, "media_type" TEXT NOT NULL,
  "accepted_observation_definitions" JSONB NOT NULL, "accepted_diagnostic_rules" JSONB NOT NULL, "identity_sha256" CHAR(64) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'published', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_projection_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "export_projection_definitions_key_version_key" ON "export_projection_definitions"("key", "version");

CREATE TABLE "platform_snapshots" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "producer_revision" CHAR(40) NOT NULL,
  "sha256" CHAR(64) NOT NULL, "payload" JSONB NOT NULL, "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_snapshots_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "platform_snapshots_crawl_run_id_key" ON "platform_snapshots"("crawl_run_id");
CREATE INDEX "platform_snapshots_organization_id_frozen_at_idx" ON "platform_snapshots"("organization_id", "frozen_at");

CREATE TABLE "projection_executions" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "snapshot_id" UUID NOT NULL, "projection_definition_id" UUID NOT NULL,
  "stable_key" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "status" TEXT NOT NULL, "output_artifact_id" UUID NOT NULL,
  "output_sha256" CHAR(64) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projection_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "projection_executions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "platform_snapshots"("id") ON DELETE RESTRICT,
  CONSTRAINT "projection_executions_projection_definition_id_fkey" FOREIGN KEY ("projection_definition_id") REFERENCES "export_projection_definitions"("id") ON DELETE RESTRICT,
  CONSTRAINT "projection_executions_output_artifact_id_fkey" FOREIGN KEY ("output_artifact_id") REFERENCES "evidence_artifacts"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "projection_executions_snapshot_id_stable_key_attempt_key" ON "projection_executions"("snapshot_id", "stable_key", "attempt");

CREATE FUNCTION reject_platform_snapshot_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'platform snapshots are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER platform_snapshots_immutable BEFORE UPDATE OR DELETE ON "platform_snapshots" FOR EACH ROW EXECUTE FUNCTION reject_platform_snapshot_mutation();
