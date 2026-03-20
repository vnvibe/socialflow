-- Migration: Monitor & Engagement Tracking Tables
-- Run this on Supabase SQL Editor

-- ============================================
-- Table 1: scan_keywords
-- ============================================
CREATE TABLE IF NOT EXISTS scan_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  keyword TEXT NOT NULL,
  scan_type TEXT NOT NULL DEFAULT 'group_posts',  -- 'group_posts' | 'discover_groups'
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  target_group_ids UUID[],                        -- NULL = scan all joined groups
  cron_expression TEXT DEFAULT '0 */6 * * *',     -- default every 6h
  time_window_hours INT DEFAULT 24,
  is_active BOOLEAN DEFAULT true,
  last_scan_at TIMESTAMPTZ,
  next_scan_at TIMESTAMPTZ,
  total_scans INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Table 2: discovered_posts
-- ============================================
CREATE TABLE IF NOT EXISTS discovered_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  keyword_id UUID REFERENCES scan_keywords(id) ON DELETE CASCADE,
  fb_post_id TEXT,
  fb_group_id TEXT,
  group_name TEXT,
  author_name TEXT,
  author_fb_id TEXT,
  content_text TEXT,
  post_url TEXT,
  reactions INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  posted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  is_following BOOLEAN DEFAULT false,
  UNIQUE(owner_id, fb_post_id)
);

-- ============================================
-- Table 3: discovered_groups
-- ============================================
CREATE TABLE IF NOT EXISTS discovered_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  keyword_id UUID REFERENCES scan_keywords(id) ON DELETE CASCADE,
  fb_group_id TEXT NOT NULL,
  name TEXT,
  member_count INT,
  group_type TEXT,
  url TEXT,
  description TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  is_joined BOOLEAN DEFAULT false,
  UNIQUE(owner_id, fb_group_id)
);

-- ============================================
-- Table 4: engagement_snapshots
-- ============================================
CREATE TABLE IF NOT EXISTS engagement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  source_type TEXT NOT NULL,    -- 'own_post' | 'discovered_post'
  source_id UUID,               -- publish_history.id or discovered_posts.id
  fb_post_id TEXT,
  reactions INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_scan_keywords_owner ON scan_keywords(owner_id);
CREATE INDEX IF NOT EXISTS idx_scan_keywords_active ON scan_keywords(is_active, next_scan_at);
CREATE INDEX IF NOT EXISTS idx_discovered_posts_owner ON discovered_posts(owner_id);
CREATE INDEX IF NOT EXISTS idx_discovered_posts_keyword ON discovered_posts(keyword_id);
CREATE INDEX IF NOT EXISTS idx_discovered_posts_group ON discovered_posts(fb_group_id);
CREATE INDEX IF NOT EXISTS idx_discovered_posts_following ON discovered_posts(owner_id, is_following) WHERE is_following = true;
CREATE INDEX IF NOT EXISTS idx_discovered_groups_owner ON discovered_groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_discovered_groups_keyword ON discovered_groups(keyword_id);
CREATE INDEX IF NOT EXISTS idx_engagement_snapshots_owner ON engagement_snapshots(owner_id);
CREATE INDEX IF NOT EXISTS idx_engagement_snapshots_source ON engagement_snapshots(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_engagement_snapshots_post ON engagement_snapshots(fb_post_id);

-- ============================================
-- RLS Policies
-- ============================================

-- scan_keywords
ALTER TABLE scan_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_keywords_self_read" ON scan_keywords FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "scan_keywords_self_insert" ON scan_keywords FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "scan_keywords_self_update" ON scan_keywords FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "scan_keywords_self_delete" ON scan_keywords FOR DELETE USING (auth.uid() = owner_id);

-- discovered_posts
ALTER TABLE discovered_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discovered_posts_self_read" ON discovered_posts FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "discovered_posts_self_insert" ON discovered_posts FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "discovered_posts_self_update" ON discovered_posts FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "discovered_posts_self_delete" ON discovered_posts FOR DELETE USING (auth.uid() = owner_id);

-- discovered_groups
ALTER TABLE discovered_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discovered_groups_self_read" ON discovered_groups FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "discovered_groups_self_insert" ON discovered_groups FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "discovered_groups_self_update" ON discovered_groups FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "discovered_groups_self_delete" ON discovered_groups FOR DELETE USING (auth.uid() = owner_id);

-- engagement_snapshots
ALTER TABLE engagement_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "engagement_snapshots_self_read" ON engagement_snapshots FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "engagement_snapshots_self_insert" ON engagement_snapshots FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "engagement_snapshots_self_update" ON engagement_snapshots FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "engagement_snapshots_self_delete" ON engagement_snapshots FOR DELETE USING (auth.uid() = owner_id);

-- ============================================
-- Service role bypass (for API server)
-- ============================================
-- The API server uses service_role key which bypasses RLS automatically
