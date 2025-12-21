-- SQLite 외래 키 제약 조건 활성화
PRAGMA foreign_keys = ON;

-- ==========================================
-- 0. 초기화: 기존의 모든 테이블 삭제 (삭제 순서 중요)
-- ==========================================
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plan_limits;
DROP TABLE IF EXISTS page_members;
DROP TABLE IF EXISTS page_admins;
DROP TABLE IF EXISTS page_meta;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS super_admins;

-- ==========================================
-- 1. super_admins
-- ==========================================
CREATE TABLE super_admins (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

-- ==========================================
-- 2. users
-- ==========================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  oauth_provider TEXT,
  oauth_id TEXT,
  plan_id TEXT NOT NULL DEFAULT 'free',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER, 
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_oauth ON users(oauth_provider, oauth_id);

-- ==========================================
-- 3. page_meta
-- ==========================================
CREATE TABLE page_meta (
  page_id TEXT PRIMARY KEY,
  name TEXT,
  photo_url TEXT,
  description TEXT,
  links TEXT, 
  plan_id TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_page_meta_plan ON page_meta(plan_id);

-- ==========================================
-- 4. page_admins (수정됨: user_id 추가)
-- ==========================================
CREATE TABLE page_admins (
  page_id TEXT NOT NULL,
  user_id TEXT, -- 이 컬럼이 누락되어 에러가 발생했습니다.
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);
-- ==========================================
-- 5. page_members
-- ==========================================
CREATE TABLE page_members (
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, user_id),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==========================================
-- 6. plan_limits (에러 발생했던 테이블)
-- ==========================================
CREATE TABLE plan_limits (
  plan_id TEXT PRIMARY KEY,
  can_create_pages INTEGER NOT NULL DEFAULT 1 CHECK (can_create_pages IN (0,1)),
  can_change_slug INTEGER NOT NULL DEFAULT 0 CHECK (can_change_slug IN (0,1)),
  can_create_private_links INTEGER NOT NULL DEFAULT 0 CHECK (can_create_private_links IN (0,1)),
  max_pages INTEGER NOT NULL DEFAULT 1,
  max_private_links INTEGER NOT NULL DEFAULT 5,
  max_contact_fields INTEGER NOT NULL DEFAULT 10,
  can_export_csv INTEGER NOT NULL DEFAULT 1 CHECK (can_export_csv IN (0,1)),
  stats_retention_days INTEGER NOT NULL DEFAULT 30
);

-- 요금제 기본 데이터 삽입
INSERT INTO plan_limits(plan_id, can_create_pages, can_change_slug, can_create_private_links, max_pages, max_private_links, max_contact_fields, can_export_csv, stats_retention_days)
VALUES
('free',    1, 0, 0, 1, 3, 5, 0, 7),
('basic',   1, 1, 1, 3, 10, 15, 1, 30),
('premium', 1, 1, 1, 10, 50, 50, 1, 365);

-- ==========================================
-- 7. subscriptions
-- ==========================================
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid')),
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plan_limits(plan_id)
);
