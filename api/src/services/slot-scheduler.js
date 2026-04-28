/**
 * Slot scheduler — generates per-nick burst windows for each VN day.
 *
 * Run once per day at 04:00 VN (= 21:00 UTC) for the following VN day.
 * Also runs on server boot to catch up if today's slots are missing.
 *
 * Design:
 *   - Each nick has a personality (chronotype, preferred_windows, action_mix,
 *     bursts_per_day, ...) → row in nick_personality. Missing row → default.
 *   - For a target VN date, gen N=bursts_per_day burst windows for each nick.
 *   - Within each agent_id (machine), enforce no overlap + ≥10-25 min IP
 *     cool-down gap between any two bursts (across ALL nicks on that machine).
 *   - Allocate target_actions across N bursts using action_mix * daily KPI *
 *     budget_volatility.
 *   - skip_day_chance → some days the nick generates 0 slots (mimics user
 *     not opening FB that day).
 *
 * Why VN date: business runs in Asia/Ho_Chi_Minh; KPIs reset at VN midnight.
 */
const cron = require('node-cron')
const { supabase: _sbFromLib } = require('../lib/supabase')

// ─── Defaults applied when nick has no row in nick_personality ──────
const DEFAULT_PERSONALITY = {
  chronotype: 'spread',
  preferred_windows: [
    { start_h: 7, end_h: 11, weight: 1 },
    { start_h: 13, end_h: 17, weight: 1 },
    { start_h: 19, end_h: 22, weight: 1.2 },
  ],
  bursts_per_day: 3,
  session_min_minutes: 15,
  session_max_minutes: 30,
  gap_min_minutes: 90,
  gap_max_minutes: 240,
  skip_day_chance: 0.05,
  daily_shift_minutes: 60,
  action_mix: { react: 0.5, comment: 0.25, share: 0.05, scroll_only: 0.2 },
  budget_volatility: 1.0,
}

// IP cool-down between any two bursts on the same agent (any nick → any nick).
// Random in this range so the gap looks organic.
const IP_GAP_MIN_SEC = 10 * 60
const IP_GAP_MAX_SEC = 25 * 60

const VN_OFFSET_MS = 7 * 3600 * 1000

let supabase = null

