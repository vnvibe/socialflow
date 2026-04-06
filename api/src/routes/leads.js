module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /leads/stats - Pipeline stats (supports optional campaign_id filter)
  fastify.get('/stats', { preHandler: fastify.authenticate }, async (req) => {
    const userId = req.query.as_user || req.user.id
    const campaignId = req.query.campaign_id

    let query = supabase
      .from('leads')
      .select('status, platform, ai_type')
      .eq('owner_id', userId)
    if (campaignId) query = query.eq('campaign_id', campaignId)

    const { data, error } = await query

    if (error) return { total: 0, by_status: {}, by_platform: {} }

    const rows = data || []
    const byStatus = {}
    const byPlatform = {}
    const byType = {}
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1
      byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1
      if (r.ai_type) byType[r.ai_type] = (byType[r.ai_type] || 0) + 1
    }

    return {
      total: rows.length,
      by_status: byStatus,
      by_platform: byPlatform,
      by_type: byType,
    }
  })

  // GET /leads - List leads (paginated, filterable)
  fastify.get('/', { preHandler: fastify.authenticate }, async (req) => {
    const userId = req.query.as_user || req.user.id
    const { status, source, platform, search, page = 1, limit = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabase
      .from('leads')
      .select('*, accounts:discovered_by(username)', { count: 'exact' })
      .eq('owner_id', userId)
      .order('discovered_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)
    if (source) query = query.eq('source', source)
    if (platform) query = query.eq('platform', platform)
    if (search) query = query.or(`name.ilike.%${search}%,fb_uid.ilike.%${search}%,source_detail.ilike.%${search}%`)

    const { data, error, count } = await query
    if (error) return { data: [], total: 0, page: 1 }

    return {
      data: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil((count || 0) / parseInt(limit)),
    }
  })

  // POST /leads - Add lead manually
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { fb_uid, name, platform, source, source_detail, note, tags, score } = req.body

    if (!fb_uid) return reply.code(400).send({ error: 'fb_uid is required' })

    const { data, error } = await supabase
      .from('leads')
      .upsert({
        owner_id: userId,
        fb_uid,
        name,
        platform: platform || 'facebook',
        source: source || 'manual',
        source_detail,
        note,
        tags,
        score,
      }, { onConflict: 'owner_id,fb_uid' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /leads/bulk - Bulk import
  fastify.post('/bulk', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { leads } = req.body

    if (!Array.isArray(leads) || leads.length === 0) {
      return reply.code(400).send({ error: 'leads array is required' })
    }

    const rows = leads.map(l => ({
      owner_id: userId,
      fb_uid: l.fb_uid,
      name: l.name || null,
      platform: l.platform || 'facebook',
      source: l.source || 'import',
      source_detail: l.source_detail || null,
      note: l.note || null,
      tags: l.tags || null,
      score: l.score || null,
    })).filter(r => r.fb_uid)

    const { data, error } = await supabase
      .from('leads')
      .upsert(rows, { onConflict: 'owner_id,fb_uid', ignoreDuplicates: true })
      .select()

    if (error) return reply.code(500).send({ error: error.message })
    return { imported: (data || []).length, total: rows.length }
  })

  // PUT /leads/:id - Update lead
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { status, note, tags, score, name } = req.body

    const updates = { updated_at: new Date().toISOString() }
    if (status !== undefined) {
      updates.status = status
      if (status === 'friend_sent') updates.friend_sent_at = new Date().toISOString()
      if (status === 'connected') updates.connected_at = new Date().toISOString()
    }
    if (note !== undefined) updates.note = note
    if (tags !== undefined) updates.tags = tags
    if (score !== undefined) updates.score = score
    if (name !== undefined) updates.name = name

    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', userId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /leads/:id - Delete lead
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // POST /leads/export-csv - Export to CSV
  fastify.post('/export-csv', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { status } = req.body || {}

    let query = supabase
      .from('leads')
      .select('fb_uid, name, platform, status, source, source_detail, note, score, discovered_at, friend_sent_at, connected_at')
      .eq('owner_id', userId)
      .order('discovered_at', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })

    const rows = data || []
    const header = 'fb_uid,name,platform,status,source,source_detail,note,score,discovered_at,friend_sent_at,connected_at'
    const csv = [header, ...rows.map(r =>
      [r.fb_uid, r.name, r.platform, r.status, r.source, r.source_detail, r.note, r.score, r.discovered_at, r.friend_sent_at, r.connected_at]
        .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
        .join(',')
    )].join('\n')

    reply.header('Content-Type', 'text/csv')
    reply.header('Content-Disposition', 'attachment; filename="leads-export.csv"')
    return csv
  })
}
