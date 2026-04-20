// Daily Report — per-campaign end-of-day summary.
//
// Runs 22:00 VN every night. For each active campaign:
//   1. Aggregate today's stats from nick_kpi_daily + campaign_activity_log
//      + job_failures + hermes_decisions (pure SQL, no LLM)
//   2. Compute per-nick highlights (top 3 + bottom 3)
//   3. Optionally call Hermes reporter skill for a VN narrative
//      (graceful fallback to structured-only if LLM fails)
//   4. UPSERT into daily_reports so the UI shows it instantly
//
// Keeps all the useful data even when the LLM layer is down — that was
// the whole point of splitting "what happened" (script) from "how we
// explain it" (LLM narrative).

const fetch = global.fetch || require('node-fetch')

function vnToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

async function gatherStats(pool, campaignId, date) {
  const out = {
    totals: { likes: 0, comments: 0, opportunity_comments: 0, friend_requests: 0, group_joins: 0, visits: 0 },
    target: { likes: 0, comments: 0, opportunity_comments: 0, friend_requests: 0, group_joins: 0 },
    per_nick: [],
    failures: { total: 0, by_type: {} },
    decisions: { total: 0, by_type: {} },
    active_nicks: 0,
  }

  // KPI totals from nick_kpi_daily
  const { rows: kpiRows } = await pool.query(
    `SELECT k.account_id, a.username,
            COALESCE(k.done_likes,0) AS done_likes,    COALESCE(k.target_likes,0) AS target_likes,
            COALESCE(k.done_comments,0) AS done_comments, COALESCE(k.target_comments,0) AS target_comments,
            COALESCE(k.done_opportunity_comments,0) AS done_opp,
            COALESCE(k.target_opportunity_comments,0) AS target_opp,
            COALESCE(k.done_friend_requests,0) AS done_fr, COALESCE(k.target_friend_requests,0) AS target_fr,
            COALESCE(k.done_group_joins,0) AS done_joins,  COALESCE(k.target_group_joins,0) AS target_joins
     FROM nick_kpi_daily k
     JOIN accounts a ON a.id = k.account_id
     WHERE k.campaign_id = $1 AND k.date = $2`,
    [campaignId, date]
  )

  for (const r of kpiRows) {
    out.totals.likes += r.done_likes
    out.totals.comments += r.done_comments
    out.totals.opportunity_comments += r.done_opp
    out.totals.friend_requests += r.done_fr
    out.totals.group_joins += r.done_joins
    out.target.likes += r.target_likes
    out.target.comments += r.target_comments
    out.target.opportunity_comments += r.target_opp
    out.target.friend_requests += r.target_fr
    out.target.group_joins += r.target_joins

    const done = r.done_likes + r.done_comments + r.done_opp + r.done_fr + r.done_joins
    const target = r.target_likes + r.target_comments + r.target_opp + r.target_fr + r.target_joins
    out.per_nick.push({
      account_id: r.account_id,
      username: r.username,
      done, target,
      pct: target > 0 ? Math.round((done / target) * 100) : 0,
      breakdown: {
        likes: { done: r.done_likes, target: r.target_likes },
        comments: { done: r.done_comments, target: r.target_comments },
        opportunity_comments: { done: r.done_opp, target: r.target_opp },
        friend_requests: { done: r.done_fr, target: r.target_fr },
        group_joins: { done: r.done_joins, target: r.target_joins },
      },
    })
  }
  out.active_nicks = out.per_nick.length

  // Visit count from activity log
  const { rows: visitRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM campaign_activity_log
     WHERE campaign_id = $1 AND action_type = 'visit_group' AND created_at::date = $2::date`,
    [campaignId, date]
  )
  out.totals.visits = visitRows[0]?.c || 0

  // Failures
  const { rows: failRows } = await pool.query(
    `SELECT error_type, COUNT(*)::int AS c
     FROM job_failures jf
     WHERE jf.created_at::date = $1::date
       AND jf.account_id IN (SELECT unnest(account_ids) FROM campaigns WHERE id = $2)
     GROUP BY error_type ORDER BY c DESC`,
    [date, campaignId]
  )
  for (const r of failRows) {
    out.failures.total += r.c
    out.failures.by_type[r.error_type] = r.c
  }

  // Decision counts today
  const { rows: decRows } = await pool.query(
    `SELECT decision_type, action_type, COUNT(*)::int AS c
     FROM hermes_decisions
     WHERE campaign_id = $1 AND created_at::date = $2::date
     GROUP BY decision_type, action_type`,
    [campaignId, date]
  )
  for (const r of decRows) {
    out.decisions.total += r.c
    const key = `${r.decision_type}:${r.action_type || 'none'}`
    out.decisions.by_type[key] = r.c
  }

  // Sort per_nick: best first
  out.per_nick.sort((a, b) => b.pct - a.pct)
  out.highlights = {
    top: out.per_nick.slice(0, 3),
    bottom: out.per_nick.filter(n => n.target > 0).slice(-3).reverse(),
  }

  return out
}

async function callHermesReporter(stats, campaign) {
  const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8100'
  const AGENT_SECRET = process.env.AGENT_SECRET
  if (!AGENT_SECRET) return null

  const hasOpp = (stats.target.opportunity_comments || 0) > 0
  const oppLine = hasOpp
    ? ` · ${stats.totals.opportunity_comments} QC (target ${stats.target.opportunity_comments})`
    : ''

  const prompt = `Bạn là Hermes — AI quản lý chiến dịch Facebook. Viết báo cáo CUỐI NGÀY cho campaign "${campaign.name}" bằng tiếng Việt tự nhiên, ngắn gọn (4-6 câu). Số liệu:

- Tổng: ${stats.totals.likes} like · ${stats.totals.comments} comment${oppLine} · ${stats.totals.friend_requests} kết bạn · ${stats.totals.group_joins} join group · ${stats.totals.visits} lượt vào nhóm
- Target: ${stats.target.likes} like · ${stats.target.comments} comment · ${stats.target.friend_requests} kết bạn · ${stats.target.group_joins} join
- Nicks active: ${stats.active_nicks}
- Job failures: ${stats.failures.total} (${Object.keys(stats.failures.by_type).slice(0, 3).join(', ')})
- Decisions today: ${stats.decisions.total}
- Top nicks: ${stats.highlights.top.map(n => `${n.username} ${n.done}/${n.target} (${n.pct}%)`).join(', ')}
- Bottom nicks: ${stats.highlights.bottom.map(n => `${n.username} ${n.done}/${n.target} (${n.pct}%)`).join(', ')}

Format: 1 đoạn narrative VN tự nhiên. Không đánh số bullet. Kết thúc bằng 1 câu khuyến nghị cho ngày mai. Trả về THUẦN VĂN BẢN, không JSON.`

  try {
    const res = await fetch(`${HERMES_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_SECRET },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
        task_type: 'reporter',
        function_name: 'reporter',
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    return {
      text: (json.text || '').trim(),
      provider: json.model || 'hermes',
    }
  } catch {
    return null
  }
}

