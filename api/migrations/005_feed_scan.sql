-- 005_feed_scan.sql
-- Add AI relevance columns to discovered_posts for group feed scanning

ALTER TABLE discovered_posts ADD COLUMN IF NOT EXISTS relevance_score smallint;
ALTER TABLE discovered_posts ADD COLUMN IF NOT EXISTS ai_summary text;

-- Add topics column to scan_keywords for group_feed scan type
ALTER TABLE scan_keywords ADD COLUMN IF NOT EXISTS topics text[];

COMMENT ON COLUMN discovered_posts.relevance_score IS 'AI relevance score 1-5, NULL if not AI-reviewed';
COMMENT ON COLUMN discovered_posts.ai_summary IS 'AI-generated summary explaining relevance';
COMMENT ON COLUMN scan_keywords.topics IS 'Topics for AI relevance review (group_feed scan type)';
