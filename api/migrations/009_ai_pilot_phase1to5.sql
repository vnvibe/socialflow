-- =====================================================================
-- 009_ai_pilot_phase1to5.sql
-- Schema changes for AI Pilot Phases 1-5:
--   1. Language filter (campaigns.language)
--   2. Group scoring (fb_groups score_tier, engagement_rate, ...)
--   3. Shared post pool (shared_posts table) + swarm
--   4. Ads tab (no schema — uses shared_posts.is_ad_opportunity)
--   5. Strategy brain (uses existing ai_pilot_memory + campaigns.config)
-- All operations idempotent (IF NOT EXISTS).
-- =====================================================================

-- ── PHASE 1 ──────────────────────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'vi'
    CHECK (language IN ('vi', 'en', 'mixed'));

-- Phase 5 uses campaigns.config jsonb (best_hours etc.)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

-- ── PHASE 2 ──────────────────────────────────────────────────────────
ALTER TABLE fb_groups
  ADD COLUMN IF NOT EXISTS score_tier TEXT DEFAULT 'C'
    CHECK (score_tier IN ('A','B','C','D')),
  ADD COLUMN IF NOT EXISTS engagement_rate REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'vi',
  ADD COLUMN IF NOT EXISTS last_scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_interactions INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_skips INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_yield_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fb_groups_score_tier ON fb_groups(score_tier);
CREATE INDEX IF NOT EXISTS idx_fb_groups_language ON fb_groups(language);

-- ── PHASE 3 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  group_fb_id TEXT NOT NULL,
  post_fb_id TEXT NOT NULL UNIQUE,
  post_content TEXT,
  post_url TEXT,
  post_author TEXT,
  reactions INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  engagement_score REAL DEFAULT 0,
  ai_score INT,
  ai_reason TEXT,
  is_ad_opportunity BOOLEAN DEFAULT false,
  ad_reason TEXT,
  comment_angle TEXT,
  language TEXT DEFAULT 'vi',
  is_ad_post BOOLEAN DEFAULT false,
  swarm_target INT DEFAULT 1,
  swarm_count INT DEFAULT 0,
  swarm_account_ids UUID[] DEFAULT '{}',
  swarm_comments TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','expired','skipped')),
  detected_at TIMESTAMPTZ DEFAULT now(),
  -- Note: not GENERATED — Postgres requires immutable expressions, INTERVAL is not.
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '8 hours')
);

CREATE INDEX IF NOT EXISTS idx_shared_posts_campaign_status
  ON shared_posts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_shared_posts_pending_expires
  ON shared_posts(status, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_shared_posts_ad_opp
  ON shared_posts(campaign_id, is_ad_opportunity) WHERE is_ad_opportunity = true;

-- RLS: align with other tables (owner via campaigns.owner_id)
ALTER TABLE shared_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_posts_owner ON shared_posts;
CREATE POLICY shared_posts_owner ON shared_posts
  USING (campaign_id IN (SELECT id FROM campaigns WHERE owner_id = auth.uid()));
