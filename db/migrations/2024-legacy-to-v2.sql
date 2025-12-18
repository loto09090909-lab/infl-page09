-- Migration script: migrate legacy tables to normalized v2 schema
-- Steps: backup legacy data -> create new tables -> backfill -> add indexes -> park legacy tables

BEGIN TRANSACTION;

-- 0. Backup legacy tables (idempotent if rerun)
CREATE TABLE IF NOT EXISTS backup_super_admin AS SELECT * FROM super_admin;
CREATE TABLE IF NOT EXISTS backup_page_auth AS SELECT * FROM page_auth;
CREATE TABLE IF NOT EXISTS backup_page_meta AS SELECT * FROM page_meta;
CREATE TABLE IF NOT EXISTS backup_page_stats AS SELECT * FROM page_stats;
CREATE TABLE IF NOT EXISTS backup_slug_map AS SELECT * FROM slug_map;

-- 1. Create new schema targets (aligned with db/schema.sql)
CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  photo_url TEXT,
  description TEXT,
  links_json TEXT,
  plan TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_slugs (
  slug TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER', 'PAGE')),
  page_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE (username, role),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS page_stats_daily (
  page_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  admin_views INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, day),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS page_stats_hourly (
  page_id TEXT NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  views INTEGER NOT NULL DEFAULT 0,
  admin_views INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, day, hour),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

-- 2. Backfill page metadata
INSERT OR IGNORE INTO pages (page_id, display_name, photo_url, description, links_json, plan, is_active, created_at, updated_at)
SELECT
  pm.page_id,
  COALESCE(NULLIF(pm.name, ''), pm.page_id),
  pm.photo_url,
  pm.description,
  pm.links,
  NULL,
  1,
  COALESCE(pm.created_at, datetime('now')),
  COALESCE(pm.updated_at, datetime('now'))
FROM page_meta pm;

-- 3. Backfill slugs (primary from slug_map, fallback to page_id when missing)
INSERT OR IGNORE INTO page_slugs (slug, page_id, is_primary, created_at)
SELECT sm.display_name, sm.page_id, 1, datetime('now') FROM slug_map sm;

INSERT OR IGNORE INTO page_slugs (slug, page_id, is_primary, created_at)
SELECT p.page_id, p.page_id, 1, datetime('now')
FROM pages p
WHERE NOT EXISTS (
  SELECT 1 FROM page_slugs s WHERE s.page_id = p.page_id AND s.is_primary = 1
);

-- 4. Backfill admin principals
INSERT OR IGNORE INTO admins (username, password_hash, role, page_id, created_at)
SELECT 'super', sa.password_hash, 'SUPER', NULL, datetime('now') FROM super_admin sa;

INSERT OR IGNORE INTO admins (username, password_hash, role, page_id, created_at)
SELECT 'page:' || pa.page_id, pa.password_hash, 'PAGE', pa.page_id, datetime('now') FROM page_auth pa;

-- 5. Backfill stats
INSERT OR IGNORE INTO page_stats_daily (page_id, day, views, admin_views, revenue_cents)
SELECT page_id, day, COALESCE(views, 0), COALESCE(admin_views, 0), CAST(COALESCE(revenue, 0) * 100 AS INTEGER) FROM page_stats;

-- 6. Add indexes / constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_slugs_primary ON page_slugs(page_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_page_slugs_page_id ON page_slugs(page_id);
CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at);
CREATE INDEX IF NOT EXISTS idx_page_stats_daily_day ON page_stats_daily(day);
CREATE INDEX IF NOT EXISTS idx_page_stats_hourly_day_hour ON page_stats_hourly(day, hour);
CREATE INDEX IF NOT EXISTS idx_admins_page_id ON admins(page_id);

-- 7. Archive legacy tables for rollback visibility
ALTER TABLE super_admin RENAME TO legacy_super_admin;
ALTER TABLE page_auth RENAME TO legacy_page_auth;
ALTER TABLE page_meta RENAME TO legacy_page_meta;
ALTER TABLE page_stats RENAME TO legacy_page_stats;
ALTER TABLE slug_map RENAME TO legacy_slug_map;

COMMIT;
