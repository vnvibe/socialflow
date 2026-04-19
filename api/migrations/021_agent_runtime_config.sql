-- 021: Hermes-controlled agent runtime configuration.
--
-- Moves agent constants that previously lived hardcoded in the desktop
-- Wails build (rest windows, session max, timeouts, viewport) into the
-- admin's ai_settings row. The agent now pulls this JSON on boot + every
-- 5 minutes, so the user can tune Playwright behavior from the Hermes
-- settings UI without rebuilding the agent.

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS hermes_agent_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ai_settings.hermes_agent_config IS
  'Runtime knobs the agent fetches from GET /agent/config. Shape (all optional):
   { rest_min_minutes, rest_max_minutes, session_min_minutes, session_max_minutes,
     navigation_timeout_ms, action_timeout_ms, viewport_width, viewport_height,
     user_agent, default_language, enable_warmup_gate, warmup_join_block_days }';
