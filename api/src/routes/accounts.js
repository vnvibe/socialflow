const { extractCUserId, generateFingerprint } = require('../services/facebook/fb-auth')
const { fetchPersonalInbox, replyPersonalMessage } = require('../services/facebook/fb-inbox')
const { getAccessibleIds, canAccess } = require('../lib/access-check')

// Default daily budget for new accounts — matches HARD_LIMITS in agent
const DEFAULT_DAILY_BUDGET = {
  like:                { used: 0, max: 80 },
  comment:             { used: 0, max: 15 },
  post:                { used: 0, max: 3 },
  join_group:          { used: 0, max: 3 },
  friend_request:      { used: 0, max: 10 },
  opportunity_comment: { used: 0, max: 2 },
  scan:                { used: 0, max: 15 },
}

module.exports = async (fastify) => {
  const { supabase } = fastify

  // Helper: resolve effective owner_id (admin can impersonate via ?as_user=uuid)
  function getOwnerId(req) {
    const asUser = req.query?.as_user
    if (asUser && req.user.role === 'admin' && asUser !== req.user.id) {
      return asUser
    }
    return req.user.id
  }

  // GET /accounts/health-summary — Account health view for dashboard
  fastify.get('/health-summary', { preHandler: fastify.authenticate }, async (req, reply) => {
    const accessibleIds = await getAccessibleIds(supabase, req.user.id, 'account')
    if (accessibleIds.length === 0) return []

    const { data, error } = await supabase
      .from('account_health_summary')
      .select('*')
      .in('id', accessibleIds)
      .order('username')

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /accounts/warning-scores — Risk levels for all accounts
  fastify.get('/warning-scores', { preHandler: fastify.authenticate }, async (req, reply) => {
    const accessibleIds = await getAccessibleIds(supabase, req.user.id, 'account')
    if (accessibleIds.length === 0) return []

    const { data, error } = await supabase
      .from('account_warning_scores')
      .select('*')
      .in('account_id', accessibleIds)

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /accounts/:id/health-signals — Recent signals for a specific account
  fastify.get('/:id/health-signals', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await canAccess(supabase, req.user.id, 'account', req.params.id)) {
      return reply.code(403).send({ error: 'No access' })
    }

    const { data, error } = await supabase
      .from('account_health_signals')
      .select('*')
      .eq('account_id', req.params.id)
      .order('detected_at', { ascending: false })
      .limit(50)

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /accounts/:id/avatar — redirect to R2-stored avatar or fallback
  fastify.get('/:id/avatar', async (req, reply) => {
    try {
      const { data: account } = await supabase
        .from('accounts')
        .select('avatar_url, fb_user_id')
        .eq('id', req.params.id)
        .single()

      if (!account) return reply.code(404).send({ error: 'Not found' })

      // Prefer R2 URL (set by check-health after upload)
      if (account.avatar_url) {
        return reply.redirect(302, account.avatar_url)
      }

      // Fallback: Graph API (may not work without token)
      if (account.fb_user_id) {
        return reply.redirect(302, `https://graph.facebook.com/${account.fb_user_id}/picture?type=large`)
      }

      return reply.code(404).send({ error: 'No avatar' })
    } catch {
      return reply.code(500).send({ error: 'Avatar error' })
    }
  })

  // NOTE: Old warmup-status and warmup endpoints removed.
  // Nurture system (GET /nurture/profiles, POST /nurture/profiles/:id/run) replaces them.

  // GET /accounts - List accounts user owns + accounts granted by admin
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const accessibleIds = await getAccessibleIds(supabase, req.user.id, 'account')

    let query = supabase.from('accounts').select('*, proxies(*)').order('created_at', { ascending: false })

    if (accessibleIds.length === 0) {
      return []
    }
    query = query.in('id', accessibleIds)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /accounts/:id - Get single account (owner or granted)
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await canAccess(supabase, req.user.id, 'account', req.params.id)) {
      return reply.code(403).send({ error: 'No access to this account' })
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('*, proxies(*), fanpages(*), fb_groups(*)')
      .eq('id', req.params.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /accounts - Add account (save only, no validation)
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string, username, browser_type, proxy_id, notes, fb_created_at, daily_budget } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)
    const fingerprint = generateFingerprint(fbUserId)

    // Merge user override (if any) with defaults — never insert empty/null budget
    const mergedBudget = { ...DEFAULT_DAILY_BUDGET, ...(daily_budget || {}) }

    const { data, error } = await supabase.from('accounts').insert({
      owner_id: req.user.id,
      username: username || (fbUserId ? `User ${fbUserId}` : 'Unknown'),
      fb_user_id: fbUserId,
      cookie_string,
      browser_type: browser_type || 'chromium',
      proxy_id: proxy_id || null,
      user_agent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      timezone: fingerprint.timezone,
      status: 'unknown',
      notes,
      fb_created_at: fb_created_at || null,
      daily_budget: mergedBudget,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /accounts/:id - Update account
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['username', 'browser_type', 'proxy_id', 'notes', 'is_active',
      'active_hours_start', 'active_hours_end', 'active_days',
      'min_interval_minutes', 'max_daily_posts', 'random_delay_minutes', 'fb_created_at']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /accounts/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // GET /accounts/:id/fanpages - List fanpages (paginated when offset param present, array otherwise)
  fastify.get('/:id/fanpages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const paginated = req.query.offset !== undefined
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const offset = parseInt(req.query.offset) || 0
    let query = supabase.from('fanpages').select('*').eq('account_id', req.params.id).order('created_at', { ascending: false })
    if (paginated) query = query.range(offset, offset + limit - 1)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    if (!paginated) return data || []
    return { items: data || [], hasMore: (data || []).length === limit }
  })

  // GET /accounts/:id/history - Publish history (paginated when offset param present)
  fastify.get('/:id/history', { preHandler: fastify.authenticate }, async (req, reply) => {
    const paginated = req.query.offset !== undefined
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const offset = parseInt(req.query.offset) || 0
    let query = supabase
      .from('publish_history')
      .select('id, status, published_at, target_type, target_name, final_caption, error_message, job_id, fb_post_id')
      .eq('account_id', req.params.id)
      .order('published_at', { ascending: false })
    if (paginated) query = query.range(offset, offset + limit - 1)
    else query = query.limit(50)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    const mapped = (data || []).map(h => ({
      id: h.id,
      status: h.status,
      action: h.target_type ? `Post → ${h.target_type}` : 'Published',
      detail: h.target_name || h.final_caption?.substring(0, 80) || null,
      created_at: h.published_at,
      error_message: h.error_message,
      job_id: h.job_id,
      fb_post_id: h.fb_post_id,
    }))
    if (!paginated) return mapped
    return { items: mapped, hasMore: mapped.length === limit }
  })

  // GET /accounts/:id/groups - List groups (paginated when offset param present, array otherwise)
  fastify.get('/:id/groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const paginated = req.query.offset !== undefined
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const offset = parseInt(req.query.offset) || 0
    let query = supabase.from('fb_groups').select('*').eq('account_id', req.params.id).order('created_at', { ascending: false })
    if (paginated) query = query.range(offset, offset + limit - 1)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    if (!paginated) return data || []
    return { items: data || [], hasMore: (data || []).length === limit }
  })

  // POST /accounts/:id/fetch-pages - Agent job to scrape fanpages from Facebook
  fastify.post('/:id/fetch-pages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_pages' }, status: 'pending', scheduled_at: new Date().toISOString(), created_by: req.user.id
    }).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Fetch pages queued', job_id: job.id }
  })

  // POST /accounts/:id/fetch-groups - Agent job to scrape groups from Facebook
  fastify.post('/:id/fetch-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_groups' }, status: 'pending', scheduled_at: new Date().toISOString(), created_by: req.user.id
    }).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Fetch groups queued', job_id: job.id }
  })

  // POST /accounts/:id/fetch-all - Agent job to scrape BOTH pages + groups (1 tab, sequential)
  fastify.post('/:id/fetch-all', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_all' }, status: 'pending', scheduled_at: new Date().toISOString(), created_by: req.user.id
    }).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Fetch all queued', job_id: job.id }
  })

  // POST /accounts/:id/quick-post - Quick post to page/group/profile (supports multi-target)
  // Targets format: [{ type: 'page'|'group'|'profile', id: uuid, rewrite?: bool }]
  // media_mode: 'selected' (use media_id) | 'random' (pick random from library) | 'none'
  fastify.post('/:id/quick-post', { preHandler: fastify.authenticate }, async (req, reply) => {
    const account_id = req.params.id
    const { target_type, target_id, targets, caption, hashtags, media_id, scheduled_at,
      post_type, privacy, spin_mode, media_mode, random_media_ids, random_source } = req.body || {}

    const effectiveMediaMode = media_mode || 'selected'

    if (!caption && !media_id && effectiveMediaMode !== 'random') {
      return reply.code(400).send({ error: 'Caption or media required' })
    }

    // Build targets array: support both old single-target and new multi-target format
    let targetList = []
    if (targets?.length) {
      // New format: targets = [{ type: 'page', id: uuid, rewrite?: bool }, ...]
      targetList = targets
    } else if (target_type) {
      // Old format: single target_type + target_id
      targetList = [{ type: target_type, id: target_id }]
    } else {
      return reply.code(400).send({ error: 'targets[] or target_type required' })
    }

    // Validate target types
    const jobTypeMap = { page: 'post_page', group: 'post_group', profile: 'post_profile' }
    for (const t of targetList) {
      if (!jobTypeMap[t.type]) return reply.code(400).send({ error: `Invalid target type: ${t.type}` })
    }

    // Check agent online (only needed if any browser-based targets exist)
    // Will be checked after target classification below

    // Verify account belongs to user
    const { data: account } = await supabase.from('accounts').select('id').eq('id', account_id).eq('owner_id', req.user.id).single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    // If media_mode is 'random', get available media IDs for random selection
    let availableMediaIds = []
    if (effectiveMediaMode === 'random') {
      if (random_media_ids?.length) {
        // User uploaded local files → use those specific IDs
        availableMediaIds = random_media_ids
      } else {
        // Random from library
        const { data: mediaItems } = await supabase
          .from('media')
          .select('id')
          .eq('owner_id', req.user.id)
          .limit(100)
        availableMediaIds = (mediaItems || []).map(m => m.id)
      }
    }

    // Normalize hashtags: string → array (frontend may send comma-separated string)
    const hashtagsArray = Array.isArray(hashtags)
      ? hashtags
      : typeof hashtags === 'string' && hashtags.trim()
        ? hashtags.split(/[,\s]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean)
        : []

    // Auto-create content record (with original caption)
    const { data: content, error: contentErr } = await supabase.from('contents').insert({
      owner_id: req.user.id,
      caption: caption || '',
      hashtags: hashtagsArray,
      media_id: effectiveMediaMode === 'selected' ? (media_id || null) : null,
      post_type: post_type || 'text',
      privacy: privacy || 'PUBLIC',
      spin_mode: spin_mode || 'none',
    }).select().single()
    if (contentErr) {
      req.log.error({ contentErr }, 'quick-post: content insert failed')
      return reply.code(500).send({ error: contentErr.message })
    }

    // Preload page access tokens to choose Graph job type when available
    console.log('[QUICK-POST] Debug: targetList', targetList.map(t => ({ type: t.type, id: t.id, name: t.name })))
    const pageTargetIds = targetList.filter(t => t.type === 'page' && t.id).map(t => t.id)
    const pageTokenMap = {}
    if (pageTargetIds.length > 0) {
      const { data: fanpages } = await supabase
        .from('fanpages')
        .select('id, access_token, posting_method')
        .in('id', pageTargetIds)
      for (const p of (fanpages || [])) {
        const method = p.posting_method || 'auto'
        if (method === 'access_token' && p.access_token) {
          pageTokenMap[p.id] = true
        } else if (method === 'auto' && p.access_token) {
          pageTokenMap[p.id] = true
        }
        // method === 'cookie' → never use Graph API
        console.log(`[QUICK-POST] Debug: fanpage ${p.id} method=${method} hasToken=${!!p.access_token} useGraph=${!!pageTokenMap[p.id]}`)
      }
    }
    console.log('[QUICK-POST] Debug: pageTokenMap', pageTokenMap)

    // Split targets: Graph API (direct post) vs Browser (job queue)
    const graphTargets = []
    const browserTargets = []
    for (const target of targetList) {
      if (target.type === 'page' && pageTokenMap[target.id] && !scheduled_at && !target.rewrite) {
        graphTargets.push(target)
      } else {
        browserTargets.push(target)
      }
    }

    const results = { direct: [], queued: [] }

    // === GRAPH API: Post directly from API server (instant) ===
    for (const target of graphTargets) {
      try {
        const { data: page } = await supabase
          .from('fanpages')
          .select('id, fb_page_id, name, access_token')
          .eq('id', target.id)
          .single()

        if (!page?.access_token) throw new Error('Missing access_token')

        // Build message
        let message = caption || ''
        if (hashtagsArray.length) {
          message += '\n\n' + hashtagsArray.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
        }

        // Get media URL if needed
        let mediaUrl = null
        let mediaType = null
        const mediaIdToUse = effectiveMediaMode === 'random' && availableMediaIds.length > 0
          ? availableMediaIds[Math.floor(Math.random() * availableMediaIds.length)]
          : media_id

        if (mediaIdToUse) {
          const { data: media } = await supabase.from('media').select('*').eq('id', mediaIdToUse).single()
          if (media) {
            const path = media.processed_path || media.original_path
            // If path is already a full URL, use it directly; otherwise prefix with R2 public URL
            if (path) {
              mediaUrl = path.startsWith('http') ? path : fastify.getR2PublicUrl(path)
            } else {
              mediaUrl = media.source_url
            }
            mediaType = media.type || 'image'
          }
        }

        // Post to Facebook Graph API
        const pageId = page.fb_page_id
        const token = page.access_token
        let fbPostId = null

        if (mediaUrl && mediaType === 'video') {
          const params = new URLSearchParams({ file_url: mediaUrl, access_token: token })
          if (message) params.append('description', message)
          const { data } = await require('axios').post(`https://graph.facebook.com/v18.0/${pageId}/videos`, params)
          fbPostId = data.id
        } else if (mediaUrl) {
          const params = new URLSearchParams({ url: mediaUrl, access_token: token })
          if (message) params.append('caption', message)
          const { data } = await require('axios').post(`https://graph.facebook.com/v18.0/${pageId}/photos`, params)
          fbPostId = data.id
        } else {
          const params = new URLSearchParams({ access_token: token })
          if (message) params.append('message', message)
          const { data } = await require('axios').post(`https://graph.facebook.com/v18.0/${pageId}/feed`, params)
          fbPostId = data.id
        }

        const postUrl = fbPostId ? `https://www.facebook.com/${fbPostId}` : null

        // Save publish history
        await supabase.from('publish_history').insert({
          content_id: content.id,
          account_id,
          target_type: 'page',
          target_fb_id: pageId,
          target_name: page.name,
          final_caption: message,
          fb_post_id: fbPostId,
          post_url: postUrl,
          status: 'success',
        })

        // Create a completed job record so it shows in ContentList
        await supabase.from('jobs').insert({
          type: 'post_page_graph',
          payload: { content_id: content.id, target_id: target.id, account_id, target_name: page.name },
          result: { page_name: page.name, fb_post_id: fbPostId, post_url: postUrl },
          status: 'done',
          scheduled_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          created_by: req.user.id,
        })

        // Update content status
        await supabase.from('contents').update({ status: 'published' }).eq('id', content.id)

        results.direct.push({ target: target.id, page: page.name, fb_post_id: fbPostId, post_url: postUrl, status: 'success' })
        console.log(`[QUICK-POST] Graph API direct post SUCCESS: ${page.name} -> ${fbPostId}`)
      } catch (err) {
        const fbError = err.response?.data?.error
        const errorMsg = fbError?.message || err.message
        const errorDetail = fbError ? JSON.stringify(fbError) : err.message
        req.log.error({ fbError: errorDetail, target: target.id }, `Graph API direct post FAILED: ${errorMsg}`)
        console.log(`[QUICK-POST] Graph API FAILED for ${target.id}: ${errorDetail}`)

        // Detect expired token and give clear message
        let userError = errorMsg
        if (fbError?.code === 190 || fbError?.error_subcode === 463 || errorMsg.includes('expired')) {
          userError = 'Access token đã hết hạn. Vui lòng cập nhật token mới trong Quản lý Fanpage.'
          // Mark page token as expired
          try { await supabase.from('fanpages').update({ token_status: 'expired' }).eq('id', target.id) } catch {}
        } else if (fbError?.code === 200 || fbError?.code === 10) {
          userError = 'Không có quyền đăng bài. Kiểm tra quyền Page token (pages_manage_posts).'
        }

        results.direct.push({ target: target.id, status: 'error', error: userError })
      }
    }

    // === BROWSER TARGETS: Create jobs for agent (with stagger delay) ===
    if (browserTargets.length > 0) {
      const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
      if (!agents?.length && results.direct.length === 0) {
        return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })
      }
    }
    const jobIds = []
    let cumulativeDelayMs = 0
    for (let i = 0; i < browserTargets.length; i++) {
      const target = browserTargets[i]
      if (i > 0) {
        cumulativeDelayMs += (1 + Math.random() * 3) * 60 * 1000
      }
      const jobScheduledAt = scheduled_at
        ? new Date(new Date(scheduled_at).getTime() + cumulativeDelayMs).toISOString()
        : new Date(Date.now() + cumulativeDelayMs).toISOString()

      const jobPayload = {
        content_id: content.id,
        account_id,
        ...(target.id && { target_id: target.id }),
      }
      if (target.rewrite) jobPayload.spin = true
      if (effectiveMediaMode === 'random' && availableMediaIds.length > 0) {
        jobPayload.media_id_override = availableMediaIds[Math.floor(Math.random() * availableMediaIds.length)]
      }

      const jobType = jobTypeMap[target.type]
      const { data: job, error: jobErr } = await supabase.from('jobs').insert({
        type: jobType,
        payload: jobPayload,
        status: 'pending',
        scheduled_at: jobScheduledAt,
        created_by: req.user.id,
      }).select().single()

      if (jobErr) {
        req.log.error({ jobErr, target }, 'quick-post: job insert failed')
        continue
      }
      jobIds.push(job.id)
      results.queued.push({ target: target.id, job_id: job.id })
    }

    if (results.direct.length === 0 && jobIds.length === 0) {
      return reply.code(500).send({ error: 'Failed to publish any posts' })
    }

    const directOk = results.direct.filter(r => r.status === 'success').length
    const totalQueued = jobIds.length
    const msg = [
      directOk > 0 ? `${directOk} posted instantly` : null,
      totalQueued > 0 ? `${totalQueued} queued for agent` : null,
    ].filter(Boolean).join(', ')

    return {
      message: msg,
      direct_results: results.direct,
      job_ids: jobIds,
      content_id: content.id,
    }
  })

  // POST /accounts/:id/check-health - Create job for agent to validate
  fastify.post('/:id/check-health', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!account) return reply.code(404).send({ error: 'Not found' })

    // Check if agent is online (heartbeat within last 30s)
    const { data: agents } = await supabase
      .from('agent_heartbeats')
      .select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString())
      .limit(1)

    if (!agents?.length) {
      return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })
    }

    // Create job for agent
    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health',
      payload: { account_id: req.params.id },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Update account status to show checking — defense-in-depth: scope to owner
    await supabase.from('accounts')
      .update({ status: 'checking' })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    return { message: 'Check queued', job_id: job.id }
  })

  // POST /accounts/:id/update-cookie - Update cookie (save only, agent validates later)
  fastify.post('/:id/update-cookie', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)

    const { data, error } = await supabase.from('accounts').update({
      cookie_string,
      fb_user_id: fbUserId || undefined,
      status: 'unknown',
    }).eq('id', req.params.id).eq('owner_id', req.user.id).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /accounts/bulk-import - Import multiple accounts (save only)
  fastify.post('/bulk-import', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookies, browser_type } = req.body
    if (!cookies?.length) return reply.code(400).send({ error: 'cookies array required' })

    const results = []
    for (const cookie_string of cookies) {
      try {
        const fbUserId = extractCUserId(cookie_string)
        const fingerprint = generateFingerprint(fbUserId)

        const { data, error } = await supabase.from('accounts').insert({
          owner_id: req.user.id,
          username: `User ${fbUserId}`,
          fb_user_id: fbUserId,
          cookie_string,
          browser_type: browser_type || 'chromium',
          user_agent: fingerprint.userAgent,
          viewport: fingerprint.viewport,
          timezone: fingerprint.timezone,
          status: 'unknown',
          daily_budget: { ...DEFAULT_DAILY_BUDGET },
        }).select().single()

        results.push({ fbUserId, success: !error, id: data?.id })
      } catch (err) {
        results.push({ cookie: cookie_string.substring(0, 20) + '...', success: false, error: err.message })
      }
    }

    return results
  })

  // ============================================
  // PERSONAL MESSENGER
  // ============================================

  // GET /accounts/:id/inbox — list personal messages from DB
  fastify.get('/:id/inbox', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await canAccess(supabase, req.user.id, 'account', req.params.id)) {
      return reply.code(403).send({ error: 'No access' })
    }

    const limit = parseInt(req.query.limit) || 50
    const { data, error } = await supabase
      .from('inbox_messages')
      .select('*')
      .eq('fanpage_id', req.params.id) // reuse fanpage_id field for account_id
      .eq('message_type', 'personal')
      .order('received_at', { ascending: false })
      .limit(limit)

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /accounts/:id/fetch-inbox — fetch personal messenger (cookie, 6h rate limit)
  fastify.post('/:id/fetch-inbox', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await canAccess(supabase, req.user.id, 'account', req.params.id)) {
      return reply.code(403).send({ error: 'No access' })
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    // Rate limit: 6h
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    if (account.last_inbox_fetched_at && account.last_inbox_fetched_at > sixHoursAgo) {
      return { fetched: 0, skipped: true, message: 'Da tai trong 6h qua' }
    }

    const messages = await fetchPersonalInbox(account, supabase)

    // Upsert — reuse inbox_messages table with message_type='personal'
    if (messages.length > 0) {
      const rows = messages.map(m => ({
        fanpage_id: req.params.id, // reuse for account_id
        fb_thread_id: m.fb_thread_id,
        fb_message_id: m.fb_message_id,
        sender_name: m.sender_name,
        sender_fb_id: m.sender_fb_id,
        message_text: m.message_text,
        message_type: 'personal',
        received_at: m.received_at,
      }))

      await supabase.from('inbox_messages').upsert(rows, { onConflict: 'fb_message_id' })
    }

    return { fetched: messages.length }
  })

  // POST /accounts/:id/reply-message — reply to personal message
  fastify.post('/:id/reply-message', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await canAccess(supabase, req.user.id, 'account', req.params.id)) {
      return reply.code(403).send({ error: 'No access' })
    }

    const { thread_id, reply_text } = req.body
    if (!thread_id || !reply_text) return reply.code(400).send({ error: 'thread_id and reply_text required' })

    const { data: account } = await supabase.from('accounts').select('*').eq('id', req.params.id).single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    await replyPersonalMessage(account, thread_id, reply_text, supabase)
    return { success: true }
  })
}
