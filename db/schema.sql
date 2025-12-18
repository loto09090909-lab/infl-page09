-- super_admin
CREATE TABLE IF NOT EXISTS super_admin (
  password_hash TEXT NOT NULL
);

-- page_auth
CREATE TABLE IF NOT EXISTS page_auth (
  page_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
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

-- pages
CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL
);

-- page_admins
CREATE TABLE IF NOT EXISTS page_admins (
  page_id TEXT,
  user_id TEXT,
  role TEXT CHECK(role IN ('owner', 'admin')),
  PRIMARY KEY (page_id, user_id)
);
