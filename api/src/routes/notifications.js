/**
 * Notifications route — user alerts (checkpoint, failures, campaign events)
 */

module.exports = async function (app) {
  const auth = { preHandler: app.authenticate }

  // GET /notifications — list notifications
  app.get('/', auth, async (req, reply) => {
    const userId = req.user.id
    const { is_read, type, limit = 50, offset = 0 } = req.query

    let query = app.supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (is_read !== undefined) {
      query = query.eq('is_read', is_read === 'true')
    }
    if (type) {
      query = query.eq('type', type)
    }

    const { data, count, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data, total: count }
  })

  // GET /notifications/unread-count
  app.get('/unread-count', auth, async (req, reply) => {
    const { count, error } = await app.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false)

    if (error) return reply.code(500).send({ error: error.message })
    return { count: count || 0 }
  })

  // PUT /notifications/:id/read — mark single as read
  app.put('/:id/read', auth, async (req, reply) => {
    const { error } = await app.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // PUT /notifications/read-all — mark all as read
  app.put('/read-all', auth, async (req, reply) => {
    const { error } = await app.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // DELETE /notifications/:id — delete single
  app.delete('/:id', auth, async (req, reply) => {
    const { error } = await app.supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })
}
