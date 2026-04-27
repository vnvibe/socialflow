/**
 * One-shot persona seeder for SocialFlow nicks.
 *
 * Why: Hermes traffic_conductor uses persona.archetype + timezone + natural_online_hours
 *      to schedule each nick at "human-like" hours. Without a persona row in
 *      ai_pilot_memory, the conductor falls back to a generic default — which
 *      makes 10 nicks behave identically, defeating the anti-detect goal.
 *
 * Distribution rule: archetype is picked deterministically from the account.id
 *      hash so re-running the script produces the same persona for the same
 *      nick (idempotent), but spreads 10 nicks across 8 archetypes.
 *
 * Usage: node api/seed-personas.js [--dry] [--owner <user_id>] [--force]
 *      --dry    Print what would be written, don't insert
 *      --owner  Only seed nicks owned by this user_id
 *      --force  Overwrite existing persona rows (default: skip nicks that already have one)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const crypto = require('crypto')
const { supabase } = require('./src/lib/supabase')

const ARCHETYPES = [
  {
    name: 'office_worker',
    timezone_offset: 7,
    natural_online_hours_local: [12, 13, 19, 20, 21, 22],
    description: 'Nhân viên văn phòng — online lunch break + tối sau giờ làm',
  },
  {
    name: 'student',
    timezone_offset: 7,
    natural_online_hours_local: [9, 10, 14, 15, 21, 22, 23],
    description: 'Sinh viên — online giữa buổi + đêm muộn',
  },
  {
    name: 'freelancer',
    timezone_offset: 7,
    natural_online_hours_local: [10, 11, 14, 15, 16, 20, 21],
    description: 'Freelance — pattern không cố định, ban ngày tản mạn',
  },
  {
    name: 'housewife',
    timezone_offset: 7,
    natural_online_hours_local: [9, 10, 14, 15, 16, 17, 20],
    description: 'Bà nội trợ — sáng + chiều khi con đi học',
  },
  {
    name: 'night_owl',
    timezone_offset: 7,
    natural_online_hours_local: [21, 22, 23, 0, 1, 2],
    description: 'Cú đêm — chủ yếu khuya',
  },
  {
    name: 'early_bird',
    timezone_offset: 7,
    natural_online_hours_local: [6, 7, 8, 12, 13, 19],
    description: 'Dậy sớm — sáng tinh mơ + lunch + đầu tối',
  },
  {
    name: 'casual_user',
    timezone_offset: 7,
    natural_online_hours_local: [11, 12, 18, 19, 20, 21],
    description: 'User bình thường, online vài lần/ngày',
  },
  {
    name: 'retiree',
    timezone_offset: 7,
    natural_online_hours_local: [7, 8, 9, 14, 15, 16, 19, 20],
    description: 'Người về hưu — sáng + chiều + đầu tối',
  },
]

function pickArchetype(accountId) {
  const hash = crypto.createHash('sha1').update(accountId).digest()
  return ARCHETYPES[hash[0] % ARCHETYPES.length]
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const force = args.includes('--force')
  const ownerIdx = args.indexOf('--owner')
  const ownerFilter = ownerIdx >= 0 ? args[ownerIdx + 1] : null

  let q = supabase.from('accounts').select('id, username, owner_id, created_at, status')
  if (ownerFilter) q = q.eq('owner_id', ownerFilter)
  const { data: accounts, error } = await q
  if (error) {
    console.error('Failed to load accounts:', error.message)
    process.exit(1)
  }
  if (!accounts?.length) {
    console.log('No accounts found.')
    return
  }

  // Existing persona rows
  const { data: existing } = await supabase
    .from('ai_pilot_memory')
    .select('account_id')
    .eq('memory_type', 'persona')
    .in('account_id', accounts.map(a => a.id))
  const haveSet = new Set((existing || []).map(r => r.account_id))

  let written = 0, skipped = 0
  for (const a of accounts) {
    if (haveSet.has(a.id) && !force) {
      skipped++
      continue
    }
    const arch = pickArchetype(a.id)
    const persona = {
      archetype: arch.name,
      timezone_offset: arch.timezone_offset,
      natural_online_hours_local: arch.natural_online_hours_local,
      description: arch.description,
      seeded_at: new Date().toISOString(),
    }

    const row = {
      campaign_id: null,
      account_id: a.id,
      group_fb_id: null,
      memory_type: 'persona',
      key: 'profile',
      value: persona,
      confidence: 0.6,
      evidence_count: 1,
    }

    if (dry) {
      console.log(`[DRY] ${a.username || a.id}: ${arch.name}  hours=${arch.natural_online_hours_local.join(',')}`)
      continue
    }

    // Upsert by unique (campaign_id, account_id, group_fb_id, memory_type, key)
    const { error: upErr } = await supabase
      .from('ai_pilot_memory')
      .upsert(row, { onConflict: 'campaign_id,account_id,group_fb_id,memory_type,key' })
    if (upErr) {
      console.warn(`Failed for ${a.username}: ${upErr.message}`)
      continue
    }
    console.log(`✓ ${a.username || a.id}: ${arch.name}`)
    written++
  }

  console.log(`\nSummary: ${written} written, ${skipped} skipped (already have persona, use --force to overwrite), ${accounts.length} total`)
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err)
    process.exit(1)
  }
)
