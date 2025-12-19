PRAGMA foreign_keys = ON;

-- =========================
-- super_admins (운영 전용)
-- =========================
CREATE TABLE IF NOT EXISTS super_admins (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

-- =========================
-- users
--  - locked_until: epoch seconds(정수) 추천
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  oauth_provider TEXT,
  oauth_id TEXT,
  plan_id TEXT NOT NULL DEFAULT 'free',

  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER, -- epoch seconds

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id);

-- =========================
-- page_meta (페이지 메타)
--  - links는 JSON 문자열 권장
--  - plan_id를 여기에 두면(추천) "페이지 단위 요금제 제한" 적용이 쉬움
-- =========================
CREATE TABLE IF NOT EXISTS page_meta (
  page_id TEXT PRIMARY KEY,
  name TEXT,
  photo_url TEXT,
  description TEXT,
  links TEXT, -- JSON string

  plan_id TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_page_meta_plan ON page_meta(plan_id);

-- =========================
-- page_admins
--  - 기존: page_id PK = 1페이지 1관리자만 가능
--  - 운영상 공동관리 필요해질 가능성이 높아 (page_id, user_id) 복합 PK로 보강 권장
-- =========================
CREATE TABLE IF NOT EXISTS page_admins (
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, user_id),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_admins_user ON page_admins(user_id);

-- =========================
-- page_members (권한 고도화)
-- =========================
CREATE TABLE IF NOT EXISTS page_members (
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, user_id),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_members_user ON page_members(user_id);

-- =========================
-- page_invites
-- =========================
CREATE TABLE IF NOT EXISTS page_invites (
  token TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_by TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_invites_page ON page_invites(page_id);

-- =========================
-- audit_logs
-- =========================
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_page ON audit_logs(page_id);

-- =========================
-- private_links
-- =========================
CREATE TABLE IF NOT EXISTS private_links (
  page_id TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','expired','usedup','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  last_used_at TEXT,
  note TEXT,
  PRIMARY KEY (page_id, token),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_links_page ON private_links(page_id);

-- =========================
-- slug_map
--  - display_name은 실질적으로 slug 역할(유니크)
-- =========================
CREATE TABLE IF NOT EXISTS slug_map (
  display_name TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slug_map_page ON slug_map(page_id);

-- =========================
-- page_stats (일별 통계)
--  - revenue는 정밀도 문제로 REAL보다 "정수 cents"가 안전(추천)
-- =========================
CREATE TABLE IF NOT EXISTS page_stats (
  page_id TEXT NOT NULL,
  day TEXT NOT NULL, -- 'YYYY-MM-DD'
  views INTEGER NOT NULL DEFAULT 0,
  admin_views INTEGER NOT NULL DEFAULT 0,

  revenue_cents INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (page_id, day),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_stats_day ON page_stats(day);

-- =========================
-- plan_limits
-- =========================
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_id TEXT PRIMARY KEY,
  can_create_pages INTEGER NOT NULL DEFAULT 1 CHECK (can_create_pages IN (0,1)),
  can_change_slug INTEGER NOT NULL DEFAULT 1 CHECK (can_change_slug IN (0,1)),
  can_create_private_links INTEGER NOT NULL DEFAULT 1 CHECK (can_create_private_links IN (0,1)),
  max_pages INTEGER NOT NULL DEFAULT 1,
  max_private_links INTEGER NOT NULL DEFAULT 5,
  max_contact_fields INTEGER NOT NULL DEFAULT 10,
  can_export_csv INTEGER NOT NULL DEFAULT 1 CHECK (can_export_csv IN (0,1)),
  stats_retention_days INTEGER NOT NULL DEFAULT 30
);

-- 기본값 시드(원하는 값으로 조정)
INSERT OR IGNORE INTO plan_limits(plan_id, can_create_pages, can_change_slug, can_create_private_links, max_pages, max_private_links, max_contact_fields, can_export_csv, stats_retention_days)
VALUES
('free',    1, 0, 0, 1, 3, 5, 0, 7),
('basic',   1, 1, 1, 3, 10, 15, 1, 30),
('premium', 1, 1, 1, 10, 50, 50, 1, 365);
