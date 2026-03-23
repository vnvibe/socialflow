module.exports = async (fastify) => {
  const { supabase } = fastify

  async function isAdmin(userId) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single()
    return data?.role === 'admin'
  }

  // GET /analytics/dashboard - Dashboard stats
  // Admin: global stats | User: own stats only
  fastify.get('/dashboard', { preHandler: fastify.authenticate }, async (req, reply) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const admin = await isAdmin(req.user.id)

    // Get account IDs for filtering
    let userAccountIds = []
    if (!admin) {
      const { data: userAccounts } = await supabase.from('accounts').select('id').eq('owner_id', req.user.id)
      userAccountIds = (userAccounts || []).map(a => a.id)
    }

    // Build queries — admin sees all, user sees own
    const accountsQuery = admin
      ? supabase.from('accounts').select('id', { count: 'exact' }).eq('is_active', true)
      : supabase.from('accounts').select('id', { count: 'exact' }).eq('owner_id', req.user.id).eq('is_active', true)

    const postsTodayQuery = admin
      ? supabase.from('publish_history').select('id', { count: 'exact' }).eq('status', 'success').gte('published_at', todayISO)
      : userAccountIds.length > 0
        ? supabase.from('publish_history').select('id', { count: 'exact' }).eq('status', 'success').gte('published_at', todayISO).in('account_id', userAccountIds)
        : { count: 0 }

    const jobsQuery = admin
      ? supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'pending')
      : supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'pending').eq('created_by', req.user.id)

    const inboxQuery = admin
      ? supabase.from('inbox_messages').select('id', { count: 'exact' }).eq('is_read', false)
      : supabase.from('inbox_messages').select('id, fanpages!inner(*, accounts!inner(owner_id))', { count: 'exact' }).eq('is_read', false).eq('fanpages.accounts.owner_id', req.user.id)

    const recentPostsQuery = admin
      ? supabase.from('publish_history').select('published_at, status, account_id').gte('published_at', sevenDaysAgo).eq('status', 'success').order('published_at', { ascending: true })
      : userAccountIds.length > 0
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
      is_admin: admin
    }

    // Admin gets extra platform-wide stats
    if (admin) {
      const [totalUsers, allAccounts] = await Promise.all([
        supabase.from('profiles').select('id, role', { count: 'exact' }),
        supabase.from('accounts').select('id, username, owner_id, posts_today, total_posts, status, profiles!accounts_owner_id_fkey(role)').order('total_posts', { ascending: false })
      ])
      result.platform = {
        total_users: totalUsers.count || 0,
        accounts: (allAccounts.data || []).map(a => ({
          id: a.id,
          username: a.username,
          posts_today: a.posts_today,
          total_posts: a.total_posts,
          status: a.status
        }))
      }
    }

    return result
  })

  // GET /analytics/accounts - Account performance
  // Admin: all accounts (no cookies) | User: own accounts
  fastify.get('/accounts', { preHandler: fastify.authenticate }, async (req, reply) => {
    const admin = await isAdmin(req.user.id)
    let query = supabase.from('accounts')
      .select('id, username, status, total_posts, posts_today, last_used_at')
      .order('total_posts', { ascending: false })

    if (!admin) query = query.eq('owner_id', req.user.id)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /analytics/history - Publish history
  // Admin: all history | User: own accounts only
  fastify.get('/history', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { limit = 50, offset = 0, status } = req.query
    const admin = await isAdmin(req.user.id)

    let query = supabase
      .from('publish_history')
      .select('*')
      .order('published_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (!admin) {
      const { data: userAccounts } = await supabase.from('accounts').select('id').eq('owner_id', req.user.id)
      const userAccountIds = (userAccounts || []).map(a => a.id)
      if (!userAccountIds.length) return []
      query = query.in('account_id', userAccountIds)
    }

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
