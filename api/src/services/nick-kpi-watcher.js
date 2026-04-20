// Nick KPI Watcher — enforces daily KPI per nick per campaign.
//
// User asked: Hermes phải đảm bảo nick hoàn thành KPI trong ngày, nếu
// thiếu thì xem nguyên nhân + đề xuất kế hoạch; nếu nick liên tục đạt
// thì nâng KPI cho phù hợp năng lực.
//
// This runs as a 30-min cron. For each active nick with a KPI for today:
//   1. Compute expected_by_now = target * (hours_since_active_start / active_window)
//   2. Compute shortfall = expected_by_now - done
//   3. If shortfall > 20% → diagnose cause from:
//        - recent job_failures (errors / checkpoint risk)
//        - last_used_at + rest gates (nick idle too long)
//        - daily_budget hit (capped out)
//        - warmup block (age < 14d)
//   4. Insert a hermes_decisions row with diagnosis + proposed action
//      (auto_apply=true for idle-nick-no-risk; auto_apply=false for
//      anything needing user judgment)
//   5. If nick has ≥5 consecutive days of hitting target with healthy
//      signals, bump target +20% (up to a safety cap)
//
// Pure Node + SQL — no LLM call, so it works even when the orchestrator
// is blocked on billing/quota issues.

// supabase injected by caller (server.js / cron) to share the pool

const SHORTFALL_THRESHOLD_PCT = 20      // shortfall % that triggers a decision
const CAPABILITY_STREAK_DAYS = 5        // consecutive days hitting target to auto-bump
const CAPABILITY_BUMP_PCT = 20          // % to bump target when capable
const ACTIVE_WINDOW_HOURS = 14          // 8am-22pm VN, matches typical account hours
const ACTIVE_WINDOW_START = 8           // hour-of-day (VN) activity window starts

function vnHour() {
  const d = new Date(Date.now() + 7 * 3600 * 1000)
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

function vnToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

async function diagnose(pool, accountId, campaignId) {
  // Look back 24h for error signals
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  const { rows: failureRows } = await pool.query(
    `SELECT error_type, COUNT(*)::int AS c
     FROM job_failures
     WHERE account_id = $1 AND created_at > $2
     GROUP BY error_type ORDER BY c DESC`,
    [accountId, since]
  )
  const failures = Object.fromEntries(failureRows.map(r => [r.error_type, r.c]))
  const totalFailures = failureRows.reduce((s, r) => s + r.c, 0)

  // Last activity timestamp
  const { rows: lastRows } = await pool.query(
    `SELECT MAX(finished_at) AS last FROM jobs WHERE payload->>'account_id' = $1 AND status IN ('done','failed')`,
    [accountId]
  )
  const lastAt = lastRows[0]?.last ? new Date(lastRows[0].last) : null
  const idleMinutes = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 60000) : 999

  // Account state
  const { rows: accRows } = await pool.query(
    `SELECT status, is_active, daily_budget, fb_created_at, created_at FROM accounts WHERE id = $1`,
    [accountId]
  )
  const acc = accRows[0]
  if (!acc) return null

  const ageDays = acc.fb_created_at || acc.created_at
    ? Math.floor((Date.now() - new Date(acc.fb_created_at || acc.created_at).getTime()) / 86400000)
    : 0

  const budget = acc.daily_budget || {}
  const budgetExhausted = Object.entries(budget).some(([k, v]) =>
    v && typeof v === 'object' && v.used >= (v.max || 0) && (v.max || 0) > 0
  )

  // Classify
  let cause = 'unknown'
  let plan = 'orchestrator tick assign_job priority=critical'
  let autoApply = true
  let severity = 'medium'

  if (!acc.is_active) {
    cause = 'nick paused (is_active=false)'
    plan = 'resume nick manually if ok, or investigate pause reason'
    autoApply = false
    severity = 'high'
  } else if (acc.status === 'checkpoint' || acc.status === 'expired') {
    cause = `nick in ${acc.status} state — cookies dead`
    plan = 'user must refresh cookies via UI'
    autoApply = false
    severity = 'high'
  } else if (totalFailures >= 5) {
    cause = `${totalFailures} failures in last 24h (${Object.keys(failures).join(', ')})`
    plan = 'reduce rate + review checkpoint_risk patterns'
    autoApply = false
    severity = 'high'
  } else if (ageDays < 14) {
    cause = `nick young (${ageDays}d) — warmup gate blocks join_group/FR`
    plan = 'focus on likes + browse during warmup; join_group unlocks day 14'
    autoApply = false
    severity = 'low'
  } else if (budgetExhausted) {
    cause = 'daily_budget cap hit for one or more actions'
    plan = 'cap is working as intended; raise max if nick health allows'
    autoApply = false
    severity = 'low'
  } else if (idleMinutes > 180) {
    cause = `nick idle ${idleMinutes} min — no jobs picked up`
    plan = 'assign_job priority=critical to kick off work'
    autoApply = true
    severity = 'medium'
  } else {
    cause = 'throughput slower than expected — no clear blocker'
    plan = 'assign additional work + monitor'
    autoApply = true
    severity = 'low'
  }

  return {
    cause,
    plan,
    auto_apply: autoApply,
    severity,
    evidence: {
      idle_minutes: idleMinutes,
      age_days: ageDays,
      status: acc.status,
      is_active: acc.is_active,
      failures_24h: failures,
      budget_exhausted: budgetExhausted,
    },
  }
}

