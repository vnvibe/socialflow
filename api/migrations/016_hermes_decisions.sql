-- Migration: Hermes decision log
-- Every orchestration run writes one row per action proposed (auto-applied or pending user approval).
-- Drives the "Quyết định của Hermes" UI tab and gives a replayable audit trail.

CREATE TABLE IF NOT EXISTS hermes_decisions (
  id SERIAL PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  orchestration_id UUID,                     -- groups all actions from one run; set by service
  decision_type TEXT NOT NULL,               -- 'orchestration' | 'group_eval' | 'job_assign' | 'skip_group' | 'alert_user' | 'reporter'
  action_type TEXT,                          -- for orchestration: assign_job, skip_group, recheck_group, reassign_nick, pause_nick, alert_user
  target_id TEXT,                            -- uuid of nick/group/job (stored as text because it can reference multiple tables)
  target_name TEXT,
  priority TEXT,                             -- critical | high | medium | low
  reason TEXT,
  context_summary TEXT,                      -- short text summary of input context
  decision JSONB NOT NULL,                   -- full action object from Hermes
  auto_apply BOOLEAN NOT NULL DEFAULT false,
  auto_applied BOOLEAN NOT NULL DEFAULT false, -- whether we actually executed it
  applied_at TIMESTAMPTZ,
  outcome TEXT,                              -- 'success' | 'failed' | 'pending' | 'user_approved' | 'user_rejected'
  outcome_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hermes_decisions_campaign  ON hermes_decisions (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_decisions_orch      ON hermes_decisions (orchestration_id);
CREATE INDEX IF NOT EXISTS idx_hermes_decisions_outcome   ON hermes_decisions (outcome) WHERE outcome IS NULL OR outcome = 'pending';

COMMENT ON TABLE hermes_decisions IS
  'Audit log + pending-recommendation queue for the Hermes orchestrator cron. One row per action emitted by the orchestrator skill.';
