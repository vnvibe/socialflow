module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /analytics/dashboard - Dashboard stats
  fastify.get('/dashboard', { preHandler: fastify.authenticate }, async (req, reply) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Get user's account IDs for filtering publish_history
    const { data: userAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_id', req.user.id)
    const userAccountIds = (userAccounts || []).map(a => a.id)

    const [accounts, postsToday, jobsPending, unreadInbox, recentPosts] = await Promise.all([
      // Total active accounts
      supabase.from('accounts').select('id', { count: 'exact' }).eq('owner_id', req.user.id).eq('is_active', true),
      // Posts today — only user's accounts
      userAccountIds.length > 0
        ? supabase.from('publish_history').select('id', { count: 'exact' }).eq('status', 'success').gte('published_at', todayISO).in('account_id', userAccountIds)
        : { count: 0 },
      // Pending jobs
      supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'pending').eq('created_by', req.user.id),
      // Unread inbox — only user's fanpages
      supabase.from('inbox_messages').select('id, fanpages!inner(*, accounts!inner(owner_id))', { count: 'exact' }).eq('is_read', false).eq('fanpages.accounts.owner_id', req.user.id),
      // Posts last 7 days (for chart) — only user's accounts
      userAccountIds.length > 0
        ? supabase.from('publish_history')
            .select('published_at, status')
            .gte('published_at', sevenDaysAgo)
            .eq('status', 'success')
            .in('account_id', userAccountIds)
            .order('published_at', { ascending: true })
        : { data: [] },
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

    return {
      stats: {
        total_accounts: accounts.count || 0,
        posts_today: postsToday.count || 0,
        jobs_pending: jobsPending.count || 0,
        unread_inbox: unreadInbox.count || 0
      },
      chart: Object.entries(dailyPosts).map(([date, count]) => ({ date, count }))
    }
  })

  // GET /analytics/accounts - Account performance
  fastify.get('/accounts', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, username, status, total_posts, posts_today, last_used_at')
      .eq('owner_id', req.user.id)
      .order('total_posts', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /analytics/history - Publish history (filtered by user's accounts)
  fastify.get('/history', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50, offset = 0, status } = req.query

    // Get user's account IDs
    const { data: userAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_id', req.user.id)
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

  // GET /analytics/activity - Activity log
  fastify.get('/activity', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50 } = req.query

    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })
}
