const { getOrchestratorForUser } = require('../services/ai/orchestrator')
const { spin } = require('../services/spin-engine')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /content/top-performing - Top performing content for recycling
  fastify.get('/top-performing', { preHandler: fastify.authenticate }, async (req, reply) => {
    const limit = parseInt(req.query.limit) || 10

    try {
      // Get user's account IDs
      const { data: userAccounts } = await supabase
        .from('accounts')
        .select('id')
        .eq('owner_id', req.user.id)
      const userAccountIds = (userAccounts || []).map(a => a.id)
      if (!userAccountIds.length) return []

      // Fetch publish history with engagement data — filtered by user's accounts
      const { data: history } = await supabase
        .from('publish_history')
        .select('content_id, reach, reactions, comments, shares, final_caption, target_name, published_at')
        .eq('status', 'success')
        .not('content_id', 'is', null)
        .in('account_id', userAccountIds)
        .order('published_at', { ascending: false })
        .limit(200)

      if (!history?.length) return []

      // Aggregate engagement per content_id
      const contentStats = {}
      for (const h of history) {
        if (!contentStats[h.content_id]) {
          contentStats[h.content_id] = {
            content_id: h.content_id,
            total_reach: 0,
            total_reactions: 0,
            total_comments: 0,
            total_shares: 0,
            post_count: 0,
            last_caption: h.final_caption,
            last_target: h.target_name,
            last_posted: h.published_at,
          }
        }
        const s = contentStats[h.content_id]
        s.total_reach += h.reach || 0
        s.total_reactions += h.reactions || 0
        s.total_comments += h.comments || 0
        s.total_shares += h.shares || 0
        s.post_count++
      }

      // Score and sort
      const scored = Object.values(contentStats).map(s => ({
        ...s,
        engagement_score: s.total_reactions * 1 + s.total_comments * 3 + s.total_shares * 5 + s.total_reach * 0.01,
      }))
      scored.sort((a, b) => b.engagement_score - a.engagement_score)

      // Fetch content details for top items
      const topIds = scored.slice(0, limit).map(s => s.content_id)
      const { data: contents } = await supabase
        .from('contents')
        .select('id, caption, hashtags, post_type, media_id')
        .in('id', topIds)

      const contentMap = {}
      for (const c of (contents || [])) contentMap[c.id] = c

      return scored.slice(0, limit).map(s => ({
        ...s,
        content: contentMap[s.content_id] || null,
      }))
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /content - List contents with publish status
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('contents')
      .select('*, media(*)')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    if (!data?.length) return data

    // Fetch recent posting jobs to determine publish status per content
    const { data: recentJobs } = await supabase
      .from('jobs')
      .select('id, type, status, payload, result, scheduled_at, finished_at, error_message')
      .in('type', ['post_page', 'post_page_graph', 'post_group', 'post_profile'])
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false })
      .limit(500)

    // Fetch account names for target resolution
    const accountIds = [...new Set((recentJobs || []).map(j => j.payload?.account_id).filter(Boolean))]
    const accountMap = {}
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, username')
        .in('id', accountIds)
      for (const a of (accounts || [])) accountMap[a.id] = a.username || 'Tài khoản'
    }

    // Resolve page and group names dynamically
    const pageIds = [...new Set((recentJobs || []).filter(j => j.type === 'post_page' || j.type === 'post_page_graph').map(j => j.payload?.target_id).filter(Boolean))]
    const pageMap = {}
    if (pageIds.length > 0) {
      const { data: pages } = await supabase.from('fanpages').select('id, name').in('id', pageIds)
      for (const p of (pages || [])) pageMap[p.id] = p.name
    }

    const groupIds = [...new Set((recentJobs || []).filter(j => j.type === 'post_group').map(j => j.payload?.target_id).filter(Boolean))]
    const groupMap = {}
    if (groupIds.length > 0) {
      const { data: groups } = await supabase.from('fb_groups').select('id, name').in('id', groupIds)
      for (const g of (groups || [])) groupMap[g.id] = g.name
    }

    // Build map: content_id → { publish_status, jobs[] }
    const contentJobsMap = {}
    for (const job of (recentJobs || [])) {
      const cid = job.payload?.content_id
      if (!cid) continue
      if (!contentJobsMap[cid]) contentJobsMap[cid] = []

      // Resolve target name: from result (done) → payload target_id → account name
      const targetName = job.result?.page_name || job.result?.group_name
        || job.payload?.target_name
        || ((job.type === 'post_page' || job.type === 'post_page_graph') && job.payload?.target_id ? pageMap[job.payload.target_id] : null)
        || (job.type === 'post_group' && job.payload?.target_id ? groupMap[job.payload.target_id] : null)
        || (job.payload?.account_id ? accountMap[job.payload.account_id] : null)

      const typeLabel = (job.type === 'post_page' || job.type === 'post_page_graph') ? 'Page'
        : job.type === 'post_group' ? 'Group'
        : job.type === 'post_profile' ? 'Profile' : job.type

      contentJobsMap[cid].push({
        id: job.id,
        type: job.type,
        type_label: typeLabel,
        status: job.status,
        target_name: targetName,
        account_name: job.payload?.account_id ? accountMap[job.payload.account_id] : null,
        post_url: job.result?.post_url || null,
        scheduled_at: job.scheduled_at,
        finished_at: job.finished_at,
        error_message: job.error_message,
      })
    }

    // Attach publish info to each content
    return data.map(content => {
      const jobs = contentJobsMap[content.id] || []
      let publish_status = null // never published

      if (jobs.length > 0) {
        const hasRunning = jobs.some(j => j.status === 'running' || j.status === 'claimed')
        const hasPending = jobs.some(j => j.status === 'pending')
        const hasDone = jobs.some(j => j.status === 'done')
        const allFailed = jobs.every(j => j.status === 'failed')

        if (hasRunning) publish_status = 'running'
        else if (hasPending) publish_status = 'pending'
        else if (hasDone) publish_status = 'done'
        else if (allFailed) publish_status = 'failed'
      }

      return {
        ...content,
        publish_status,
        publish_jobs: jobs.slice(0, 5), // latest 5 jobs
      }
    })
  })

  // GET /content/:id — includes publish jobs + account info
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('contents')
      .select('*, media(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })

    // Fetch publish jobs for this content
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, type, status, payload, result, scheduled_at, finished_at, error_message')
      .in('type', ['post_page', 'post_page_graph', 'post_group', 'post_profile'])
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    const contentJobs = (jobs || []).filter(j => j.payload?.content_id === req.params.id)

    // Resolve account names
    const accountIds = [...new Set(contentJobs.map(j => j.payload?.account_id).filter(Boolean))]
    const accountMap = {}
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, username')
        .in('id', accountIds)
      for (const a of (accounts || [])) accountMap[a.id] = a.username || 'Tài khoản'
    }

    // Resolve page and group names dynamically
    const pageIds = [...new Set(contentJobs.filter(j => j.type === 'post_page' || j.type === 'post_page_graph').map(j => j.payload?.target_id).filter(Boolean))]
    const pageMap = {}
    if (pageIds.length > 0) {
      const { data: pages } = await supabase.from('fanpages').select('id, name').in('id', pageIds)
      for (const p of (pages || [])) pageMap[p.id] = p.name
    }

    const groupIds = [...new Set(contentJobs.filter(j => j.type === 'post_group').map(j => j.payload?.target_id).filter(Boolean))]
    const groupMap = {}
    if (groupIds.length > 0) {
      const { data: groups } = await supabase.from('fb_groups').select('id, name').in('id', groupIds)
      for (const g of (groups || [])) groupMap[g.id] = g.name
    }

    const publish_jobs = contentJobs.map(job => ({
      id: job.id,
      type: job.type,
      type_label: (job.type === 'post_page' || job.type === 'post_page_graph') ? 'Page' : job.type === 'post_group' ? 'Group' : 'Profile',
      status: job.status,
      target_name: job.result?.page_name || job.result?.group_name || job.payload?.target_name
        || ((job.type === 'post_page' || job.type === 'post_page_graph') && job.payload?.target_id ? pageMap[job.payload.target_id] : null)
        || (job.type === 'post_group' && job.payload?.target_id ? groupMap[job.payload.target_id] : null)
        || (job.payload?.account_id ? accountMap[job.payload.account_id] : null),
      account_name: job.payload?.account_id ? accountMap[job.payload.account_id] : null,
      post_url: job.result?.post_url || null,
      scheduled_at: job.scheduled_at,
      finished_at: job.finished_at,
      error_message: job.error_message,
    }))

    return { ...data, publish_jobs }
  })

  // GET /content/publish-history - List user's published posts
  fastify.get('/publish-history', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50, offset = 0, status } = req.query

    // Get user's account IDs to filter
    const { data: userAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_id', req.user.id)
    const userAccountIds = (userAccounts || []).map(a => a.id)
    if (!userAccountIds.length) return { data: [], total: 0 }

    let query = supabase
      .from('publish_history')
      .select('*', { count: 'exact' })
      .in('account_id', userAccountIds)
      .order('published_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count }
  })

  // POST /content - Create content
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { media_id, post_type, caption, hashtags, link_url, privacy, spin_mode, spin_template } = req.body

    const { data, error } = await supabase.from('contents').insert({
      owner_id: req.user.id,
      media_id, post_type, caption, hashtags, link_url,
      privacy: privacy || 'PUBLIC',
      spin_mode: spin_mode || 'none',
      spin_template
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /content/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['caption', 'hashtags', 'link_url', 'privacy', 'spin_mode', 'spin_template', 'media_id', 'post_type']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('contents')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) {
      req.log.error({ error, updates }, 'PUT /content/:id failed')
      return reply.code(500).send({ error: error.message || 'Database error' })
    }
    return data
  })

  // DELETE /content/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const id = req.params.id
    const ownerId = req.user.id

    // Delete related jobs (queue) and publish_history first to avoid FK issues
    const deleteJobs = await supabase
      .from('jobs')
      .delete()
      .eq('payload->>content_id', id)
      .eq('created_by', ownerId)
    if (deleteJobs.error) return reply.code(500).send({ error: deleteJobs.error.message })

    const deleteHistory = await supabase
      .from('publish_history')
      .delete()
      .eq('content_id', id)
    if (deleteHistory.error) return reply.code(500).send({ error: deleteHistory.error.message })

    const { error } = await supabase.from('contents').delete().eq('id', id).eq('owner_id', ownerId)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /content/:id/generate-caption - AI generate caption
  fastify.post('/:id/generate-caption', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { prompt, provider, model } = req.body

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const result = await orchestrator.call('caption_gen', [
      { role: 'user', content: prompt || 'Write a compelling Facebook caption for this content.' }
    ], { ...(provider && { provider }), ...(model && { model }) })

    return { caption: result.text, tokens: { input: result.inputTokens, output: result.outputTokens } }
  })

  // POST /content/:id/generate-hashtags - AI generate hashtags
  fastify.post('/:id/generate-hashtags', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: content } = await supabase.from('contents').select('caption').eq('id', req.params.id).single()

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const result = await orchestrator.call('hashtag_gen', [
      { role: 'user', content: `Generate 10-15 relevant hashtags for this caption: "${content?.caption}". Return as JSON array.` }
    ])

    try {
      const hashtags = JSON.parse(result.text)
      return { hashtags }
    } catch {
      return { hashtags: result.text.match(/#\w+/g) || [] }
    }
  })

  // POST /content/:id/spin-preview - Preview spin variations
  fastify.post('/:id/spin-preview', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { count, mode } = req.body
    const { data: content } = await supabase.from('contents').select('caption, spin_mode, spin_template').eq('id', req.params.id).single()
    if (!content) return reply.code(404).send({ error: 'Not found' })

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const variants = await spin(
      content.spin_template || content.caption,
      mode || content.spin_mode || 'basic',
      count || 5,
      orchestrator
    )

    return { variants }
  })

}
