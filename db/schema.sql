-- normalized page management schema (v2)

-- pages: primary entity replacing legacy page_meta
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

-- page_slugs: supports primary/secondary slugs for each page (replaces slug_map)
CREATE TABLE IF NOT EXISTS page_slugs (
  slug TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

-- admins: consolidates super_admin and page_auth
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

-- daily rollups (replaces page_stats)
CREATE TABLE IF NOT EXISTS page_stats_daily (
  page_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  admin_views INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, day),
  FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE
);

-- hourly rollups (optional granularity)
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

-- indexes and constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_slugs_primary ON page_slugs(page_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_page_slugs_page_id ON page_slugs(page_id);
CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at);
CREATE INDEX IF NOT EXISTS idx_page_stats_daily_day ON page_stats_daily(day);
CREATE INDEX IF NOT EXISTS idx_page_stats_hourly_day_hour ON page_stats_hourly(day, hour);
CREATE INDEX IF NOT EXISTS idx_admins_page_id ON admins(page_id);
