CREATE UNIQUE INDEX "export_authorizations_one_active_per_site"
ON "export_authorizations" ("site_id")
WHERE "revoked_at" IS NULL;
