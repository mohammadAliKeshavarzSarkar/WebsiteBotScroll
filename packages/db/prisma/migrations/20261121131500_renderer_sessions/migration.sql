CREATE TABLE "renderer_sessions" (
  "execution_id" TEXT NOT NULL, "engine" TEXT NOT NULL, "engine_version" TEXT NOT NULL,
  "viewport_width" INTEGER NOT NULL, "viewport_height" INTEGER NOT NULL, "device_scale_factor" DOUBLE PRECISION NOT NULL,
  "locale" TEXT NOT NULL, "user_agent" TEXT NOT NULL, "timing_policy" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "renderer_sessions_pkey" PRIMARY KEY ("execution_id"),
  CONSTRAINT "renderer_sessions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "observation_executions"("id") ON DELETE CASCADE
);
