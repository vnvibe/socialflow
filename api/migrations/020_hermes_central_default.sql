-- 020: Make Hermes-central the default for all campaigns.
--
-- Phase 2 of the streamline refactor: the dumb 1-min / 2h / 4h / 6h cron
-- paths are now superseded by the orchestrator tick for any campaign with
-- hermes_central=true. This flips the default so new campaigns get the
-- unified behavior, and back-fills existing running campaigns so the user
-- doesn't have to toggle each one by hand.
--
-- Safe to re-run: DEFAULT change is idempotent, UPDATE only touches rows
-- that are still on the legacy path.

ALTER TABLE campaigns
  ALTER COLUMN hermes_central SET DEFAULT TRUE;

UPDATE campaigns
SET hermes_central = TRUE
WHERE hermes_central = FALSE
  AND status IN ('running', 'active');
