-- 022: Daily campaign reports
--
-- Stores one row per (campaign, date) with structured KPI totals + an
-- optional LLM-written narrative. Dashboard + campaign hub read from
-- here instead of re-aggregating on every page load.
--
-- The stats JSONB is always populated (pure SQL aggregation, no LLM
-- needed). narrative_text is nullable — populated only when the Hermes
-- reporter skill succeeds. If the LLM is blocked (billing, timeout,
-- bad fallback), the row still exists with structured data.

CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  owner_id UUID,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative_text TEXT,
  narrative_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_campaign_date
  ON daily_reports (campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_owner_date
  ON daily_reports (owner_id, date DESC);

COMMENT ON TABLE daily_reports IS
  'One row per (campaign, date). Dashboard + campaign hub read from here. Regenerated each evening at 22:00 VN by the daily-report cron.';
