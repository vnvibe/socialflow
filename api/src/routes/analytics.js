function formatJobDescription(job) {
  const type = job.type || ''
  const payload = job.payload || {}
  const typeLabels = {
    post_page: 'Post to page',
    post_group: 'Post to group',
    post_profile: 'Post to profile',
    post_page_graph: 'Post to page (Graph)',
    check_health: 'Health check',
    fetch_pages: 'Fetch pages',
    fetch_groups: 'Fetch groups',
    scan_group_keyword: 'Scan group for keywords',
    scan_group_feed: 'Scan group feed',
    comment_post: 'Comment on post',
    discover_groups_keyword: 'Discover groups',
    campaign_post: 'Campaign post',
    check_engagement: 'Check engagement',
    fetch_source_cookie: 'Fetch source',
    resolve_group: 'Resolve group',
  }
  let desc = typeLabels[type] || type
  if (payload.target_name) desc += `: ${payload.target_name}`
  return desc
}

module.exports = async (fastify) => {
  const { supabase } = fastify

  async function isAdmin(userId) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single()
    return data?.role === 'admin'
  }

  // GET /analytics/dashboard - Dashboard stats
  // STRICT: every user only sees own data
  fastify.get('/dashboard', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.query.as_user || req.user.id
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Get user's account IDs
    const { data: userAccounts } = await supabase.from('accounts').select('id').eq('owner_id', userId)
    const userAccountIds = (userAccounts || []).map(a => a.id)

    // All queries scoped to this user only
    const accountsQuery = supabase.from('accounts').select('id', { count: 'exact' }).eq('owner_id', userId).eq('is_active', true)

    const postsTodayQuery = userAccountIds.length > 0
      ? supabase.from('publish_history').select('id', { count: 'exact' }).eq('status', 'success').gte('published_at', todayISO).in('account_id', userAccountIds)
      : { count: 0 }

    const jobsQuery = supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'pending').eq('created_by', userId)

    const inboxQuery = supabase.from('inbox_messages').select('id, fanpages!inner(*, accounts!inner(owner_id))', { count: 'exact' }).eq('is_read', false).eq('fanpages.accounts.owner_id', userId)

    const recentPostsQuery = userAccountIds.length > 0
      ? supabase.from('publish_history').select('published_at, status').gte('published_at', sevenDaysAgo).eq('status', 'success').in('account_id', userAccountIds).order('published_at', { ascending: true })
      : { data: [] }

    const [accounts, postsToday, jobsPending, unreadInbox, recentPosts] = await Promise.all([
      accountsQuery, postsTodayQuery, jobsQuery, inboxQuery, recentPostsQuery
    ])

    // Group posts by day for chart
    const dailyPosts = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().split('T')[0]
      dailyPosts[key] = 0
    }
    for (const post of (recentPosts.data || [])) {
      const key = post.published_at?.split('T')[0]
      if (key && dailyPosts[key] !== undefined) dailyPosts[key]++
    }

    const result = {
      stats: {
        total_accounts: accounts.count || 0,
        posts_today: postsToday.count || 0,
        jobs_pending: jobsPending.count || 0,
        unread_inbox: unreadInbox.count || 0
      },
      chart: Object.entries(dailyPosts).map(([date, count]) => ({ date, count })),
    }

    return result
  })

  // GET /analytics/accounts - Account performance (own data only)
  fastify.get('/accounts', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.query.as_user || req.user.id
    const { data, error } = await supabase.from('accounts')
      .select('id, username, status, total_posts, posts_today, last_used_at')
      .eq('owner_id', userId)
      .order('total_posts', { ascending: false })
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /analytics/history - Publish history (own data only)
  fastify.get('/history', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50, offset = 0, status } = req.query
    const userId = req.query.as_user || req.user.id

    const { data: userAccounts } = await supabase.from('accounts').select('id').eq('owner_id', userId)
    const userAccountIds = (userAccounts || []).map(a => a.id)
    if (!userAccountIds.length) return []

    let query = supabase
      .from('publish_history')
      .select('*')
      .in('account_id', userAccountIds)
      .order('published_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /analytics/dashboard-v2 - Card-based dashboard (STRICT: own data only)
  fastify.get('/dashboard-v2', { preHandler: fastify.authenticate }, async (req) => {
    const userId = req.query.as_user || req.user.id

    // 1. Get OWN accounts with avatars
    const accountsQuery = supabase
      .from('accounts')
      .select('id, username, fb_user_id, avatar_url, status, is_active, posts_today, max_daily_posts, last_used_at')
      .eq('owner_id', userId)
      .eq('is_active', true)
      .order('username')

    // 2. Get OWN campaigns with roles
    const campaignsQuery = supabase
      .from('campaigns')
      .select('id, name, status, is_active, campaign_roles(id, name, role_type, account_ids, mission, is_active)')
      .eq('owner_id', userId)

    // 3. Get OWN pending jobs
    const jobsQuery = supabase
      .from('jobs')
      .select('id, type, payload, scheduled_at, status')
      .eq('status', 'pending')
      .eq('created_by', userId)
      .order('scheduled_at', { ascending: true })
      .limit(10)

    // 4. Get agent status
    const agentQuery = supabase
      .from('agent_heartbeats')
      .select('agent_id, last_seen')
      .gte('last_seen', new Date(Date.now() - 60000).toISOString())

    // 5. OWN leads stats
    const leadsQuery = supabase
      .from('leads')
      .select('status')
      .eq('owner_id', userId)

    const [accountsRes, campaignsRes, jobsRes, agentRes, leadsRes] = await Promise.all([
      accountsQuery, campaignsQuery, jobsQuery, agentQuery, leadsQuery,
    ])

    const accounts = accountsRes.data || []
    const campaigns = campaignsRes.data || []
    const pendingJobs = jobsRes.data || []
    const agents = agentRes.data || []
    const leadsData = leadsRes.data || []

    // Build per-account role/routine mapping
    const accountMap = {}
    for (const acc of accounts) {
      accountMap[acc.id] = {
        ...acc,
        total_routines: 0,
        active_routines: 0,
        campaign_roles: [],
        next_scheduled_at: null,
        role_description: null,
      }
    }

    // Map campaign roles to accounts
    for (const c of campaigns) {
      for (const role of (c.campaign_roles || [])) {
        for (const accId of (role.account_ids || [])) {
          if (accountMap[accId]) {
            accountMap[accId].total_routines++
            if (role.is_active && (c.status === 'running' || c.is_active)) {
              accountMap[accId].active_routines++
            }
            accountMap[accId].campaign_roles.push({
              role_name: role.name,
              role_type: role.role_type,
              campaign_name: c.name,
              campaign_status: c.status,
              mission: role.mission,
            })
            if (!accountMap[accId].role_description && role.mission) {
              accountMap[accId].role_description = role.mission
            }
          }
        }
      }
    }

    // Map next scheduled job per account
    for (const job of pendingJobs) {
      const accId = job.payload?.account_id
      if (accId && accountMap[accId] && !accountMap[accId].next_scheduled_at) {
        accountMap[accId].next_scheduled_at = job.scheduled_at
      }
    }

    // Next task overall
    const nextTask = pendingJobs[0] ? {
      description: formatJobDescription(pendingJobs[0]),
      scheduled_at: pendingJobs[0].scheduled_at,
      type: pendingJobs[0].type,
      account_id: pendingJobs[0].payload?.account_id,
    } : null

    // Leads stats
    const leadsByStatus = {}
    for (const l of leadsData) {
      leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1
    }

    return {
      agent: { online: agents.length > 0, count: agents.length },
      nextTask,
      accounts: Object.values(accountMap),
      stats: {
        total_leads: leadsData.length,
        discovered: leadsByStatus.discovered || 0,
        friend_sent: leadsByStatus.friend_sent || 0,
        followed: leadsByStatus.followed || 0,
        connected: leadsByStatus.connected || 0,
      },
    }
  })

  // GET /analytics/activity - Activity log
  fastify.get('/activity', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50 } = req.query

    const { data, error } = await supabase
      .from('campaign_activity_log')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })
}
