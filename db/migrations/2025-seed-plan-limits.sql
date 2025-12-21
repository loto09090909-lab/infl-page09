-- Migration: seed plan limits for free/basic/premium
BEGIN TRANSACTION;

INSERT OR IGNORE INTO plan_limits(
  plan_id,
  can_create_pages,
  can_change_slug,
  can_create_private_links,
  max_pages,
  max_private_links,
  max_contact_fields,
  can_export_csv,
  stats_retention_days
)
VALUES
('free',    1, 0, 0, 1, 3, 5, 0, 7),
('basic',   1, 1, 1, 3, 10, 15, 1, 30),
('premium', 1, 1, 1, 10, 50, 50, 1, 365);

COMMIT;
