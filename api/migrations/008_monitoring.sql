-- Migration: Facebook Page/Group Monitoring Tables

-- ============================================
-- Table 1: monitored_sources
-- ============================================
CREATE TABLE IF NOT EXISTS monitored_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  source_type TEXT NOT NULL DEFAULT 'page',  -- 'page' | 'group'
  fb_source_id TEXT NOT NULL,
  name TEXT,
  url TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  fetch_interval_minutes INT DEFAULT 60,
  last_fetched_at TIMESTAMPTZ,
  next_fetch_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, fb_source_id)
);

-- ============================================
-- Table 2: monitored_posts
-- ============================================
CREATE TABLE IF NOT EXISTS monitored_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  source_id UUID REFERENCES monitored_sources(id) ON DELETE CASCADE,
  fb_post_id TEXT,
  author_name TEXT,
  author_fb_id TEXT,
  content_text TEXT,
  post_url TEXT,
  image_url TEXT,
  reactions INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  posted_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, fb_post_id)
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_monitored_sources_owner ON monitored_sources(owner_id);
CREATE INDEX IF NOT EXISTS idx_monitored_sources_active ON monitored_sources(is_active, next_fetch_at);
CREATE INDEX IF NOT EXISTS idx_monitored_posts_owner ON monitored_posts(owner_id);
CREATE INDEX IF NOT EXISTS idx_monitored_posts_source ON monitored_posts(source_id);
CREATE INDEX IF NOT EXISTS idx_monitored_posts_fetched ON monitored_posts(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitored_posts_fb_post ON monitored_posts(owner_id, fb_post_id);

-- ============================================
-- RLS Policies
-- ============================================

-- monitored_sources
ALTER TABLE monitored_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "monitored_sources_self_read" ON monitored_sources FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "monitored_sources_self_insert" ON monitored_sources FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "monitored_sources_self_update" ON monitored_sources FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "monitored_sources_self_delete" ON monitored_sources FOR DELETE USING (auth.uid() = owner_id);

-- monitored_posts
ALTER TABLE monitored_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "monitored_posts_self_read" ON monitored_posts FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "monitored_posts_self_insert" ON monitored_posts FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "monitored_posts_self_update" ON monitored_posts FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "monitored_posts_self_delete" ON monitored_posts FOR DELETE USING (auth.uid() = owner_id);
