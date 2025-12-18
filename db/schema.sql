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

  private_views INTEGER NOT NULL DEFAULT 0,
  contact_submissions INTEGER NOT NULL DEFAULT 0,

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
  max_contact_fields INTEGER NOT NULL DEFAULT 0 CHECK (max_contact_fields >= 0)
);

-- 기본값 시드(원하는 값으로 조정)
INSERT OR IGNORE INTO plan_limits(plan_id, can_create_pages, can_change_slug, can_create_private_links, max_contact_fields)
VALUES
('free',    1, 0, 0, 2),
('basic',   1, 1, 1, 5),
('premium', 1, 1, 1, 20);

-- =========================
-- private_links (프라이빗/난수형 링크)
--  - max_views와 remaining_views로 n회 제한 구현
--  - expire_at ISO8601, access_code_hash로 입장 코드 보호
-- =========================
CREATE TABLE IF NOT EXISTS private_links (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  max_views INTEGER,
  remaining_views INTEGER,
  expire_at TEXT,
  access_code_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_links_page ON private_links(page_id);

-- =========================
-- contact_forms (컨택트 폼 스키마)
-- =========================
CREATE TABLE IF NOT EXISTS contact_forms (
  page_id TEXT PRIMARY KEY,
  schema_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

-- =========================
-- contact_submissions (컨택트 폼 제출 기록)
-- =========================
CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  private_link_id TEXT,
  payload_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (private_link_id) REFERENCES private_links(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_page ON contact_submissions(page_id);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_private ON contact_submissions(private_link_id);
