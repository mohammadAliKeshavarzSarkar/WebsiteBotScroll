CREATE TABLE "observation_definitions" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "schema" JSONB NOT NULL,
  "schema_sha256" CHAR(64) NOT NULL,
  "scopes" JSONB NOT NULL,
  "statuses" JSONB NOT NULL,
  "sensitivity" TEXT NOT NULL,
  "retention_class" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'published',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deprecated_at" TIMESTAMP(3),
  CONSTRAINT "observation_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "observation_definitions_key_version_key" ON "observation_definitions"("key", "version");
CREATE INDEX "observation_definitions_key_status_idx" ON "observation_definitions"("key", "status");

CREATE TABLE "collector_definitions" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "configuration_schema" JSONB NOT NULL,
  "configuration_schema_sha256" CHAR(64) NOT NULL,
  "execution_mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'published',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deprecated_at" TIMESTAMP(3),
  CONSTRAINT "collector_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collector_definitions_key_version_key" ON "collector_definitions"("key", "version");
CREATE INDEX "collector_definitions_key_status_idx" ON "collector_definitions"("key", "status");

CREATE TABLE "collector_capabilities" (
  "collector_definition_id" UUID NOT NULL,
  "observation_definition_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "collector_capabilities_pkey" PRIMARY KEY ("collector_definition_id", "observation_definition_id"),
  CONSTRAINT "collector_capabilities_collector_definition_id_fkey" FOREIGN KEY ("collector_definition_id") REFERENCES "collector_definitions"("id") ON DELETE CASCADE,
  CONSTRAINT "collector_capabilities_observation_definition_id_fkey" FOREIGN KEY ("observation_definition_id") REFERENCES "observation_definitions"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "collector_capabilities_collector_definition_id_position_key" ON "collector_capabilities"("collector_definition_id", "position");
