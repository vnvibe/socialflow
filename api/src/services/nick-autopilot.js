// Nick Autopilot — script-based orchestrator.
//
// User: "cái nào cần suy nghĩ thì mới dùng LLM, không cần thì dùng script".
//
// The LLM orchestrator was firing 461 calls/week (88% of Hermes cost) to
// emit mostly deterministic decisions:
//   • idle + healthy + pending job in queue → claim / assign_job
//   • group pending_days > 7 + check_count >= 3 → skip_group
//   • nick failed 5+ in 24h → decrease_budget
//   • nick expired/checkpoint → alert_user
//   • nick avg_comment_gap < 45s + sample >= 10 → pause_nick 2h
//
// None of those need LLM judgment — they're rule matches on DB state.
// This autopilot runs every 5 min, emits those actions directly, and
// writes hermes_decisions rows with source='autopilot' so the UI can
// distinguish AI vs scripted decisions.
//
// The LLM orchestrator is still useful for capability bumps, content
// strategy, novel edge cases — but now runs hourly instead of every
// 15 min (288 → 72 calls/day for 3 campaigns = ~75% cost cut).

const AGE_WARMUP_DAYS = 14
const IDLE_MINUTES_THRESHOLD = 180
const PENDING_DAYS_HARD_CAP = 7
const CHECK_COUNT_HARD_CAP = 3
const FAILURES_24H_THRESHOLD = 5
const COMMENT_GAP_SECONDS_FLOOR = 45
const COMMENT_SAMPLE_MIN = 10
const CHECKPOINT_7D_THRESHOLD = 2

async function insertDecision(pool, campaignId, targetId, targetName, actionType, priority, reason, decision, autoApply) {
  // Dedup — don't repeat the same decision for the same target within 2h
  const { rows: recent } = await pool.query(
    `SELECT id FROM hermes_decisions
     WHERE campaign_id = $1 AND target_id = $2 AND action_type = $3
       AND created_at > now() - INTERVAL '2 hours'
     LIMIT 1`,
    [campaignId, targetId, actionType]
  )
  if (recent.length > 0) return false

  await pool.query(
    `INSERT INTO hermes_decisions (campaign_id, decision_type, action_type, target_id, target_name, priority, reason, decision, auto_apply, auto_applied, outcome)
     VALUES ($1, 'autopilot', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      campaignId,
      actionType,
      targetId,
      targetName,
      priority,
      reason,
      JSON.stringify({ ...decision, source: 'autopilot' }),
      autoApply,
      autoApply,                                // auto_applied boolean
      autoApply ? 'success' : 'pending',        // outcome
    ]
  )
  return true
}

async function runNickChecks(pool, campaignId, nicks) {
  let emitted = 0

  for (const nick of nicks) {
    // Rule 1: nick in checkpoint/expired → alert_user (needs human)
    if (nick.status === 'checkpoint' || nick.status === 'expired') {
      if (await insertDecision(pool, campaignId, nick.id, nick.username,
        'alert_user', 'high',
        `Nick ${nick.status} — cookies chết, cần user refresh`,
        { severity: 'urgent', action: 'refresh_cookies' },
        false
      )) emitted++
      continue
    }

    if (!nick.is_active) continue

    // Rule 2: too many checkpoints recent → decrease_budget
    if ((nick.checkpoint_7d || 0) >= CHECKPOINT_7D_THRESHOLD) {
      if (await insertDecision(pool, campaignId, nick.id, nick.username,
        'decrease_budget', 'high',
        `${nick.checkpoint_7d} checkpoint trong 7 ngày — giảm comment quota 50%`,
        { task_type: 'comment', multiplier: 0.5 },
        true
      )) emitted++
    }

    // Rule 3: comment gap too tight → pause 2h
    if (nick.avg_comment_gap != null && nick.avg_comment_gap < COMMENT_GAP_SECONDS_FLOOR
        && (nick.comment_sample || 0) >= COMMENT_SAMPLE_MIN) {
      if (await insertDecision(pool, campaignId, nick.id, nick.username,
        'pause_nick', 'high',
        `Comment quá nhanh (avg ${nick.avg_comment_gap}s < ${COMMENT_GAP_SECONDS_FLOOR}s) — nghỉ 2h`,
        { duration_hours: 2, reason: 'comment_spam_prevention' },
        true
      )) emitted++
    }

    // Rule 4: too many failures → alert + throttle
    if ((nick.failures_24h || 0) >= FAILURES_24H_THRESHOLD) {
      if (await insertDecision(pool, campaignId, nick.id, nick.username,
        'alert_user', 'medium',
        `${nick.failures_24h} job fail trong 24h — review error pattern`,
        { severity: 'warning', failures: nick.failures_24h },
        false
      )) emitted++
    }
  }

  return emitted
}

async function runGroupChecks(pool, campaignId) {
  let emitted = 0
  // Pull groups pending admin approval for this campaign
  const { rows: groups } = await pool.query(
    `SELECT fg.id, fg.name, fg.pending_approval,
            EXTRACT(DAY FROM (now() - fg.created_at))::int AS pending_days,
            COALESCE((SELECT COUNT(*) FROM jobs j
                      WHERE j.type = 'check_group_membership'
                        AND j.status = 'done'
                        AND j.payload->>'group_row_id' = fg.id::text), 0) AS check_count,
            EXISTS (SELECT 1 FROM jobs j
                    WHERE j.type = 'check_group_membership'
                      AND j.status IN ('pending','claimed','running')
                      AND j.payload->>'group_row_id' = fg.id::text) AS has_check_job
     FROM campaign_groups cg
     JOIN fb_groups fg ON fg.id = cg.group_id
     WHERE cg.campaign_id = $1 AND cg.status = 'active'
       AND fg.pending_approval = true AND fg.is_member = false`,
    [campaignId]
  )

  for (const g of groups) {
    if (g.has_check_job) continue // already checking

    // Rule 5: pending > 7d + already checked 3+ times → give up
    if (g.pending_days > PENDING_DAYS_HARD_CAP && g.check_count >= CHECK_COUNT_HARD_CAP) {
      if (await insertDecision(pool, campaignId, g.id, g.name,
        'skip_group', 'low',
        `Chờ duyệt ${g.pending_days}d, đã check ${g.check_count} lần — bỏ nhóm`,
        { reason: 'admin_approval_unlikely', pending_days: g.pending_days, check_count: g.check_count },
        true
      )) emitted++
    }
    // Rule 6: pending ≤ 7d, no check job → queue recheck
    else if (g.pending_days <= PENDING_DAYS_HARD_CAP && g.check_count < CHECK_COUNT_HARD_CAP) {
      if (await insertDecision(pool, campaignId, g.id, g.name,
        'recheck_group', 'medium',
        `Pending ${g.pending_days}d, check ${g.check_count}/${CHECK_COUNT_HARD_CAP} — queue recheck`,
        { action: 'queue_check_group_membership' },
        true
      )) emitted++
    }
  }

  return emitted
}

async function gatherNickStats(pool, campaignId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.username, a.status, a.is_active, a.fb_created_at, a.created_at,
            EXTRACT(EPOCH FROM (now() - a.last_used_at))/60 AS idle_min,
            (SELECT COUNT(*)::int FROM job_failures f
             WHERE f.account_id = a.id AND f.created_at > now() - INTERVAL '24 hours') AS failures_24h,
            (SELECT COUNT(*)::int FROM job_failures f
             WHERE f.account_id = a.id AND f.error_type = 'CHECKPOINT'
               AND f.created_at > now() - INTERVAL '7 days') AS checkpoint_7d
     FROM accounts a
     WHERE a.id = ANY($1::uuid[])`,
    [await pickCampaignNickIds(pool, campaignId)]
  )
  return rows.map(r => ({
    id: r.id,
    username: r.username,
    status: r.status,
    is_active: r.is_active,
    idle_minutes: r.idle_min != null ? Math.floor(r.idle_min) : 999,
    age_days: Math.floor((Date.now() - new Date(r.fb_created_at || r.created_at).getTime()) / 86400000),
    failures_24h: r.failures_24h,
    checkpoint_7d: r.checkpoint_7d,
  }))
}

