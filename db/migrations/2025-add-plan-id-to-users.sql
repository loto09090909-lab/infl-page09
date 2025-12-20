-- Migration: add plan_id to users table (legacy fix)
BEGIN TRANSACTION;

ALTER TABLE users ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'free';

COMMIT;
