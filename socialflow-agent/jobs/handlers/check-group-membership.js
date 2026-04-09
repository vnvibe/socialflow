/**
 * Handler: check_group_membership
 *
 * Re-verifies a group whose join request was previously detected as "pending
 * admin approval". The handler visits the group page and looks for a composer
 * box ("Bạn viết gì đi..." / "What's on your mind..."). If present, the nick
 * has been admitted. Otherwise, we look for "pending review" / "request sent"
 * to confirm it's still pending, or rejection markers.
 *
 * Updates fb_groups row accordingly:
 *   - admitted    → is_member=true,  pending_approval=false, joined_at=now()
 *   - still wait  → is_member=false, pending_approval=true   (no change)
 *   - rejected    → is_member=false, pending_approval=false, score_tier='D'
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const R = require('../../lib/randomizer')

async function checkGroupMembershipHandler(payload, supabase) {
  const { account_id, fb_group_id, group_row_id, group_url, group_name } = payload
  if (!account_id || !fb_group_id) throw new Error('account_id and fb_group_id required')

  const { data: account } = await supabase
    .from('accounts').select('*, proxies(*)')
    .eq('id', account_id).single()
  if (!account) throw new Error('Account not found')

  let page, session
  try {
    session = await getPage(account)
    page = session.page

    const url = group_url || `https://www.facebook.com/groups/${fb_group_id}`
    console.log(`[CHECK-MEMBER] ${group_name || fb_group_id} — navigating...`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await R.sleepRange(3000, 5000)

    const status = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      const html = document.documentElement.innerHTML || ''

      // Composer presence = admitted. Facebook renders the composer with an
      // aria-label containing "Write something" / "Bạn viết gì đi" / "Create a post".
      const composerSelectors = [
        '[aria-label*="Write something" i]',
        '[aria-label*="Viết bài" i]',
        '[aria-label*="Bạn viết gì" i]',
        '[aria-label*="Create a post" i]',
        '[aria-label*="Tạo bài viết" i]',
        '[role="textbox"][contenteditable="true"]',
      ]
      let hasComposer = false
      for (const sel of composerSelectors) {
        try {
          if (document.querySelector(sel)) { hasComposer = true; break }
        } catch {}
      }

      // Pending / request-sent markers
      const pendingMarkers = [
        /pending\s+review/i,
        /request\s+(to\s+join|sent|pending)/i,
        /chờ\s+(duyệt|phê\s+duyệt)/i,
        /đã\s+gửi\s+yêu\s+cầu/i,
        /awaiting/i,
      ]
      const isPending = pendingMarkers.some(p => p.test(text))

      // Rejection / removed markers
      const rejectMarkers = [
        /request\s+(declined|rejected)/i,
        /you\s+can'?t\s+(see|view)\s+this\s+group/i,
        /yêu\s+cầu\s+(bị\s+)?từ\s+chối/i,
        /bạn\s+không\s+thể\s+xem\s+nhóm/i,
        /this\s+content\s+isn'?t\s+available/i,
      ]
      const isRejected = rejectMarkers.some(p => p.test(text))

      // "Join group" button visible → we were removed / never joined
      const hasJoinButton = /Join\s+group|Tham\s+gia\s+nhóm/i.test(html) &&
        !!document.querySelector('div[aria-label*="Join" i][role="button"], div[aria-label*="Tham gia" i][role="button"]')

      return { hasComposer, isPending, isRejected, hasJoinButton, snippet: text.substring(0, 300) }
    }).catch(() => ({ hasComposer: false, isPending: false, isRejected: false, hasJoinButton: false, snippet: '' }))

    const attempt = payload.attempt || 1
    let updates = null
    let verdict = 'unknown'

    if (status.hasComposer && !status.hasJoinButton) {
      verdict = 'admitted'
      updates = {
        is_member: true,
        pending_approval: false,
        joined_at: new Date().toISOString(),
        membership_check_attempts: attempt,
        membership_last_checked_at: new Date().toISOString(),
      }
    } else if (status.isRejected || status.hasJoinButton) {
      verdict = 'rejected_or_removed'
      updates = {
        is_member: false,
        pending_approval: false,
        score_tier: 'D',
        membership_check_attempts: attempt,
        membership_last_checked_at: new Date().toISOString(),
      }
    } else if (status.isPending || verdict === 'unknown') {
      verdict = status.isPending ? 'still_pending' : 'ambiguous'

      // Track attempt + schedule next check with exponential backoff
      const backoffMinutes = [20, 60, 120, 360, 1440] // 20m, 1h, 2h, 6h, 24h
      const nextDelay = (backoffMinutes[Math.min(attempt, backoffMinutes.length - 1)]) * 60 * 1000

      updates = {
        membership_check_attempts: attempt,
        membership_last_checked_at: new Date().toISOString(),
      }

      // After 5 attempts AND > 72h since first seen → give up, mark tier D
      const groupRowId = group_row_id || null
      if (attempt > 5) {
        try {
          const { data: grp } = await supabase.from('fb_groups')
            .select('created_at').eq('id', groupRowId || '').single()
          const hoursSinceCreated = grp?.created_at
            ? (Date.now() - new Date(grp.created_at).getTime()) / 3600000
            : 0
          if (hoursSinceCreated > 72) {
            verdict = 'pending_too_long'
            updates.score_tier = 'D'
            updates.pending_approval = false
            updates.is_member = false
            console.log(`[CHECK-MEMBER] ${group_name || fb_group_id} → pending_too_long (${attempt} attempts, ${Math.round(hoursSinceCreated)}h) → tier D`)
          }
        } catch {}
      }

      // Re-queue with backoff (only if not giving up)
      if (verdict !== 'pending_too_long') {
        try {
          await supabase.from('jobs').insert({
            type: 'check_group_membership',
            priority: 5,
            payload: {
              ...payload,
              attempt: attempt + 1,
            },
            status: 'pending',
            scheduled_at: new Date(Date.now() + nextDelay).toISOString(),
          })
          const delayLabel = nextDelay < 3600000
            ? `${Math.round(nextDelay / 60000)}min`
            : `${Math.round(nextDelay / 3600000)}h`
          console.log(`[CHECK-MEMBER] ${group_name || fb_group_id} → ${verdict} (attempt ${attempt}) → next check in ${delayLabel}`)
        } catch {}
      }
    }

    // Apply updates
    if (updates) {
      if (group_row_id) {
        await supabase.from('fb_groups').update(updates).eq('id', group_row_id)
      } else {
        await supabase.from('fb_groups').update(updates)
          .eq('account_id', account_id).eq('fb_group_id', fb_group_id)
      }
    }

    // If admitted, also activate the campaign_groups junction row
    if (verdict === 'admitted' && payload.campaign_id && group_row_id) {
      try {
        await supabase.from('campaign_groups')
          .update({ status: 'active' })
          .eq('campaign_id', payload.campaign_id)
          .eq('group_id', group_row_id)
      } catch {}
    }

    console.log(`[CHECK-MEMBER] ${group_name || fb_group_id} → ${verdict}`)
    return { success: true, verdict, attempt, updated: !!updates, snippet: status.snippet.substring(0, 120) }
  } finally {
    if (session) await releaseSession(account_id).catch(() => {})
  }
}

module.exports = checkGroupMembershipHandler