// ── Helpers ────────────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}
function randFloat(min, max) {
  return min + Math.random() * (max - min)
}
function pickWeighted(items) {
  const total = items.reduce((s, it) => s + (it.weight || 1), 0)
  let r = Math.random() * total
  for (const it of items) {
    r -= it.weight || 1
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

/**
 * Convert a VN-local date+hour+minute to a UTC Date.
 * vnDate: 'YYYY-MM-DD'; hour, minute in VN local time.
 */
function vnToUtc(vnDate, hour, minute) {
  // VN midnight in UTC = `${vnDate}T00:00:00+07:00`. Subtract VN offset to get UTC.
  const vnMidnightUtcMs = Date.parse(`${vnDate}T00:00:00.000Z`) - VN_OFFSET_MS
  return new Date(vnMidnightUtcMs + (hour * 3600 + minute * 60) * 1000)
}

/**
 * Today in VN as 'YYYY-MM-DD'.
 */
function vnDateString(now = new Date()) {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Add days to a 'YYYY-MM-DD' string.
 */
function addDays(vnDate, n) {
  const d = new Date(`${vnDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Personality fetch with default fallback ────────────────────────
async function getPersonalityFor(accountIds) {
  if (!accountIds.length) return new Map()
  const { data } = await supabase
    .from('nick_personality')
    .select('*')
    .in('account_id', accountIds)
  const map = new Map()
  for (const p of data || []) map.set(p.account_id, p)
  for (const id of accountIds) {
    if (!map.has(id)) map.set(id, { account_id: id, ...DEFAULT_PERSONALITY })
  }
  return map
}

// ── KPI target lookup (per nick, per day) ──────────────────────────
// Reads nick_kpi_daily for the date so the slot scheduler knows the full-day
// targets. If the row doesn't exist yet (KPI created lazily by another flow),
// we use 0s and the agent will still pick up jobs as long as it has them in
// the queue. action_mix only matters for capping per-burst; total target will
// be enforced by the existing kpi_met gate in poller.
async function getKpiTargets(accountIds, vnDate) {
  if (!accountIds.length) return new Map()
  const { data } = await supabase
    .from('nick_kpi_daily')
    .select('account_id, target_likes, target_comments, target_friend_requests, target_group_joins, target_opportunity_comments')
    .in('account_id', accountIds)
    .eq('date', vnDate)
  const map = new Map()
  for (const row of data || []) {
    map.set(row.account_id, {
      react: row.target_likes || 0,
      comment: row.target_comments || 0,
      friend_request: row.target_friend_requests || 0,
      join_group: row.target_group_joins || 0,
      opportunity_comment: row.target_opportunity_comments || 0,
    })
  }
  return map
}

// ── Per-nick raw bursts (no conflict resolution yet) ───────────────
function pickWindowMinute(window, dailyShiftMinutes) {
  const windowStartMin = window.start_h * 60
  const windowEndMin = window.end_h * 60
  const usable = Math.max(15, windowEndMin - windowStartMin - 15) // leave 15min tail
  let minute = windowStartMin + Math.floor(Math.random() * usable)
  // Apply ± daily shift
  const shift = randInt(-dailyShiftMinutes, dailyShiftMinutes)
  minute = Math.max(0, Math.min(24 * 60 - 15, minute + shift))
  return minute
}

function generateRawBursts(personality, vnDate) {
  const burstCount = randInt(
    Math.max(1, personality.bursts_per_day - 1),
    personality.bursts_per_day + 1
  )
  const bursts = []
  // pick burstCount windows (with replacement allowed for back-to-back from same window)
  for (let i = 0; i < burstCount; i++) {
    const window = pickWeighted(personality.preferred_windows || DEFAULT_PERSONALITY.preferred_windows)
    const startMinute = pickWindowMinute(window, personality.daily_shift_minutes || 0)
    const lengthMin = randInt(
      personality.session_min_minutes || 15,
      personality.session_max_minutes || 30
    )
    const startAt = vnToUtc(vnDate, Math.floor(startMinute / 60), startMinute % 60)
    const endAt = new Date(startAt.getTime() + lengthMin * 60000)
    bursts.push({ startAt, endAt })
  }
  // Sort + enforce per-nick gap_min/gap_max between consecutive bursts of THIS nick
  bursts.sort((a, b) => a.startAt - b.startAt)
  const gapMinMs = (personality.gap_min_minutes || 90) * 60000
  for (let i = 1; i < bursts.length; i++) {
    const prevEnd = bursts[i - 1].endAt.getTime()
    const need = prevEnd + gapMinMs
    if (bursts[i].startAt.getTime() < need) {
      const len = bursts[i].endAt.getTime() - bursts[i].startAt.getTime()
      bursts[i].startAt = new Date(need)
      bursts[i].endAt = new Date(need + len)
    }
  }
  return bursts
}

// ── Conflict resolver: across all nicks on same agent_id ───────────
// Push later-starting bursts back so any two bursts (across nicks) have
// gap ≥ random(IP_GAP_MIN_SEC, IP_GAP_MAX_SEC).
function resolveConflicts(allSlotsForAgent) {
  const sorted = allSlotsForAgent.slice().sort((a, b) => a.startAt - b.startAt)
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endAt.getTime()
    const gapSec = randInt(IP_GAP_MIN_SEC, IP_GAP_MAX_SEC)
    const need = prevEnd + gapSec * 1000
    if (sorted[i].startAt.getTime() < need) {
      const len = sorted[i].endAt.getTime() - sorted[i].startAt.getTime()
      sorted[i].startAt = new Date(need)
      sorted[i].endAt = new Date(need + len)
    }
  }
  return sorted
}

// ── Allocate action targets across slots for a single nick ─────────
function allocateTargets(slots, kpiTargets, personality) {
  if (!slots.length) return
  const mix = personality.action_mix || DEFAULT_PERSONALITY.action_mix
  const vol = personality.budget_volatility || 1
  const N = slots.length

  // For each action type with target > 0, distribute across slots.
  // Each slot gets either floor or ceil of (target * vol / N), summing
  // to round(target * vol). Distribution across slots roughly follows
  // action_mix weight × slot's burst index — but mix is per-action not
  // per-slot, so we just spread evenly per action type.
  const actions = ['react', 'comment', 'friend_request', 'join_group', 'opportunity_comment']
  for (const a of actions) {
    const dailyTarget = Math.round((kpiTargets[a] || 0) * vol)
    if (dailyTarget <= 0) continue
    // Optional: scale by action_mix when caller wants to bias type
    // distribution. We use mix only for 'react'+'comment' since friend
    // requests / joins / opportunity have own rate limits already.
    const mixWeight = ['react', 'comment'].includes(a) ? (mix[a] ?? 1) : 1
    const target = Math.round(dailyTarget * mixWeight / Math.max(0.1, mixWeight))
    const base = Math.floor(target / N)
    const remainder = target - base * N
    // Random which slots get the +1 — avoid putting all extras at start.
    const indices = [...Array(N).keys()].sort(() => Math.random() - 0.5)
    for (let i = 0; i < N; i++) {
      const slot = slots[i]
      slot.target_actions[a] = base + (indices.indexOf(i) < remainder ? 1 : 0)
    }
  }
}

// ── Main: gen slots for one VN date ────────────────────────────────
async function generateSlotsForDate(vnDate, opts = {}) {
  const force = !!opts.force
  console.log(`[SLOT-SCHEDULER] Generating slots for ${vnDate} (force=${force})`)

  // 1) Fetch all eligible accounts (active, not checkpoint/disabled).
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, user_id, status, is_active')
    .eq('is_active', true)
    .in('status', ['healthy', 'active'])
  if (accErr) throw accErr
  if (!accounts?.length) {
    console.log('[SLOT-SCHEDULER] No eligible accounts — skipping')
    return { generated: 0, skipped: 0 }
  }

  // 2) For each user_id, look up profiles.preferred_executor_id → agent_id.
  const userIds = [...new Set(accounts.map(a => a.user_id).filter(Boolean))]
  const agentByUser = new Map()
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, preferred_executor_id')
      .in('id', userIds)
    for (const p of profs || []) agentByUser.set(p.id, p.preferred_executor_id || null)
  }

  // 3) Skip accounts that already have non-skipped slots for vnDate (unless force).
  const accountIds = accounts.map(a => a.id)
  if (!force) {
    const { data: existing } = await supabase
      .from('nick_slots')
      .select('account_id')
      .in('account_id', accountIds)
      .eq('date', vnDate)
    const have = new Set((existing || []).map(r => r.account_id))
    if (have.size) {
      console.log(`[SLOT-SCHEDULER] ${have.size} account(s) already have slots for ${vnDate}, skipping them`)
    }
    var pending = accounts.filter(a => !have.has(a.id))
  } else {
    // Force: wipe existing slots for vnDate first
    await supabase.from('nick_slots').delete().in('account_id', accountIds).eq('date', vnDate)
    var pending = accounts
  }
  if (!pending.length) return { generated: 0, skipped: accounts.length }

  // 4) Fetch personality + kpi targets.
  const personalityMap = await getPersonalityFor(pending.map(a => a.id))
  const kpiMap = await getKpiTargets(pending.map(a => a.id), vnDate)

  // 5) Per-nick gen raw bursts; collect skipped (skip_day_chance) separately.
  const slotsByAgent = new Map() // agent_id (or '__none__') → array of slot objects
  const skippedRows = []

  for (const acc of pending) {
    const p = personalityMap.get(acc.id)
    const skip = Math.random() < (p.skip_day_chance ?? DEFAULT_PERSONALITY.skip_day_chance)
    if (skip) {
      skippedRows.push({
        account_id: acc.id,
        agent_id: agentByUser.get(acc.user_id) || null,
        date: vnDate,
        slot_index: 0,
        start_at: vnToUtc(vnDate, 12, 0).toISOString(),
        end_at: vnToUtc(vnDate, 12, 1).toISOString(),
        target_actions: {},
        status: 'skipped',
      })
      continue
    }
    const bursts = generateRawBursts(p, vnDate)
    const agentId = agentByUser.get(acc.user_id) || '__none__'
    if (!slotsByAgent.has(agentId)) slotsByAgent.set(agentId, [])
    for (const b of bursts) {
      slotsByAgent.get(agentId).push({
        accountId: acc.id,
        agentId: agentByUser.get(acc.user_id) || null,
        startAt: b.startAt,
        endAt: b.endAt,
        personality: p,
      })
    }
  }

  // 6) Conflict resolve per agent_id (each machine gets its own timeline).
  const finalRows = []
  for (const [agentId, slots] of slotsByAgent) {
    const resolved = resolveConflicts(slots)
    // Re-group per nick to assign slot_index + targets per nick.
    const byNick = new Map()
    for (const s of resolved) {
      if (!byNick.has(s.accountId)) byNick.set(s.accountId, [])
      byNick.get(s.accountId).push(s)
    }
    for (const [accId, nickSlots] of byNick) {
      // Sort each nick's own slots
      nickSlots.sort((a, b) => a.startAt - b.startAt)
      const slotShells = nickSlots.map(s => ({
        target_actions: {},
        startAt: s.startAt,
        endAt: s.endAt,
        agentId: s.agentId,
      }))
      allocateTargets(slotShells, kpiMap.get(accId) || {}, nickSlots[0].personality)
      slotShells.forEach((s, idx) => {
        finalRows.push({
          account_id: accId,
          agent_id: s.agentId,
          date: vnDate,
          slot_index: idx,
          start_at: s.startAt.toISOString(),
          end_at: s.endAt.toISOString(),
          target_actions: s.target_actions,
          status: 'pending',
        })
      })
    }
  }

  // 7) Insert + upsert skip rows.
  const allRows = [...finalRows, ...skippedRows]
  if (allRows.length === 0) return { generated: 0, skipped: 0 }

  // Chunk insert to stay under PostgREST limits.
  const CHUNK = 500
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK)
    const { error } = await supabase.from('nick_slots').upsert(chunk, {
      onConflict: 'account_id,date,slot_index',
    })
    if (error) {
      console.error(`[SLOT-SCHEDULER] Insert chunk ${i / CHUNK} failed:`, error.message)
    }
  }

  console.log(`[SLOT-SCHEDULER] Generated ${finalRows.length} slot(s) + ${skippedRows.length} skip-day(s) for ${vnDate}`)
  return { generated: finalRows.length, skipped: skippedRows.length }
}

// ── Active slot lookup (used by /agent-jobs/active-slot) ───────────
async function getActiveSlotForAccount(accountId, now = new Date()) {
  const nowIso = now.toISOString()
  const { data } = await supabase
    .from('nick_slots')
    .select('*')
    .eq('account_id', accountId)
    .in('status', ['pending', 'active'])
    .lte('start_at', nowIso)
    .gte('end_at', nowIso)
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function getNextSlotForAccount(accountId, now = new Date()) {
  const nowIso = now.toISOString()
  const { data } = await supabase
    .from('nick_slots')
    .select('*')
    .eq('account_id', accountId)
    .in('status', ['pending', 'active'])
    .gt('start_at', nowIso)
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data || null
}

// Atomic-ish increment: read done_actions, add delta, write back.
// Race risk acceptable — agent is the sole writer for its own nick at a time
// (poller serializes via MAX_CONCURRENT=1 + single agent_id).
async function recordSlotAction(slotId, actionType, delta = 1) {
  const { data: row } = await supabase
    .from('nick_slots')
    .select('done_actions, target_actions, status')
    .eq('id', slotId)
    .maybeSingle()
  if (!row) return null
  const done = { ...(row.done_actions || {}) }
  done[actionType] = (done[actionType] || 0) + delta

  // Mark active on first write, done when all targets met.
  let status = row.status
  if (status === 'pending') status = 'active'
  const target = row.target_actions || {}
  const allMet = Object.keys(target).length > 0 &&
    Object.entries(target).every(([k, v]) => (done[k] || 0) >= v)
  const update = { done_actions: done, status }
  if (allMet) {
    update.status = 'done'
    update.done_at = new Date().toISOString()
  }
  await supabase.from('nick_slots').update(update).eq('id', slotId)
  return { ...row, ...update }
}

// ── Cron init + startup catch-up ───────────────────────────────────
function initSlotScheduler() {
  supabase = _sbFromLib

  // Startup catch-up: ensure today + tomorrow exist (server may have been down
  // through the 04:00 cron firing).
  ;(async () => {
    try {
      const today = vnDateString()
      const tomorrow = addDays(today, 1)
      await generateSlotsForDate(today).catch(e => console.warn('[SLOT-SCHEDULER] catch-up today failed:', e.message))
      await generateSlotsForDate(tomorrow).catch(e => console.warn('[SLOT-SCHEDULER] catch-up tomorrow failed:', e.message))
    } catch (e) {
      console.warn('[SLOT-SCHEDULER] startup catch-up failed:', e.message)
    }
  })()

  // 04:00 VN = 21:00 UTC. node-cron runs in server local time, so convert.
  // To avoid TZ surprises, run hourly + check VN hour ourselves.
  cron.schedule('5 * * * *', async () => {
    const vnNow = new Date(Date.now() + VN_OFFSET_MS)
    if (vnNow.getUTCHours() !== 4) return // only act at 04:xx VN
    const tomorrow = addDays(vnDateString(), 1)
    try {
      await generateSlotsForDate(tomorrow)
    } catch (e) {
      console.error('[SLOT-SCHEDULER] nightly run failed:', e.message)
    }
  })

  console.log('[SLOT-SCHEDULER] Initialized — catch-up + nightly cron at 04:05 VN')
}

module.exports = {
  initSlotScheduler,
  generateSlotsForDate,
  getActiveSlotForAccount,
  getNextSlotForAccount,
  recordSlotAction,
  vnDateString,
  DEFAULT_PERSONALITY,
}
