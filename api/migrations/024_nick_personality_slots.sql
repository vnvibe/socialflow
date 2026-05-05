-- 024: Per-nick personality + daily slot scheduler.
--
-- Mục tiêu: Mỗi nick có 1 "tính cách" cố định (chronotype, action mix, độ
-- hung hăng) → mỗi đêm scheduler sinh 2-4 burst window cho ngày tới, sao
-- cho trên cùng 1 máy (agent_id) các nick KHÔNG bao giờ trùng giờ và
-- giữa 2 burst luôn có IP cool-down ≥10 phút. Pattern này cho FB thấy
-- "10 user khác nhau cùng share 1 IP nhà/văn phòng" thay vì cluster bot.
--
-- Workflow:
--   04:00 VN → cron gen slot cho NGÀY MAI
--   Agent boot → catch-up gen nếu hôm nay chưa có
--   Poller → GET /agent-jobs/active-slot → trả slot active hoặc null
--   Khi slot KPI met hoặc end_at passed → mark done, close session, đợi
--   slot kế tiếp.

-- ─── nick_personality ─────────────────────────────────────────────
-- 1 row/nick. Chỉ tạo khi user explicit setup hoặc lần đầu scheduler
-- chạy → fallback default.
CREATE TABLE IF NOT EXISTS nick_personality (
  account_id          UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  chronotype          TEXT NOT NULL DEFAULT 'spread'
    CHECK (chronotype IN ('morning', 'evening', 'night', 'spread')),
  preferred_windows   JSONB NOT NULL DEFAULT '[{"start_h":7,"end_h":11,"weight":1},{"start_h":13,"end_h":17,"weight":1},{"start_h":19,"end_h":22,"weight":1.2}]'::jsonb,
  bursts_per_day      SMALLINT NOT NULL DEFAULT 3 CHECK (bursts_per_day BETWEEN 1 AND 6),
  session_min_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (session_min_minutes >= 5),
  session_max_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (session_max_minutes >= 10),
  gap_min_minutes     SMALLINT NOT NULL DEFAULT 90  CHECK (gap_min_minutes >= 15),
  gap_max_minutes     SMALLINT NOT NULL DEFAULT 240 CHECK (gap_max_minutes >= 30),
  skip_day_chance     REAL NOT NULL DEFAULT 0.05 CHECK (skip_day_chance >= 0 AND skip_day_chance <= 0.5),
  daily_shift_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (daily_shift_minutes >= 0),
  action_mix          JSONB NOT NULL DEFAULT '{"react":0.5,"comment":0.25,"share":0.05,"scroll_only":0.2}'::jsonb,
  budget_volatility   REAL NOT NULL DEFAULT 1.0 CHECK (budget_volatility > 0 AND budget_volatility <= 2),
  preset_name         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE nick_personality IS
  'Per-nick cadence/behavior config. Used by slot scheduler to gen daily bursts.';
COMMENT ON COLUMN nick_personality.preferred_windows IS
  'Array of {start_h, end_h, weight} in VN timezone. Burst start time picked weighted-random within these.';
COMMENT ON COLUMN nick_personality.daily_shift_minutes IS
  'Random ±N min global offset applied per-day so same nick is not at same clock time daily.';
COMMENT ON COLUMN nick_personality.budget_volatility IS
  'Multiplier applied to daily target each day (e.g. 0.7 → 70% of target, 1.3 → 130%). Adds organic up/down.';

-- ─── nick_slots ───────────────────────────────────────────────────
-- N rows/nick/day. Re-generated nightly per (account_id, date).
CREATE TABLE IF NOT EXISTS nick_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id        TEXT,                         -- snapshot of profiles.preferred_executor_id at gen time (NULL → any agent)
  date            DATE NOT NULL,                -- VN date
  slot_index      SMALLINT NOT NULL,
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  target_actions  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {react: 4, comment: 2}
  done_actions    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {react: 4, comment: 1}
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'done', 'skipped', 'expired')),
  done_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nick_slots_unique_idx UNIQUE (account_id, date, slot_index),
  CONSTRAINT nick_slots_time_order CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_nick_slots_lookup
  ON nick_slots (agent_id, date, start_at);
CREATE INDEX IF NOT EXISTS idx_nick_slots_active
  ON nick_slots (account_id, status, start_at, end_at)
  WHERE status IN ('pending', 'active');

COMMENT ON TABLE nick_slots IS
  'Per-nick burst windows for a given VN date. One day = N slots (typically 2-4). Active when now() ∈ [start_at, end_at] AND status=pending|active.';
COMMENT ON COLUMN nick_slots.target_actions IS
  'Action quota for this slot. Poller skips job whose action type already done >= target in current slot.';
COMMENT ON COLUMN nick_slots.done_actions IS
  'Incremented by agent on each completed action. Reaching target → status=done early, close browser, wait next slot.';
