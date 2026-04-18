-- Migration: per-nick per-day job creation quota.
-- Motivation: agent drains ~60 jobs/day max (3 nicks × 2 slots × 25-45min session + 45-120min rest).
-- Schedulers create 900-2000+ jobs/day if unchecked. This table caps creation before INSERT.
-- Observed: 238 pending accumulated in 22h; Diệu Hiền alone had 117.
--
-- Lifecycle:
--   - Row created on first job insert for (account, type, date) via UPSERT.
--   - created_count incremented atomically.
--   - When created_count >= quota → scheduler logs "[QUOTA] ... full" and skips.
--   - Daily cleanup (nurture-scheduler.js cron 0 0 * * *) deletes rows older than 7 days.

CREATE TABLE IF NOT EXISTS nick_daily_job_quota (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  created_count INTEGER NOT NULL DEFAULT 0,
  quota         INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, job_type, date)
);

CREATE INDEX IF NOT EXISTS idx_njq_lookup
  ON nick_daily_job_quota (account_id, job_type, date);

CREATE INDEX IF NOT EXISTS idx_njq_purge
  ON nick_daily_job_quota (date);

COMMENT ON TABLE nick_daily_job_quota IS
  'Per-nick per-day job CREATION quota. Schedulers check + atomically increment
   before INSERT INTO jobs. One row per (account_id, job_type, date).';
