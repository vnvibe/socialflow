/**
 * Campaign Activity Logger
 * Logs per-action entries to campaign_activity_log table for AI analysis.
 * Buffers entries and flushes in batch to minimize DB calls.
 *
 * Usage:
 *   const logger = new ActivityLogger(supabase, { campaign_id, role_id, account_id, job_id, owner_id })
 *   logger.log('like', { target_type: 'group', target_name: 'VPS Hosting VN', target_id: '123' })
 *   logger.log('comment', { target_name: 'VPS Group', details: { comment_text: 'Hay quá' } })
 *   await logger.flush() // call in finally block
 */

const MAX_BUFFER = 50

class ActivityLogger {
  constructor(supabase, context = {}) {
    this.supabase = supabase
    this.context = {
      campaign_id: context.campaign_id || null,
      role_id: context.role_id || null,
      account_id: context.account_id || null,
      job_id: context.job_id || null,
      owner_id: context.owner_id || null,
    }
    this.buffer = []
    this.flushed = 0
  }

  /**
   * Log a single action
   * @param {string} actionType - like, comment, join_group, friend_request, post, visit_group, scan, visit_profile
   * @param {object} opts - { target_type, target_id, target_name, target_url, result_status, details, duration_ms }
   */
  log(actionType, opts = {}) {
    this.buffer.push({
      ...this.context,
      action_type: actionType,
      target_type: opts.target_type || null,
      target_id: opts.target_id || null,
      target_name: opts.target_name || null,
      target_url: opts.target_url || null,
      result_status: opts.result_status || 'success',
      details: opts.details || {},
      duration_ms: opts.duration_ms || null,
      created_at: new Date().toISOString(),
    })

    // Auto-flush when buffer full
    if (this.buffer.length >= MAX_BUFFER) {
      this._autoFlush()
    }
  }

  /**
   * Flush all buffered entries to DB. Call in handler's finally block.
   */
  async flush() {
    if (this.buffer.length === 0) return
    const entries = this.buffer.splice(0)
    try {
      const { error } = await this.supabase.from('campaign_activity_log').insert(entries)
      if (error) throw error
      this.flushed += entries.length
    } catch (err) {
      console.error(`[ACTIVITY-LOG] Flush failed (${entries.length} entries): ${err.message}`)
    }
  }

  /**
   * Non-blocking auto-flush for mid-handler buffer overflow
   */
  _autoFlush() {
    const entries = this.buffer.splice(0)
    this.supabase.from('campaign_activity_log').insert(entries)
      .then(({ error }) => {
        if (error) console.error(`[ACTIVITY-LOG] Auto-flush error: ${error.message}`)
        else this.flushed += entries.length
      })
      .catch(err => console.error(`[ACTIVITY-LOG] Auto-flush failed: ${err.message}`))
  }

  /**
   * Get total entries logged (flushed + buffered)
   */
  get total() {
    return this.flushed + this.buffer.length
  }
}

module.exports = { ActivityLogger }
