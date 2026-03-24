/**
 * Notification helper — create notifications for users
 * Reused by: poller.js, campaign-scheduler, routes
 */

async function createNotification(supabase, { userId, type, title, body, level, data }) {
  if (!userId || !type || !title) return null

  try {
    const { data: row, error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body: body || null,
      level: level || 'info',
      data: data || null,
    }).select('id').single()

    if (error) {
      console.error('[NOTIFICATION] Insert failed:', error.message)
      return null
    }
    return row
  } catch (err) {
    console.error('[NOTIFICATION] Error:', err.message)
    return null
  }
}

module.exports = { createNotification }