async function expectedProgress(target) {
  // Linear ramp across the active window (8am-10pm VN).
  // Returns fraction [0, 1] of the target expected to be done by `now`.
  const h = vnHour()
  if (h < ACTIVE_WINDOW_START) return 0
  const windowEnd = ACTIVE_WINDOW_START + ACTIVE_WINDOW_HOURS
  if (h >= windowEnd) return 1
  return (h - ACTIVE_WINDOW_START) / ACTIVE_WINDOW_HOURS
}

async function checkCapability(pool, accountId, campaignId) {
  // Look at last 7 days of nick_kpi_daily — is this nick consistently
  // hitting target with healthy signals? If yes, recommend bumping.
  const { rows } = await pool.query(
    `SELECT date, done_likes + done_comments + done_friend_requests + done_group_joins AS done,
            target_likes + target_comments + target_friend_requests + target_group_joins AS target
     FROM nick_kpi_daily
     WHERE account_id = $1 AND campaign_id = $2 AND date >= CURRENT_DATE - 7
     ORDER BY date DESC`,
    [accountId, campaignId]
  )
  let streak = 0
  for (const r of rows) {
    if (r.target > 0 && r.done >= r.target) streak++
    else break
  }
  if (streak >= CAPABILITY_STREAK_DAYS) {
    // Check checkpoint risk — don't bump if nick stressed
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { rows: cpRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM job_failures
       WHERE account_id = $1 AND error_type = 'CHECKPOINT' AND created_at > $2`,
      [accountId, since]
    )
    if ((cpRows[0]?.c || 0) === 0) {
      return { eligible_for_bump: true, streak_days: streak, bump_pct: CAPABILITY_BUMP_PCT }
    }
  }
  return { eligible_for_bump: false, streak_days: streak }
}

async function runWatcher(supabaseInst) {
  const pool = supabaseInst?._pool
  if (!pool) return

  const today = vnToday()

  // Pull today's KPI rows — only consider healthy nicks
  const { rows: kpis } = await pool.query(
    `SELECT k.account_id, k.campaign_id,
            COALESCE(k.done_likes,0)+COALESCE(k.done_comments,0)+COALESCE(k.done_friend_requests,0)+COALESCE(k.done_group_joins,0) AS done,
            COALESCE(k.target_likes,0)+COALESCE(k.target_comments,0)+COALESCE(k.target_friend_requests,0)+COALESCE(k.target_group_joins,0) AS target,
            a.is_active, a.status, a.username
     FROM nick_kpi_daily k
     JOIN accounts a ON a.id = k.account_id
     WHERE k.date = $1 AND a.is_active = true`,
    [today]
  )

  const expectedFrac = await expectedProgress()
  let checked = 0, shortfalls = 0, capabilities = 0

  for (const row of kpis) {
    checked++
    if (row.target <= 0) continue
    const expectedDone = row.target * expectedFrac
    const shortfall = expectedDone - row.done
    const shortfallPct = expectedDone > 0 ? Math.round((shortfall / expectedDone) * 100) : 0

    if (shortfallPct >= SHORTFALL_THRESHOLD_PCT) {
      shortfalls++
      const diag = await diagnose(pool, row.account_id, row.campaign_id)
      if (!diag) continue

      // Avoid spamming: only log one shortfall decision per nick per 2h
      const { rows: recent } = await pool.query(
        `SELECT id FROM hermes_decisions
         WHERE campaign_id = $1 AND decision_type = 'kpi_shortfall'
           AND target_id = $2 AND created_at > now() - INTERVAL '2 hours'
         LIMIT 1`,
        [row.campaign_id, row.account_id]
      )
      if (recent.length > 0) continue

      await pool.query(
        `INSERT INTO hermes_decisions (campaign_id, decision_type, action_type, target_id, target_name, priority, reason, decision, auto_apply, auto_applied, outcome, outcome_detail)
         VALUES ($1, 'kpi_shortfall', 'investigate_nick_shortfall', $2, $3, $4, $5, $6, $7, false, 'success', $8)`,
        [
          row.campaign_id,
          row.account_id,
          row.username,
          diag.severity === 'high' ? 'high' : 'medium',
          `${diag.cause}. Hôm nay: ${row.done}/${row.target} (${Math.round((row.done / row.target) * 100)}%)`,
          JSON.stringify({
            done: row.done,
            target: row.target,
            expected_by_now: Math.round(expectedDone),
            shortfall_pct: shortfallPct,
            cause: diag.cause,
            plan: diag.plan,
            evidence: diag.evidence,
          }),
          diag.auto_apply,
          `cause=${diag.cause} | plan=${diag.plan}`,
        ]
      )
    }

    // Also check capability bump
    const cap = await checkCapability(pool, row.account_id, row.campaign_id)
    if (cap.eligible_for_bump) {
      capabilities++
      // Only log once per nick per 7d to avoid spam
      const { rows: recent } = await pool.query(
        `SELECT id FROM hermes_decisions
         WHERE campaign_id = $1 AND decision_type = 'capability_bump'
           AND target_id = $2 AND created_at > now() - INTERVAL '7 days'
         LIMIT 1`,
        [row.campaign_id, row.account_id]
      )
      if (recent.length > 0) continue

      await pool.query(
        `INSERT INTO hermes_decisions (campaign_id, decision_type, action_type, target_id, target_name, priority, reason, decision, auto_apply, auto_applied, outcome, outcome_detail)
         VALUES ($1, 'capability_bump', 'raise_kpi_target', $2, $3, 'low', $4, $5, false, false, 'pending', $6)`,
        [
          row.campaign_id,
          row.account_id,
          row.username,
          `${cap.streak_days} ngày liên tiếp đạt KPI, không checkpoint — đề xuất nâng target +${cap.bump_pct}%`,
          JSON.stringify({ streak_days: cap.streak_days, bump_pct: cap.bump_pct, current_target: row.target }),
          `streak=${cap.streak_days}d bump=+${cap.bump_pct}%`,
        ]
      )
    }
  }

  if (shortfalls > 0 || capabilities > 0) {
    console.log(`[NICK-KPI] Checked ${checked} nicks · shortfalls=${shortfalls} · capability_bumps=${capabilities}`)
  }
}

module.exports = { runWatcher, diagnose, checkCapability }
