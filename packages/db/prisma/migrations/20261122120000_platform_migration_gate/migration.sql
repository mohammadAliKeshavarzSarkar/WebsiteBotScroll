CREATE TABLE "platform_migration_states" (
    "crawl_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "checkpoint" JSONB NOT NULL,
    "parity_digest" CHAR(64) NOT NULL,
    "parity_verified_at" TIMESTAMP(3) NOT NULL,
    "read_authority" TEXT NOT NULL DEFAULT 'legacy',
    "switched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_migration_states_pkey" PRIMARY KEY ("crawl_run_id"),
    CONSTRAINT "platform_migration_states_digest_check" CHECK ("parity_digest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "platform_migration_states_authority_check" CHECK ("read_authority" IN ('legacy', 'generalized')),
    CONSTRAINT "platform_migration_states_run_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE RESTRICT,
    CONSTRAINT "platform_migration_states_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT
);

CREATE INDEX "platform_migration_states_organization_id_read_authority_idx"
ON "platform_migration_states"("organization_id", "read_authority");

CREATE OR REPLACE FUNCTION "lock_mutable_evidence_run"() RETURNS trigger AS $$
DECLARE
  target_run UUID;
  frozen_at TIMESTAMP(3);
BEGIN
  target_run := COALESCE(NEW."crawl_run_id", OLD."crawl_run_id");
  SELECT "crawl_runs"."frozen_at" INTO frozen_at
    FROM "crawl_runs" WHERE "id" = target_run FOR UPDATE;
  IF frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'crawl run evidence is frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "observation_subjects_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "observation_subjects"
FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "observation_executions_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "observation_executions"
FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "platform_observations_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "platform_observations"
FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "diagnostic_executions_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "diagnostic_executions"
FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "diagnostic_results_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "diagnostic_results"
FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