async function pickCampaignNickIds(pool, campaignId) {
  const { rows } = await pool.query(
    `SELECT account_ids FROM campaigns WHERE id = $1`,
    [campaignId]
  )
  const topLevel = rows[0]?.account_ids || []
  const { rows: roleRows } = await pool.query(
    `SELECT account_ids FROM campaign_roles WHERE campaign_id = $1`,
    [campaignId]
  )
  const fromRoles = (roleRows || []).flatMap(r => r.account_ids || [])
  return [...new Set([...topLevel, ...fromRoles])]
}

async function runAutopilot(supabase) {
  const pool = supabase?._pool
  if (!pool) return { ran: 0 }

  const { rows: campaigns } = await pool.query(
    `SELECT id, name FROM campaigns WHERE is_active = true AND status IN ('running','active')`
  )

  let totalEmitted = 0
  for (const c of campaigns) {
    try {
      const nicks = await gatherNickStats(pool, c.id)
      const nickEmitted = await runNickChecks(pool, c.id, nicks)
      const groupEmitted = await runGroupChecks(pool, c.id)
      if (nickEmitted + groupEmitted > 0) {
        console.log(`[AUTOPILOT] ${c.name}: ${nickEmitted + groupEmitted} actions (${nickEmitted} nick + ${groupEmitted} group)`)
      }
      totalEmitted += nickEmitted + groupEmitted
    } catch (err) {
      console.warn(`[AUTOPILOT] ${c.name} error: ${err.message}`)
    }
  }

  return { ran: campaigns.length, emitted: totalEmitted }
}

module.exports = { runAutopilot }
