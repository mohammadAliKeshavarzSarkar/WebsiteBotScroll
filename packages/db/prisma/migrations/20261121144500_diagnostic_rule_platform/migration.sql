CREATE TABLE "diagnostic_rule_definitions" (
  "id" UUID NOT NULL, "key" TEXT NOT NULL, "version" TEXT NOT NULL, "policy_version" TEXT NOT NULL,
  "configuration_schema" JSONB NOT NULL, "configuration_schema_sha256" CHAR(64) NOT NULL, "outcomes" JSONB NOT NULL,
  "supports_unavailable_inputs" BOOLEAN NOT NULL, "status" TEXT NOT NULL DEFAULT 'published',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deprecated_at" TIMESTAMP(3),
  CONSTRAINT "diagnostic_rule_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "diagnostic_rule_definitions_key_version_key" ON "diagnostic_rule_definitions"("key", "version");
CREATE INDEX "diagnostic_rule_definitions_key_status_idx" ON "diagnostic_rule_definitions"("key", "status");

CREATE TABLE "diagnostic_rule_inputs" (
  "rule_definition_id" UUID NOT NULL, "observation_definition_id" UUID NOT NULL, "position" INTEGER NOT NULL,
  "scopes" JSONB NOT NULL, "required" BOOLEAN NOT NULL,
  CONSTRAINT "diagnostic_rule_inputs_pkey" PRIMARY KEY ("rule_definition_id", "observation_definition_id"),
  CONSTRAINT "diagnostic_rule_inputs_rule_definition_id_fkey" FOREIGN KEY ("rule_definition_id") REFERENCES "diagnostic_rule_definitions"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_rule_inputs_observation_definition_id_fkey" FOREIGN KEY ("observation_definition_id") REFERENCES "observation_definitions"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "diagnostic_rule_inputs_rule_definition_id_position_key" ON "diagnostic_rule_inputs"("rule_definition_id", "position");

CREATE TABLE "diagnostic_executions" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "rule_definition_id" UUID NOT NULL,
  "stable_key" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "configuration" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'running',
  "started_at" TIMESTAMP(3) NOT NULL, "finished_at" TIMESTAMP(3), "error" JSONB,
  CONSTRAINT "diagnostic_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "diagnostic_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_executions_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_executions_rule_definition_id_fkey" FOREIGN KEY ("rule_definition_id") REFERENCES "diagnostic_rule_definitions"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "diagnostic_executions_crawl_run_id_stable_key_attempt_key" ON "diagnostic_executions"("crawl_run_id", "stable_key", "attempt");
CREATE INDEX "diagnostic_executions_organization_id_crawl_run_id_status_idx" ON "diagnostic_executions"("organization_id", "crawl_run_id", "status");

CREATE TABLE "diagnostic_results" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "execution_id" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "message_data" JSONB NOT NULL,
  "limitations" JSONB NOT NULL, "collected_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "diagnostic_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "diagnostic_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_results_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_results_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "diagnostic_executions"("id") ON DELETE RESTRICT,
  CONSTRAINT "diagnostic_results_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "observation_subjects"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "diagnostic_results_execution_id_sequence_key" ON "diagnostic_results"("execution_id", "sequence");
CREATE INDEX "diagnostic_results_organization_id_crawl_run_id_subject_id_idx" ON "diagnostic_results"("organization_id", "crawl_run_id", "subject_id");

CREATE TABLE "diagnostic_result_inputs" (
  "result_id" TEXT NOT NULL, "observation_id" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "diagnostic_result_inputs_pkey" PRIMARY KEY ("result_id", "observation_id"),
  CONSTRAINT "diagnostic_result_inputs_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "diagnostic_results"("id") ON DELETE CASCADE,
  CONSTRAINT "diagnostic_result_inputs_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "platform_observations"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "diagnostic_result_inputs_result_id_position_key" ON "diagnostic_result_inputs"("result_id", "position");
