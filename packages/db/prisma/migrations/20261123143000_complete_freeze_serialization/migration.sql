CREATE OR REPLACE FUNCTION "lock_legacy_page_evidence_run"() RETURNS trigger AS $$
DECLARE target_run UUID; frozen_at TIMESTAMP(3);
BEGIN
  SELECT p."crawl_run_id" INTO target_run FROM "evidence_pages" p WHERE p."id" = COALESCE(NEW."page_id", OLD."page_id");
  SELECT r."frozen_at" INTO frozen_at FROM "crawl_runs" r WHERE r."id" = target_run FOR UPDATE;
  IF frozen_at IS NOT NULL THEN RAISE EXCEPTION 'crawl run evidence is frozen'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "lock_renderer_session_run"() RETURNS trigger AS $$
DECLARE target_run UUID; frozen_at TIMESTAMP(3);
BEGIN
  SELECT e."crawl_run_id" INTO target_run FROM "observation_executions" e WHERE e."id" = COALESCE(NEW."execution_id", OLD."execution_id");
  SELECT r."frozen_at" INTO frozen_at FROM "crawl_runs" r WHERE r."id" = target_run FOR UPDATE;
  IF frozen_at IS NOT NULL THEN RAISE EXCEPTION 'crawl run evidence is frozen'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "evidence_pages_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_pages" FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "evidence_transactions_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_transactions" FOR EACH ROW EXECUTE FUNCTION "lock_legacy_page_evidence_run"();
CREATE TRIGGER "evidence_observations_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_observations" FOR EACH ROW EXECUTE FUNCTION "lock_legacy_page_evidence_run"();
CREATE TRIGGER "evidence_errors_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_errors" FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "evidence_limitations_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_limitations" FOR EACH ROW EXECUTE FUNCTION "lock_mutable_evidence_run"();
CREATE TRIGGER "renderer_sessions_mutable_run" BEFORE INSERT OR UPDATE OR DELETE ON "renderer_sessions" FOR EACH ROW EXECUTE FUNCTION "lock_renderer_session_run"();

CREATE OR REPLACE FUNCTION "protect_frozen_run_evidence_fields"() RETURNS trigger AS $$
BEGIN
  IF OLD."frozen_at" IS NOT NULL AND (
    NEW."scope" IS DISTINCT FROM OLD."scope" OR NEW."limits" IS DISTINCT FROM OLD."limits" OR
    NEW."discovered_count" IS DISTINCT FROM OLD."discovered_count" OR NEW."attempted_count" IS DISTINCT FROM OLD."attempted_count" OR
    NEW."collected_count" IS DISTINCT FROM OLD."collected_count" OR NEW."failed_count" IS DISTINCT FROM OLD."failed_count" OR
    NEW."unattempted_count" IS DISTINCT FROM OLD."unattempted_count" OR NEW."stop_reason" IS DISTINCT FROM OLD."stop_reason" OR
    NEW."producer_version" IS DISTINCT FROM OLD."producer_version" OR NEW."normalization_policy_version" IS DISTINCT FROM OLD."normalization_policy_version" OR
    NEW."extractor_version" IS DISTINCT FROM OLD."extractor_version"
  ) THEN RAISE EXCEPTION 'crawl run evidence is frozen'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "crawl_runs_frozen_evidence_fields" BEFORE UPDATE ON "crawl_runs" FOR EACH ROW EXECUTE FUNCTION "protect_frozen_run_evidence_fields"();

CREATE OR REPLACE FUNCTION "protect_execution_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'running' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal execution is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "observation_executions_terminal_immutable" BEFORE UPDATE ON "observation_executions" FOR EACH ROW EXECUTE FUNCTION "protect_execution_transition"();
CREATE TRIGGER "diagnostic_executions_terminal_immutable" BEFORE UPDATE ON "diagnostic_executions" FOR EACH ROW EXECUTE FUNCTION "protect_execution_transition"();
