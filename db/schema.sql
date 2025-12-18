CREATE TABLE IF NOT EXISTS super_admins (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_admins (
  page_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL
);

-- users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  oauth_provider TEXT,
  oauth_id TEXT,
  failed_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- page_stats
CREATE TABLE IF NOT EXISTS page_stats (
  page_id TEXT,
  day TEXT,
  views INTEGER DEFAULT 0,
  admin_views INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  PRIMARY KEY (page_id, day)
);

-- page_meta
CREATE TABLE IF NOT EXISTS page_meta (
  page_id TEXT PRIMARY KEY,
  name TEXT,
  photo_url TEXT,
  description TEXT,
  links TEXT
);

-- slug_map
CREATE TABLE IF NOT EXISTS slug_map (
  display_name TEXT PRIMARY KEY,
  page_id TEXT
);

-- plan_limits
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_id TEXT PRIMARY KEY,
  can_create_pages INTEGER DEFAULT 1,
  can_change_slug INTEGER DEFAULT 1,
  can_create_private_links INTEGER DEFAULT 1
);
