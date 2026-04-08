-- =====================================================================
-- 010_fb_groups_membership.sql
-- Track real membership status on fb_groups so nurture only acts on
-- groups the nick has been ADMITTED into (not pending approval).
-- =====================================================================

ALTER TABLE fb_groups
  ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;

-- Backfill: any existing fb_groups row is presumed to be a real member
-- (they would not be in the table otherwise — discover already gated by
-- a successful join click). Without this backfill, nurture would suddenly
-- have 0 eligible groups for every existing campaign.
-- Force-promote: COALESCE doesn't work because the new column has DEFAULT false
-- (not NULL), so existing rows are 'false' on first read, not NULL.
UPDATE fb_groups
SET
  is_member = true,
  pending_approval = false,
  joined_at = COALESCE(joined_at, created_at, now())
WHERE is_member = false;

-- Hot path index: nurture queries `is_member = true AND pending_approval = false`.
CREATE INDEX IF NOT EXISTS idx_fb_groups_member_status
  ON fb_groups(account_id, is_member, pending_approval)
  WHERE is_member = true AND pending_approval = false;
