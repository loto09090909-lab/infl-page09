-- Migration: add missing columns to plan_limits (legacy fix)
BEGIN TRANSACTION;

ALTER TABLE plan_limits ADD COLUMN can_create_pages INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_limits ADD COLUMN can_change_slug INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_limits ADD COLUMN can_create_private_links INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_limits ADD COLUMN max_pages INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_limits ADD COLUMN max_private_links INTEGER NOT NULL DEFAULT 5;
ALTER TABLE plan_limits ADD COLUMN max_contact_fields INTEGER NOT NULL DEFAULT 10;
ALTER TABLE plan_limits ADD COLUMN can_export_csv INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN stats_retention_days INTEGER NOT NULL DEFAULT 30;

COMMIT;
