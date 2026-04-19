-- 019: Hermes-central refactor
--   • ai_settings.task_models: per-skill provider+model override (JSONB map).
--     Example: {"relevance_review": {"provider":"hermes","model":"deepseek-chat"},
--               "comment_gen":      {"provider":"hermes","model":"gpt-4o-mini"}}
--     Orchestrator.call() looks up by function name and falls back to defaults.
--   • campaigns.hermes_central: when TRUE, the raw schedulers
--     (campaign-scheduler / nurture-scheduler) skip this campaign; only the
--     Hermes orchestrator creates jobs for it, so a single loop owns pacing,
--     dedup, and KPI balance per campaign.

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS task_models JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS hermes_central BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_settings.task_models IS
  'Per-task (function_name) provider+model override. Shape: { function_name: { provider, model } }.';
COMMENT ON COLUMN campaigns.hermes_central IS
  'When TRUE, only the Hermes orchestrator creates jobs for this campaign — raw schedulers skip.';
