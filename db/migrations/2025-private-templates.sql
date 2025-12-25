-- Migration: add private_templates table
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS private_templates (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES page_meta(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_templates_page ON private_templates(page_id);

COMMIT;
