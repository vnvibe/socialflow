const { extractCUserId, generateFingerprint } = require('../services/facebook/fb-auth')

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

  // GET /accounts - List all accounts for current user
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, proxies(*)')
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /accounts/:id - Get single account
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, proxies(*), fanpages(*), fb_groups(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /accounts - Add account (save only, no validation)
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string, username, browser_type, proxy_id, notes } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)
    const fingerprint = generateFingerprint(fbUserId)

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
      notes
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /accounts/:id - Update account
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['username', 'browser_type', 'proxy_id', 'notes', 'is_active',
      'active_hours_start', 'active_hours_end', 'active_days',
      'min_interval_minutes', 'max_daily_posts', 'random_delay_minutes']
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

  // GET /accounts/:id/fanpages - List fanpages for specific account
  fastify.get('/:id/fanpages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fanpages')
      .select('*')
      .eq('account_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /accounts/:id/groups - List groups for specific account
  fastify.get('/:id/groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fb_groups')
      .select('*')
      .eq('account_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /accounts/:id/fetch-pages - Agent job to scrape fanpages from Facebook
  fastify.post('/:id/fetch-pages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_pages' }, status: 'pending', scheduled_at: new Date().toISOString()
    }).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Fetch pages queued', job_id: job.id }
  })

  // POST /accounts/:id/fetch-groups - Agent job to scrape groups from Facebook
  fastify.post('/:id/fetch-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_groups' }, status: 'pending', scheduled_at: new Date().toISOString()
    }).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Fetch groups queued', job_id: job.id }
  })

  // POST /accounts/:id/fetch-all - Agent job to scrape BOTH pages + groups (1 tab, sequential)
  fastify.post('/:id/fetch-all', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health', payload: { account_id: req.params.id, action: 'fetch_all' }, status: 'pending', scheduled_at: new Date().toISOString()
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
          await supabase.from('fanpages').update({ token_status: 'expired' }).eq('id', target.id).catch(() => {})
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
      scheduled_at: new Date().toISOString()
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Update account status to show checking
    await supabase.from('accounts').update({ status: 'checking' }).eq('id', req.params.id)

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
          status: 'unknown'
        }).select().single()

        results.push({ fbUserId, success: !error, id: data?.id })
      } catch (err) {
        results.push({ cookie: cookie_string.substring(0, 20) + '...', success: false, error: err.message })
      }
    }

    return results
  })
}
