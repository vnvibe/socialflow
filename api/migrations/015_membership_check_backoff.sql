-- 015_membership_check_backoff.sql
ALTER TABLE fb_groups ADD COLUMN IF NOT EXISTS membership_check_attempts INT DEFAULT 0;
ALTER TABLE fb_groups ADD COLUMN IF NOT EXISTS membership_last_checked_at TIMESTAMPTZ;
