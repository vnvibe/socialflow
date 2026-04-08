-- =====================================================================
-- 012_campaign_groups_junction.sql
-- Phase 9: global group pool + per-campaign junction table.
--
-- fb_groups becomes a GLOBAL pool (one row per unique fb_group_id across
-- all nicks, conceptually). Per-campaign assignment + scoring + status
-- lives in the new campaign_groups junction. Nurture reads groups via the
-- junction so a single fb_groups row can be reused by multiple campaigns
-- with independent nicks.
-- =====================================================================

CREATE TABLE IF NOT EXISTS campaign_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  group_id UUID REFERENCES fb_groups(id) ON DELETE CASCADE,
  assigned_nick_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  score REAL DEFAULT 0,
  tier TEXT DEFAULT 'C' CHECK (tier IN ('A','B','C','D')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','removed')),
  added_at TIMESTAMPTZ DEFAULT now(),
  last_nurtured_at TIMESTAMPTZ,
  UNIQUE(campaign_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_groups_camp_status ON campaign_groups(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_groups_nick ON campaign_groups(assigned_nick_id, status);

ALTER TABLE campaign_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_groups_owner ON campaign_groups;
CREATE POLICY campaign_groups_owner ON campaign_groups
  USING (campaign_id IN (SELECT id FROM campaigns WHERE owner_id = auth.uid()));

-- Global evaluation fields on fb_groups (filled by scout Phase 2 deep eval)
ALTER TABLE fb_groups
  ADD COLUMN IF NOT EXISTS global_score REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evaluation_posts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS member_count_actual INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_per_day REAL DEFAULT 0;

-- Backfill: re-promote is_member from joined_at / success activity history.
-- Phase 8 had reset everything too aggressively.
UPDATE fb_groups SET is_member = true, pending_approval = false
WHERE joined_at IS NOT NULL;

WITH active_groups AS (
  SELECT DISTINCT fg.id
  FROM fb_groups fg
  JOIN campaign_activity_log cal
    ON (cal.details->>'group_fb_id' = fg.fb_group_id OR cal.target_id = fg.fb_group_id)
  WHERE cal.result_status = 'success'
    AND cal.action_type IN ('comment','like','visit_group','nurture_comment')
)
UPDATE fb_groups fg SET is_member = true, pending_approval = false
WHERE id IN (SELECT id FROM active_groups) AND is_member = false;

-- Backfill campaign_groups from existing joined_via_campaign_id mapping.
-- Skip rows whose campaign has been deleted (orphan fb_groups).
INSERT INTO campaign_groups (campaign_id, group_id, assigned_nick_id, score, tier, status, added_at)
SELECT
  fg.joined_via_campaign_id, fg.id, fg.account_id,
  COALESCE(fg.ai_join_score, 5),
  COALESCE(fg.score_tier, 'C'),
  CASE WHEN fg.is_member = true THEN 'active' ELSE 'paused' END,
  COALESCE(fg.created_at, now())
FROM fb_groups fg
WHERE fg.joined_via_campaign_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = fg.joined_via_campaign_id)
ON CONFLICT (campaign_id, group_id) DO NOTHING;
