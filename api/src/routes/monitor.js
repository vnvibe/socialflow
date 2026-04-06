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

  // ============================================
  // KEYWORDS CRUD
  // ============================================

  // GET /monitor/keywords - List all scan keywords
  fastify.get('/keywords', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('scan_keywords')
      .select('*, accounts(id, username, fb_user_id)')
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /monitor/keywords - Create keyword config
  fastify.post('/keywords', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { keyword, scan_type, account_id, target_group_ids, cron_expression, time_window_hours, topics } = req.body || {}

    if (!keyword?.trim()) return reply.code(400).send({ error: 'keyword required' })
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Verify account belongs to user
    const { data: account } = await supabase.from('accounts').select('id')
      .eq('id', account_id).eq('owner_id', req.user.id).single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    // Calculate next_scan_at from cron
    let next_scan_at = new Date().toISOString()
    if (cron_expression) {
      try {
        const cronParser = require('cron-parser')
        const interval = cronParser.parseExpression(cron_expression, {
          currentDate: new Date(),
          tz: 'Asia/Ho_Chi_Minh',
        })
        next_scan_at = interval.next().toDate().toISOString()
      } catch (e) {
        // Default: run in 1 hour
        next_scan_at = new Date(Date.now() + 3600000).toISOString()
      }
    }

    const { data, error } = await supabase.from('scan_keywords').insert({
      owner_id: req.user.id,
      keyword: keyword.trim(),
      scan_type: scan_type || 'group_posts',
      account_id,
      target_group_ids: target_group_ids || null,
      topics: topics || null,
      cron_expression: cron_expression || '0 */6 * * *',
      time_window_hours: time_window_hours || 24,
      is_active: true,
      next_scan_at,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /monitor/keywords/:id - Update keyword config
  fastify.put('/keywords/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['keyword', 'scan_type', 'account_id', 'target_group_ids',
      'cron_expression', 'time_window_hours', 'is_active', 'topics']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    // Recalculate next_scan_at if cron changed
    if (updates.cron_expression) {
      try {
        const cronParser = require('cron-parser')
        const interval = cronParser.parseExpression(updates.cron_expression, {
          currentDate: new Date(),
          tz: 'Asia/Ho_Chi_Minh',
        })
        updates.next_scan_at = interval.next().toDate().toISOString()
      } catch (e) { /* keep existing next_scan_at */ }
    }

    const { data, error } = await supabase
      .from('scan_keywords')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /monitor/keywords/:id - Delete keyword + cascade
  fastify.delete('/keywords/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('scan_keywords')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /monitor/keywords/:id/scan-now - Queue immediate scan job
  fastify.post('/keywords/:id/scan-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Get keyword config
    const { data: kw } = await supabase
      .from('scan_keywords')
      .select('*, accounts(id, fb_user_id)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!kw) return reply.code(404).send({ error: 'Keyword not found' })

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online' })

    // Determine job type
    let jobType
    if (kw.scan_type === 'discover_groups') jobType = 'discover_groups_keyword'
    else if (kw.scan_type === 'group_feed') jobType = 'scan_group_feed'
    else jobType = 'scan_group_keyword'

    // If group scan and no specific groups, get all groups for this account
    let groupIds = kw.target_group_ids
    if ((jobType === 'scan_group_keyword' || jobType === 'scan_group_feed') && (!groupIds || groupIds.length === 0)) {
      const { data: groups } = await supabase.from('fb_groups').select('fb_group_id')
        .eq('account_id', kw.account_id)
      groupIds = groups?.map(g => g.fb_group_id) || []
    }

    const { data: job, error } = await supabase.from('jobs').insert({
      type: jobType,
      payload: {
        account_id: kw.account_id,
        keyword: kw.keyword,
        keyword_id: kw.id,
        group_ids: groupIds,
        topics: kw.topics || [],
        time_window_hours: kw.time_window_hours,
        owner_id: req.user.id,
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Scan queued', job_id: job.id }
  })

  // ============================================
  // DISCOVERED POSTS
  // ============================================

  // GET /monitor/posts - List discovered posts
  fastify.get('/posts', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { keyword_id, group_id, search, from_date, to_date, following_only, min_score, sort_by, page = 1, limit = 50 } = req.query

    // Determine sort order
    const orderCol = sort_by === 'relevance' ? 'relevance_score' : 'discovered_at'

    let query = supabase
      .from('discovered_posts')
      .select('*, scan_keywords(keyword)', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order(orderCol, { ascending: false, nullsFirst: false })
      .range((page - 1) * limit, page * limit - 1)

    if (keyword_id) query = query.eq('keyword_id', keyword_id)
    if (group_id) query = query.eq('fb_group_id', group_id)
    if (following_only === 'true') query = query.eq('is_following', true)
    if (from_date) query = query.gte('discovered_at', from_date)
    if (to_date) query = query.lte('discovered_at', to_date)
    if (search) query = query.ilike('content_text', `%${search}%`)
    if (min_score) query = query.gte('relevance_score', parseInt(min_score))

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // POST /monitor/posts/:id/follow - Toggle follow
  fastify.post('/posts/:id/follow', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Get current state
    const { data: post } = await supabase
      .from('discovered_posts')
      .select('is_following')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { data, error } = await supabase
      .from('discovered_posts')
      .update({ is_following: !post.is_following })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /monitor/posts/:id
  fastify.delete('/posts/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('discovered_posts')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // ============================================
  // MONITORED GROUPS (Group Monitor feature)
  // ============================================

  // GET /monitor/watched-groups - List monitored groups with stats
  fastify.get('/watched-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { campaign_id, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('monitored_groups')
      .select('*, accounts(id, username, fb_user_id, status)', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (campaign_id) query = query.eq('campaign_id', campaign_id)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // POST /monitor/watched-groups - Create monitored group
  fastify.post('/watched-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const {
      campaign_id, account_id, group_fb_id, group_name, group_url,
      brand_keywords, brand_voice, brand_name,
      opportunity_threshold, scan_interval_minutes, scan_lookback_minutes
    } = req.body || {}

    if (!group_fb_id?.trim()) return reply.code(400).send({ error: 'group_fb_id required' })
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Verify account belongs to user
    const { data: account } = await supabase.from('accounts').select('id')
      .eq('id', account_id).eq('owner_id', req.user.id).single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const { data, error } = await supabase.from('monitored_groups').insert({
      owner_id: req.user.id,
      campaign_id: campaign_id || null,
      account_id,
      group_fb_id: group_fb_id.trim(),
      group_name: group_name || null,
      group_url: group_url || null,
      brand_keywords: brand_keywords || [],
      brand_voice: brand_voice || null,
      brand_name: brand_name || null,
      opportunity_threshold: opportunity_threshold || 7,
      scan_interval_minutes: scan_interval_minutes || 120,
      scan_lookback_minutes: scan_lookback_minutes || 180,
      is_active: true,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /monitor/watched-groups/:id - Update monitored group config
  fastify.put('/watched-groups/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = [
      'account_id', 'campaign_id', 'group_name', 'group_url',
      'brand_keywords', 'brand_voice', 'brand_name',
      'opportunity_threshold', 'scan_interval_minutes', 'scan_lookback_minutes', 'is_active'
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('monitored_groups')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /monitor/watched-groups/:id - Delete monitored group
  fastify.delete('/watched-groups/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('monitored_groups')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // GET /monitor/watched-groups/:id/opportunities - List opportunities for a group
  fastify.get('/watched-groups/:id/opportunities', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, min_score, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('group_opportunities')
      .select('*', { count: 'exact' })
      .eq('monitored_group_id', req.params.id)
      .eq('owner_id', getOwnerId(req))
      .order('detected_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) query = query.eq('status', status)
    if (min_score) query = query.gte('opportunity_score', parseInt(min_score))

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // POST /monitor/watched-groups/:id/scan-now - Queue immediate scan job
  fastify.post('/watched-groups/:id/scan-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: group } = await supabase
      .from('monitored_groups')
      .select('*, accounts(id, status, is_active)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!group) return reply.code(404).send({ error: 'Monitored group not found' })
    if (!group.accounts?.is_active) return reply.code(400).send({ error: 'Account not active' })

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'campaign_group_monitor',
      payload: {
        monitored_group_id: group.id,
        account_id: group.account_id,
        campaign_id: group.campaign_id,
        owner_id: req.user.id,
        group_fb_id: group.group_fb_id,
        group_name: group.group_name,
        group_url: group.group_url,
        brand_keywords: group.brand_keywords,
        brand_name: group.brand_name,
        brand_voice: group.brand_voice,
        opportunity_threshold: group.opportunity_threshold || 7,
        scan_lookback_minutes: group.scan_lookback_minutes || 180,
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Group monitor scan queued', job_id: job.id }
  })

  // GET /monitor/group-performance - View from group_performance
  fastify.get('/group-performance', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { campaign_id } = req.query

    let query = supabase
      .from('group_performance')
      .select('*')
      .eq('owner_id', getOwnerId(req))

    if (campaign_id) query = query.eq('campaign_id', campaign_id)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // ============================================
  // DISCOVERED GROUPS
  // ============================================

  // GET /monitor/groups - List discovered groups
  fastify.get('/groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { keyword_id, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('discovered_groups')
      .select('*, scan_keywords(keyword)', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order('discovered_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (keyword_id) query = query.eq('keyword_id', keyword_id)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // POST /monitor/groups/:id/join - Queue job to join group
  fastify.post('/groups/:id/join', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: group } = await supabase
      .from('discovered_groups')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!group) return reply.code(404).send({ error: 'Group not found' })

    const { account_id } = req.body || {}
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online' })

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'join_group',
      payload: {
        account_id,
        fb_group_id: group.fb_group_id,
        group_url: group.url,
        discovered_group_id: group.id,
        owner_id: req.user.id,
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Join group queued', job_id: job.id }
  })

  // DELETE /monitor/groups/:id
  fastify.delete('/groups/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('discovered_groups')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // ============================================
  // ENGAGEMENT
  // ============================================

  // GET /monitor/engagement - List engagement snapshots
  fastify.get('/engagement', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_type, from_date, to_date, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('engagement_snapshots')
      .select('*', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order('checked_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (source_type) query = query.eq('source_type', source_type)
    if (from_date) query = query.gte('checked_at', from_date)
    if (to_date) query = query.lte('checked_at', to_date)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // GET /monitor/engagement/summary - Aggregated engagement data
  fastify.get('/engagement/summary', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_type, days = 7 } = req.query
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

    // Get latest snapshot per post (most recent checked_at)
    let query = supabase
      .from('engagement_snapshots')
      .select('*')
      .eq('owner_id', getOwnerId(req))
      .gte('checked_at', since)
      .order('checked_at', { ascending: false })

    if (source_type) query = query.eq('source_type', source_type)

    const { data: snapshots, error } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // Deduplicate: keep latest per fb_post_id
    const seen = new Map()
    for (const s of (snapshots || [])) {
      if (!seen.has(s.fb_post_id)) seen.set(s.fb_post_id, s)
    }
    const unique = [...seen.values()]

    const totalReactions = unique.reduce((sum, s) => sum + (s.reactions || 0), 0)
    const totalComments = unique.reduce((sum, s) => sum + (s.comments || 0), 0)
    const totalShares = unique.reduce((sum, s) => sum + (s.shares || 0), 0)

    // Top performing posts (by total engagement)
    const topPosts = unique
      .map(s => ({ ...s, total: (s.reactions || 0) + (s.comments || 0) + (s.shares || 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    return {
      total_posts: unique.length,
      total_reactions: totalReactions,
      total_comments: totalComments,
      total_shares: totalShares,
      top_posts: topPosts,
      period_days: Number(days),
    }
  })

  // POST /monitor/engagement/check-now - Queue engagement check job
  fastify.post('/engagement/check-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, source_type } = req.body || {}
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online' })

    // Collect posts to check
    const postIds = []

    // Own posts (from publish_history within last 48h)
    if (!source_type || source_type === 'own_post') {
      const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
      const { data: ownPosts } = await supabase
        .from('publish_history')
        .select('id, fb_post_id')
        .eq('account_id', account_id)
        .eq('status', 'success')
        .gte('published_at', since48h)
        .not('fb_post_id', 'is', null)

      for (const p of (ownPosts || [])) {
        postIds.push({ fb_post_id: p.fb_post_id, source_type: 'own_post', source_id: p.id })
      }
    }

    // Discovered posts (following or within 24h)
    if (!source_type || source_type === 'discovered_post') {
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const { data: discovered } = await supabase
        .from('discovered_posts')
        .select('id, fb_post_id')
        .eq('owner_id', req.user.id)
        .not('fb_post_id', 'is', null)
        .or(`is_following.eq.true,discovered_at.gte.${since24h}`)

      for (const p of (discovered || [])) {
        postIds.push({ fb_post_id: p.fb_post_id, source_type: 'discovered_post', source_id: p.id })
      }
    }

    if (postIds.length === 0) return { message: 'No posts to check', job_id: null }

    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_engagement',
      payload: {
        account_id,
        post_ids: postIds,
        owner_id: req.user.id,
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { message: `Engagement check queued for ${postIds.length} posts`, job_id: job.id }
  })

  // ============================================
  // AI REVIEW (called by agent)
  // ============================================

  // POST /monitor/ai-review - AI reviews posts for relevance
  fastify.post('/ai-review', async (req, reply) => {
    // Authenticate via agent key header
    const agentKey = req.headers['x-agent-key']
    if (!agentKey || agentKey !== process.env.AGENT_SECRET_KEY) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const { owner_id, topics, posts, min_score } = req.body || {}
    if (!owner_id || !topics?.length || !posts?.length) {
      return reply.code(400).send({ error: 'owner_id, topics[], and posts[] required' })
    }

    try {
      const { getOrchestratorForUser } = require('../services/ai/orchestrator')
      const orchestrator = await getOrchestratorForUser(owner_id, supabase)
      const config = orchestrator.getFunctionConfig('relevance_review')

      // Build prompt for batch review
      const postsText = posts.map((p, i) =>
        `[${i}] ${(p.content_text || '').substring(0, 500)}`
      ).join('\n---\n')

      const systemPrompt = `You are a content relevance reviewer. Given a list of social media posts and target topics, rate each post's relevance on a 1-5 scale:
1 = Completely irrelevant
2 = Slightly related but not useful
3 = Somewhat relevant
4 = Relevant and useful
5 = Highly relevant, perfect match

Target topics: ${topics.join(', ')}

Respond ONLY with a valid JSON array. Each element must have: index (number), score (1-5), reason (string, max 50 chars Vietnamese).
Example: [{"index":0,"score":4,"reason":"Bài về mua bán đúng chủ đề"},{"index":1,"score":1,"reason":"Không liên quan"}]`

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: postsText }
      ]

      const result = await orchestrator.call('relevance_review', messages)

      // Parse AI response
      let reviews = []
      try {
        const content = result.content || result.choices?.[0]?.message?.content || ''
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = content.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          reviews = JSON.parse(jsonMatch[0])
        }
      } catch (parseErr) {
        console.error('[AI-REVIEW] Parse error:', parseErr.message)
        return reply.code(200).send({ reviews: [], error: 'AI response parse failed' })
      }

      // Map reviews back to posts and filter by min_score
      const threshold = min_score || 3
      const results = reviews
        .filter(r => typeof r.index === 'number' && typeof r.score === 'number')
        .map(r => ({
          fb_post_id: posts[r.index]?.fb_post_id,
          relevance_score: r.score,
          ai_summary: r.reason || '',
          passes: r.score >= threshold,
        }))
        .filter(r => r.fb_post_id)

      return { reviews: results, total: results.length, passing: results.filter(r => r.passes).length }
    } catch (err) {
      console.error('[AI-REVIEW] Error:', err.message)
      return reply.code(500).send({ error: err.message })
    }
  })
}
