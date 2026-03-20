-- 007_websites.sql
-- Websites table: stores user-added websites with Google Analytics & Search Console integration

CREATE TABLE IF NOT EXISTS websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,

  -- Google OAuth credentials
  google_email TEXT,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry TIMESTAMPTZ,

  -- Google Analytics 4
  ga_property_id TEXT,      -- e.g. "properties/123456789"
  ga_property_name TEXT,    -- e.g. "My Website - GA4"

  -- Google Search Console
  gsc_site_url TEXT,        -- e.g. "https://example.com/"

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE websites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "websites_self_read"   ON websites FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "websites_self_insert" ON websites FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "websites_self_update" ON websites FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "websites_self_delete" ON websites FOR DELETE USING (owner_id = auth.uid());
