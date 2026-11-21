CREATE TABLE "observation_subjects" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "position" INTEGER NOT NULL,
  "kind" TEXT NOT NULL, "identity" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "observation_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observation_subjects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "observation_subjects_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "observation_subjects_crawl_run_id_position_key" ON "observation_subjects"("crawl_run_id", "position");
CREATE INDEX "observation_subjects_organization_id_crawl_run_id_kind_idx" ON "observation_subjects"("organization_id", "crawl_run_id", "kind");
CREATE TABLE "observation_subject_members" (
  "subject_id" TEXT NOT NULL, "member_subject_id" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "observation_subject_members_pkey" PRIMARY KEY ("subject_id", "member_subject_id"),
  CONSTRAINT "observation_subject_members_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "observation_subjects"("id") ON DELETE CASCADE,
  CONSTRAINT "observation_subject_members_member_subject_id_fkey" FOREIGN KEY ("member_subject_id") REFERENCES "observation_subjects"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "observation_subject_members_subject_id_position_key" ON "observation_subject_members"("subject_id", "position");
CREATE TABLE "observation_executions" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "collector_definition_id" UUID NOT NULL,
  "parent_execution_id" TEXT, "stable_key" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "trigger" TEXT NOT NULL,
  "configuration" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'running', "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3), "error" JSONB, CONSTRAINT "observation_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "observation_executions_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE,
  CONSTRAINT "observation_executions_collector_definition_id_fkey" FOREIGN KEY ("collector_definition_id") REFERENCES "collector_definitions"("id") ON DELETE RESTRICT,
  CONSTRAINT "observation_executions_parent_execution_id_fkey" FOREIGN KEY ("parent_execution_id") REFERENCES "observation_executions"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "observation_executions_crawl_run_id_stable_key_attempt_key" ON "observation_executions"("crawl_run_id", "stable_key", "attempt");
CREATE INDEX "observation_executions_organization_id_crawl_run_id_status_idx" ON "observation_executions"("organization_id", "crawl_run_id", "status");
CREATE TABLE "platform_observations" (
  "id" TEXT NOT NULL, "organization_id" UUID NOT NULL, "crawl_run_id" UUID NOT NULL, "subject_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL, "observation_definition_id" UUID NOT NULL, "sequence" INTEGER NOT NULL, "status" TEXT NOT NULL,
  "payload" JSONB, "reasons" JSONB NOT NULL, "provenance" JSONB NOT NULL, "collected_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "platform_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_observations_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_observations_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "observation_subjects"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_observations_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "observation_executions"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_observations_observation_definition_id_fkey" FOREIGN KEY ("observation_definition_id") REFERENCES "observation_definitions"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "platform_observations_execution_id_sequence_key" ON "platform_observations"("execution_id", "sequence");
CREATE INDEX "platform_observations_organization_id_crawl_run_id_subject_id_idx" ON "platform_observations"("organization_id", "crawl_run_id", "subject_id");
