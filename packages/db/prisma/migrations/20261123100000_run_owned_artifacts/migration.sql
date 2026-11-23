DROP INDEX "evidence_artifacts_organization_id_sha256_key";
CREATE UNIQUE INDEX "evidence_artifacts_crawl_run_id_sha256_key" ON "evidence_artifacts"("crawl_run_id", "sha256");
