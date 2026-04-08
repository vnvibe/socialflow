-- =====================================================================
-- 013_kpi_system.sql
-- Phase 11: KPI targets per campaign + per-nick daily progress tracking,
-- with auto-rebalance triggers and an increment_kpi RPC.
-- =====================================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS kpi_config JSONB DEFAULT
    '{"daily_likes": 60, "daily_comments": 15, "daily_friend_requests": 10, "daily_group_joins": 9}'::jsonb;

CREATE TABLE IF NOT EXISTS nick_kpi_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  target_likes INT DEFAULT 0,
  target_comments INT DEFAULT 0,
  target_friend_requests INT DEFAULT 0,
  target_group_joins INT DEFAULT 0,
  done_likes INT DEFAULT 0,
  done_comments INT DEFAULT 0,
  done_friend_requests INT DEFAULT 0,
  done_group_joins INT DEFAULT 0,
  kpi_met BOOLEAN DEFAULT false,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_nick_kpi ON nick_kpi_daily(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_nick_kpi_account_date ON nick_kpi_daily(account_id, date);

ALTER TABLE nick_kpi_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nick_kpi_daily_owner ON nick_kpi_daily;
CREATE POLICY nick_kpi_daily_owner ON nick_kpi_daily
  USING (campaign_id IN (SELECT id FROM campaigns WHERE owner_id = auth.uid()));

-- RPC: atomic increment + kpi_met recompute. Called from agent activity logger.
CREATE OR REPLACE FUNCTION increment_kpi(
  p_campaign_id UUID,
  p_account_id UUID,
  p_date DATE,
  p_field TEXT,
  p_delta INT DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO nick_kpi_daily (campaign_id, account_id, date)
  VALUES (p_campaign_id, p_account_id, p_date)
  ON CONFLICT (campaign_id, account_id, date) DO NOTHING;

  EXECUTE format(
    'UPDATE nick_kpi_daily SET %I = COALESCE(%I, 0) + $1, last_updated_at = now() WHERE campaign_id = $2 AND account_id = $3 AND date = $4',
    p_field, p_field
  ) USING p_delta, p_campaign_id, p_account_id, p_date;

  UPDATE nick_kpi_daily SET kpi_met = (
    (target_likes = 0 OR done_likes >= target_likes) AND
    (target_comments = 0 OR done_comments >= target_comments) AND
    (target_friend_requests = 0 OR done_friend_requests >= target_friend_requests) AND
    (target_group_joins = 0 OR done_group_joins >= target_group_joins)
  )
  WHERE campaign_id = p_campaign_id AND account_id = p_account_id AND date = p_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