async function generateForCampaign(supabase, campaignId, date) {
  const pool = supabase._pool
  if (!pool) throw new Error('pg pool unavailable')

  const targetDate = date || vnToday()

  const { rows: cRows } = await pool.query(
    `SELECT id, name, owner_id FROM campaigns WHERE id = $1`,
    [campaignId]
  )
  const campaign = cRows[0]
  if (!campaign) return null

  const stats = await gatherStats(pool, campaignId, targetDate)

  // Optional narrative — if LLM fails, row still has structured stats
  let narrative = null
  if (stats.active_nicks > 0) {
    narrative = await callHermesReporter(stats, campaign)
  }

  await pool.query(
    `INSERT INTO daily_reports (campaign_id, date, owner_id, stats, narrative_text, narrative_provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (campaign_id, date) DO UPDATE SET
       stats = EXCLUDED.stats,
       narrative_text = COALESCE(EXCLUDED.narrative_text, daily_reports.narrative_text),
       narrative_provider = COALESCE(EXCLUDED.narrative_provider, daily_reports.narrative_provider),
       created_at = now()`,
    [
      campaignId,
      targetDate,
      campaign.owner_id,
      JSON.stringify(stats),
      narrative?.text || null,
      narrative?.provider || null,
    ]
  )

  return { campaign_id: campaignId, date: targetDate, stats, narrative }
}

async function generateAllRunning(supabase) {
  const pool = supabase._pool
  if (!pool) return { ran: 0 }
  const { rows: campaigns } = await pool.query(
    `SELECT id, name FROM campaigns WHERE is_active = true AND status IN ('running','active','paused')`
  )

  const date = vnToday()
  let ran = 0
  for (const c of campaigns) {
    try {
      await generateForCampaign(supabase, c.id, date)
      ran++
    } catch (err) {
      console.warn(`[DAILY-REPORT] ${c.name}: ${err.message}`)
    }
  }
  console.log(`[DAILY-REPORT] Generated ${ran}/${campaigns.length} reports for ${date}`)
  return { ran, total: campaigns.length, date }
}

module.exports = { generateForCampaign, generateAllRunning, gatherStats, vnToday }
