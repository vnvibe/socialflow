const { parseMission } = require('../services/campaign-planner')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /campaigns/calendar - Calendar data for jobs + publish_history
  fastify.get('/calendar', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { start, end } = req.query
    if (!start || !end) return reply.code(400).send({ error: 'start and end query params required (ISO format)' })

    try {
      // Fetch scheduled/running jobs
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, type, payload, status, scheduled_at, started_at, finished_at, error_message')
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .eq('created_by', req.user.id)
        .order('scheduled_at', { ascending: true })

      // Fetch publish history
      const { data: history } = await supabase
        .from('publish_history')
        .select('id, target_type, target_name, target_fb_id, final_caption, status, published_at, error_message')
        .gte('published_at', start)
        .lte('published_at', end)
        .eq('account_id', req.user.id) // owner filter via join would be better
        .order('published_at', { ascending: true })

      // Build calendar events
      const events = []

      for (const job of (jobs || [])) {
        const action = job.payload?.action || job.type
        const targetName = job.payload?.target_name || action
        events.push({
          id: job.id,
          type: 'job',
          title: `${action.replace('post_', 'Post to ').replace('_', ' ')}`,
          target_name: targetName,
          start: job.scheduled_at,
          status: job.status,
          caption_preview: job.payload?.caption?.substring(0, 100) || null,
          error: job.error_message,
        })
      }

      for (const h of (history || [])) {
        events.push({
          id: h.id,
          type: 'history',
          title: `Posted to ${h.target_name || h.target_type}`,
          target_name: h.target_name,
          start: h.published_at,
          status: h.status,
          caption_preview: h.final_caption?.substring(0, 100) || null,
          error: h.error_message,
        })
      }

      return events
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /campaigns
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /campaigns/:id (includes roles)
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*, campaign_roles(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'Not found' })
    // Sort roles by sort_order
    if (data.campaign_roles) {
      data.campaign_roles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    }
    return data
  })

  // POST /campaigns/preview-plan — Builds proper roles from selected_actions OR mission
  fastify.post('/preview-plan', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { requirement, mission, topic, account_ids, runs_per_day, selected_actions, brand_config } = req.body
    if (!account_ids?.length) return reply.code(400).send({ error: 'account_ids required' })

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, username, fb_user_id, status, daily_budget, created_at')
      .in('id', account_ids)
      .eq('owner_id', req.user.id)

    if (!accounts?.length) return reply.code(400).send({ error: 'No valid accounts found' })

    const runsPerDay = runs_per_day || 2
    const HARD_LIMITS = { like: 50, comment: 15, friend_request: 10, join_group: 3, post: 3, scan: 15 }

    try {
      // Build roles from selected_actions (new flow) or requirement (legacy)
      const actions = selected_actions || []
      const accountNames = accounts.map(a => a.username || a.fb_user_id)
      const allAccountIds = accounts.map(a => a.id)

      let roles = []

      if (actions.length > 0) {
        // === NEW: Build roles by action type mapping ===
        const hasAction = (key) => actions.some(a => a.key === key)
        const getCount = (key) => actions.find(a => a.key === key)?.count || 0

        // Scout role: join_group + scan_members
        if (hasAction('join_group')) {
          const countPerRun = Math.ceil(getCount('join_group') / runsPerDay)
          const capped = Math.min(countPerRun, HARD_LIMITS.join_group || 3)
          roles.push({
            name: 'Thám dò nhóm',
            role_type: 'scout',
            account_ids: allAccountIds,
            account_names: accountNames,
            steps: [
              { action: 'browse', description: 'Warm up trước khi tìm nhóm', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
              { action: 'join_group', description: `Tìm & tham gia nhóm về ${topic}`, params: { keywords: topic.split(/[,;]+/).map(k => k.trim()).filter(Boolean), min_members: 100 }, quota_key: 'join_group', count_mode: 'range', count_min: Math.max(1, capped - 1), count_max: capped, priority: 2 },
              { action: 'scan_members', description: 'Quét thành viên nhóm để tìm khách tiềm năng', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 3 },
            ],
          })
        }

        // Nurture role: browse + like + comment
        if (hasAction('like') || hasAction('comment')) {
          const steps = [
            { action: 'browse', description: 'Lướt feed warm up', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
          ]
          if (hasAction('like')) {
            const countPerRun = Math.ceil(getCount('like') / runsPerDay)
            const capped = Math.min(countPerRun, Math.ceil(HARD_LIMITS.like / runsPerDay))
            steps.push({ action: 'like', description: `Like ${getCount('like')} bài/ngày trong nhóm`, params: {}, quota_key: 'like', count_mode: 'range', count_min: Math.max(1, capped - 2), count_max: capped, priority: 2 })
          }
          if (hasAction('comment')) {
            const countPerRun = Math.ceil(getCount('comment') / runsPerDay)
            const capped = Math.min(countPerRun, Math.ceil(HARD_LIMITS.comment / runsPerDay))
            steps.push({ action: 'comment', description: `Comment ${getCount('comment')} bài/ngày về ${topic}`, params: { style: 'casual', topic }, quota_key: 'comment', count_mode: 'range', count_min: Math.max(1, capped - 1), count_max: capped, priority: 3 })
          }
          roles.push({
            name: 'Tương tác nhóm',
            role_type: 'nurture',
            account_ids: allAccountIds,
            account_names: accountNames,
            steps,
          })
        }

        // Connect role: friend_request
        if (hasAction('friend_request')) {
          const countPerRun = Math.ceil(getCount('friend_request') / runsPerDay)
          const capped = Math.min(countPerRun, Math.ceil(HARD_LIMITS.friend_request / runsPerDay))
          roles.push({
            name: 'Kết bạn',
            role_type: 'connect',
            account_ids: allAccountIds,
            account_names: accountNames,
            _depends_on: 'scout', // will be wired at save time
            steps: [
              { action: 'browse', description: 'Xem profile trước khi kết bạn', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
              { action: 'send_friend_request', description: `Kết bạn ${getCount('friend_request')}/ngày — AI đánh giá trước khi gửi`, params: { source: 'group_members' }, quota_key: 'friend_request', count_mode: 'range', count_min: Math.max(1, capped - 1), count_max: capped, priority: 2 },
            ],
          })
        }

        // Post role
        if (hasAction('post')) {
          const countPerRun = Math.ceil(getCount('post') / runsPerDay)
          roles.push({
            name: 'Đăng bài',
            role_type: 'post',
            account_ids: allAccountIds,
            account_names: accountNames,
            steps: [
              { action: 'post', description: `Đăng ${getCount('post')} bài/ngày`, params: { content_source: 'ai_gen' }, quota_key: 'post', count_mode: 'fixed', count_min: countPerRun, count_max: countPerRun, priority: 1 },
            ],
          })
        }
      } else if (mission || requirement) {
        // === NEW: mission-first flow — AI parses natural language → roles ===
        const nickAges = accounts.map(a => ({
          name: a.username || a.fb_user_id,
          age_days: Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000),
          status: a.status,
        }))

        const missionText = mission || requirement
        const steps = await parseMission(
          missionText,
          { topic: topic || '', roleType: 'auto', accountCount: accounts.length, accountNames, nickAges, runsPerDay, brandConfig: brand_config },
          req.user.id, supabase
        )

        // Group steps by role type derived from action
        const roleByType = {}
        const ROLE_OF_ACTION = {
          join_group: 'scout', scan_members: 'scout',
          like: 'nurture', comment: 'nurture', browse: 'nurture',
          send_friend_request: 'connect',
          post: 'post',
          reply: 'nurture',
        }
        const ROLE_NAME = {
          scout: 'Thám dò nhóm',
          nurture: 'Tương tác nhóm',
          connect: 'Kết bạn',
          post: 'Đăng bài',
        }
        for (const step of steps) {
          const rt = ROLE_OF_ACTION[step.action] || 'nurture'
          if (!roleByType[rt]) {
            roleByType[rt] = {
              name: ROLE_NAME[rt] || rt,
              role_type: rt,
              account_ids: allAccountIds,
              account_names: accountNames,
              steps: [],
            }
          }
          roleByType[rt].steps.push(step)
        }
        roles = Object.values(roleByType)

        // === ADS: inject opportunity_comment into nurture role if brand config enabled ===
        if (brand_config && brand_config.brand_name) {
          const nurture = roleByType.nurture
          if (nurture) {
            nurture.steps.push({
              action: 'comment',
              description: `Quảng cáo tự nhiên ${brand_config.brand_name}: tối đa 2 lần/nick/ngày`,
              params: {
                style: brand_config.brand_voice || 'casual',
                topic,
                ad_mode: true,
                brand_keywords: brand_config.brand_keywords || [],
              },
              quota_key: 'opportunity_comment',
              count_mode: 'range',
              count_min: 1,
              count_max: 2,
              priority: 9,
            })
          }
        }

        // Wire feeds_into for scout → connect
        const scoutR = roleByType.scout
        const connectR = roleByType.connect
        if (scoutR && connectR) {
          connectR._depends_on = 'scout'
        }
      } else {
        return reply.code(400).send({ error: 'selected_actions, mission, or requirement required' })
      }

      // Compute daily budget
      const perNickDaily = {}
      for (const role of roles) {
        for (const step of (role.steps || [])) {
          const key = step.quota_key || step.action
          const max = step.count_max || step.count_min || 1
          perNickDaily[key] = Math.max(perNickDaily[key] || 0, max * runsPerDay)
        }
      }

      const warnings = []
      for (const [key, perNick] of Object.entries(perNickDaily)) {
        const limit = HARD_LIMITS[key]
        if (limit && perNick > limit) warnings.push(`${key}: ${perNick}/nick/ngay vuot gioi han ${limit}/nick/ngay`)
      }

      const totalSteps = roles.reduce((sum, r) => sum + (r.steps?.length || 0), 0)

      const plan = {
        summary: `${roles.length} roles, ${accounts.length} nicks, topic: ${topic || 'general'}`,
        roles,
        daily_budget: perNickDaily,
        safety_warnings: warnings,
        estimated_duration_minutes: Math.round(totalSteps * 3 * accounts.length),
        selected_actions: actions,
        brand_config: brand_config || null,
        ad_mode: brand_config?.brand_name ? 'ad_enabled' : 'normal',
        mission: mission || requirement || null,
      }

      return { plan, accounts: accountNames }
    } catch (err) {
      return reply.code(500).send({ error: `AI plan failed: ${err.message}` })
    }
  })

  // POST /campaigns
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const {
      name, topic, requirement, mission, language, brand_config, ad_mode,
      account_ids, ai_plan, ai_plan_confirmed,
      target_pages, target_groups, target_profiles,
      content_ids, rotation_mode, spin_mode,
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at, delay_between_targets_minutes,
      nick_stagger_seconds, role_stagger_minutes, campaign_active_days
    } = req.body

    if (!name) return reply.code(400).send({ error: 'name required' })

    const { data, error } = await supabase.from('campaigns').insert({
      owner_id: req.user.id,
      name,
      topic: topic || null,
      requirement: requirement || null,
      mission: mission || null,
      language: language || 'vi',
      brand_config: brand_config || null,
      ad_mode: ad_mode || 'normal',
      account_ids: account_ids || [],
      ai_plan: ai_plan || null,
      ai_plan_confirmed: ai_plan_confirmed || false,
      target_pages: target_pages || [],
      target_groups: target_groups || [],
      target_profiles: target_profiles || [],
      content_ids: content_ids || [],
      rotation_mode: rotation_mode || 'sequential',
      spin_mode: spin_mode || 'basic',
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at,
      delay_between_targets_minutes: delay_between_targets_minutes || 15,
      nick_stagger_seconds: nick_stagger_seconds || 60,
      role_stagger_minutes: role_stagger_minutes || 30,
      campaign_active_days: campaign_active_days || [1,2,3,4,5,6,0],
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Auto-create roles from ai_plan if confirmed
    if (ai_plan?.roles && ai_plan_confirmed) {
      const createdRoles = [] // track role IDs for wiring feeds_into

      for (let i = 0; i < ai_plan.roles.length; i++) {
        const role = ai_plan.roles[i]
        const { data: created } = await supabase.from('campaign_roles').insert({
          campaign_id: data.id,
          name: role.name || `Role ${String.fromCharCode(65 + i)}`,
          role_type: role.role_type || 'custom',
          account_ids: role.account_ids || [],
          mission: role.mission || '',
          parsed_plan: role.steps || null,
          sort_order: i,
          is_active: true,
        }).select('id, role_type').single()

        if (created) createdRoles.push({ ...created, _depends_on: role._depends_on })
      }

      // Wire feeds_into: scout feeds into connect (so connect gets targets from scout's scan)
      const scoutRole = createdRoles.find(r => r.role_type === 'scout')
      const connectRole = createdRoles.find(r => r.role_type === 'connect')
      if (scoutRole && connectRole) {
        await supabase.from('campaign_roles')
          .update({ feeds_into: connectRole.id })
          .eq('id', scoutRole.id)
        await supabase.from('campaign_roles')
          .update({ read_from: scoutRole.id })
          .eq('id', connectRole.id)
      }
    }

    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = [
      'name', 'topic', 'requirement', 'mission', 'language', 'brand_config', 'ad_mode',
      'account_ids', 'ai_plan', 'ai_plan_confirmed',
      'target_pages', 'target_groups', 'target_profiles',
      'content_ids', 'rotation_mode', 'spin_mode',
      'schedule_type', 'cron_expression', 'interval_minutes',
      'start_at', 'end_at', 'delay_between_targets_minutes',
      'nick_stagger_seconds', 'role_stagger_minutes', 'campaign_active_days'
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })

    // Cascade account_ids to all campaign_roles so running campaigns pick up the
    // new nick roster on their next poll. Only do this when account_ids was provided.
    if (Array.isArray(req.body.account_ids)) {
      try {
        await supabase.from('campaign_roles')
          .update({ account_ids: req.body.account_ids })
          .eq('campaign_id', req.params.id)
      } catch (cascadeErr) {
        req.log?.warn?.(`cascade account_ids failed: ${cascadeErr.message}`)
      }
    }

    return data
  })

  // PUT /campaigns/:id/plan — Update parsed_plan for live campaigns
  // Used by the "Sửa kế hoạch" tab in campaign detail to apply changes mid-run
  fastify.put('/:id/plan', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { ai_plan } = req.body
    if (!ai_plan?.roles) return reply.code(400).send({ error: 'ai_plan.roles required' })

    // Verify ownership
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    // Update campaign.ai_plan (so future runs use new plan)
    const { error: campErr } = await supabase.from('campaigns')
      .update({ ai_plan, ai_plan_confirmed: true })
      .eq('id', req.params.id)
    if (campErr) return reply.code(500).send({ error: campErr.message })

    // Update parsed_plan in each campaign_role to match
    // Match by role_type — roles in ai_plan and DB share role_type
    const { data: dbRoles } = await supabase.from('campaign_roles')
      .select('id, role_type')
      .eq('campaign_id', req.params.id)

    if (dbRoles) {
      for (const planRole of ai_plan.roles) {
        const dbRole = dbRoles.find(r => r.role_type === planRole.role_type)
        if (dbRole) {
          await supabase.from('campaign_roles')
            .update({ parsed_plan: planRole.steps || [] })
            .eq('id', dbRole.id)
        }
      }
    }

    return { ok: true, applied_at: new Date().toISOString() }
  })

  // DELETE /campaigns/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('campaigns').delete().eq('id', req.params.id).eq('owner_id', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /campaigns/:id/start
  fastify.post('/:id/start', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .update({
        is_active: true,
        status: 'running',
        next_run_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /campaigns/:id/stop
  fastify.post('/:id/stop', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .update({
        is_active: false,
        status: 'paused',
        next_run_at: null
      })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // ═══════════════════════════════════════════════════════
  // ROLE ENDPOINTS
  // ═══════════════════════════════════════════════════════

  // POST /campaigns/:id/roles — add role
  fastify.post('/:id/roles', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Verify campaign ownership
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { name, role_type, account_ids, mission, config, quota_override, feeds_into, read_from, sort_order } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })

    const { data, error } = await supabase.from('campaign_roles').insert({
      campaign_id: req.params.id,
      name,
      role_type: role_type || 'custom',
      account_ids: account_ids || [],
      mission: mission || null,
      config: config || {},
      quota_override: quota_override || null,
      feeds_into: feeds_into || null,
      read_from: read_from || null,
      sort_order: sort_order || 0,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id/roles/:roleId — update role
  fastify.put('/:id/roles/:roleId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const allowed = ['name', 'role_type', 'account_ids', 'mission', 'parsed_plan', 'config', 'quota_override', 'feeds_into', 'read_from', 'sort_order', 'is_active']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase.from('campaign_roles')
      .update(updates)
      .eq('id', req.params.roleId)
      .eq('campaign_id', req.params.id)
      .select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /campaigns/:id/roles/:roleId
  fastify.delete('/:id/roles/:roleId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { error } = await supabase.from('campaign_roles')
      .delete()
      .eq('id', req.params.roleId)
      .eq('campaign_id', req.params.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // POST /campaigns/:id/roles/:roleId/parse — AI parse mission preview
  fastify.post('/:id/roles/:roleId/parse', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, topic').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { data: role } = await supabase.from('campaign_roles')
      .select('*').eq('id', req.params.roleId).eq('campaign_id', req.params.id).single()
    if (!role) return reply.code(404).send({ error: 'Role not found' })

    if (!role.mission) return reply.code(400).send({ error: 'Role has no mission text' })

    try {
      const plan = await parseMission(role.mission, {
        topic: campaign.topic,
        roleType: role.role_type,
        accountCount: (role.account_ids || []).length,
      }, req.user.id, supabase)

      return { plan, role_id: role.id }
    } catch (err) {
      return reply.code(500).send({ error: `AI parse failed: ${err.message}` })
    }
  })

  // GET /campaigns/:id/stats — realtime stats
  fastify.get('/:id/stats', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cid = req.params.id

    const [queuePending, queueDone, queueFailed, friendSent, friendAccepted, jobsDone, jobsFailed] = await Promise.all([
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'pending'),
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'done'),
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'failed'),
      supabase.from('friend_request_log').select('id', { count: 'exact', head: true }).eq('campaign_id', cid),
      supabase.from('friend_request_log').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'accepted'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('payload->>campaign_id', cid).eq('status', 'done'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('payload->>campaign_id', cid).eq('status', 'failed'),
    ])

    return {
      queue: { pending: queuePending.count || 0, done: queueDone.count || 0, failed: queueFailed.count || 0 },
      friends: { sent: friendSent.count || 0, accepted: friendAccepted.count || 0 },
      jobs: { done: jobsDone.count || 0, failed: jobsFailed.count || 0 },
    }
  })

  // GET /campaigns/:id/post-strategy — AI-powered post scheduling insights
  fastify.get('/:id/post-strategy', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, name, topic, campaign_roles(account_ids)')
      .eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { collectPerformanceData } = require('../services/post-strategy')

    // Collect data from all campaign accounts
    const allAccountIds = [...new Set((campaign.campaign_roles || []).flatMap(r => r.account_ids || []))]
    let bestStrategy = null

    for (const accId of allAccountIds.slice(0, 3)) {
      const perfData = await collectPerformanceData(supabase, accId)
      if (perfData && (!bestStrategy || perfData.total_posts > bestStrategy.total_posts)) {
        bestStrategy = { ...perfData, account_id: accId }
      }
    }

    if (!bestStrategy) {
      return { has_data: false, min_posts: 5, message: 'Cần ít nhất 5 bài đã đăng để AI phân tích chiến lược' }
    }

    // Check if any recent job has ai_strategy in payload
    const { data: recentJob } = await supabase
      .from('jobs')
      .select('payload, created_at')
      .filter('payload->>campaign_id', 'eq', req.params.id)
      .not('payload->ai_strategy', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const aiStrategy = recentJob?.payload?.ai_strategy || null

    return {
      has_data: true,
      total_posts: bestStrategy.total_posts,
      best_hours: bestStrategy.best_hours,
      best_days: bestStrategy.best_days,
      hour_stats: bestStrategy.hour_stats?.slice(0, 8),
      group_stats: bestStrategy.group_stats?.slice(0, 5),
      ai_strategy: aiStrategy,
      strategy_updated_at: recentJob?.created_at || null,
    }
  })

  // GET /campaigns/:id/report — aggregated campaign analytics
  fastify.get('/:id/report', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, name, total_runs, created_at, last_run_at, campaign_roles(id, name, role_type, account_ids)')
      .eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cid = req.params.id
    try {
      // 1. Fetch all campaign jobs (up to 2000)
      const { data: allJobs } = await supabase.from('jobs')
        .select('id, type, status, payload, started_at, finished_at, error_message, created_at')
        .eq('payload->>campaign_id', cid)
        .order('created_at', { ascending: false })
        .limit(2000)

      // 2. Target queue counts
      const [tqDone, tqFailed, tqPending] = await Promise.all([
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'done'),
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'failed'),
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'pending'),
      ])

      // 3. Friend request stats
      const { data: friendRows } = await supabase.from('friend_request_log')
        .select('status, sent_at')
        .eq('campaign_id', cid)
        .order('sent_at', { ascending: false })
        .limit(2000)

      const jobs = allJobs || []
      const friends = friendRows || []

      // === SUMMARY ===
      const jobsDone = jobs.filter(j => j.status === 'done').length
      const jobsFailed = jobs.filter(j => j.status === 'failed').length
      const totalJobs = jobs.length
      const successRate = totalJobs > 0 ? Math.round((jobsDone / totalJobs) * 100) : 0

      const friendsSent = friends.length
      const friendsAccepted = friends.filter(f => f.status === 'accepted').length
      const acceptRate = friendsSent > 0 ? Math.round((friendsAccepted / friendsSent) * 100) : 0

      // Average duration (only completed jobs with both timestamps)
      const durations = jobs
        .filter(j => j.started_at && j.finished_at)
        .map(j => (new Date(j.finished_at) - new Date(j.started_at)) / 1000)
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

      const firstJob = jobs.length > 0 ? jobs[jobs.length - 1].created_at : null

      // === DAILY BREAKDOWN (last 14 days) ===
      const dailyMap = {}
      const now = new Date()
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyMap[key] = { date: key, jobs_done: 0, jobs_failed: 0, friends_sent: 0, friends_accepted: 0 }
      }

      for (const job of jobs) {
        const day = (job.created_at || '').slice(0, 10)
        if (dailyMap[day]) {
          if (job.status === 'done') dailyMap[day].jobs_done++
          if (job.status === 'failed') dailyMap[day].jobs_failed++
        }
      }
      for (const f of friends) {
        const day = (f.sent_at || '').slice(0, 10)
        if (dailyMap[day]) {
          dailyMap[day].friends_sent++
          if (f.status === 'accepted') dailyMap[day].friends_accepted++
        }
      }

      // === BY ROLE ===
      const roleMap = {}
      for (const role of (campaign.campaign_roles || [])) {
        roleMap[role.id] = { role_id: role.id, role_name: role.name, role_type: role.role_type, jobs_done: 0, jobs_failed: 0, total: 0 }
      }
      for (const job of jobs) {
        const rid = job.payload?.role_id
        if (rid && roleMap[rid]) {
          roleMap[rid].total++
          if (job.status === 'done') roleMap[rid].jobs_done++
          if (job.status === 'failed') roleMap[rid].jobs_failed++
        }
      }

      // === BY ACCOUNT ===
      const accountMap = {}
      for (const job of jobs) {
        const aid = job.payload?.account_id
        if (!aid) continue
        if (!accountMap[aid]) accountMap[aid] = { account_id: aid, jobs_done: 0, jobs_failed: 0, total: 0 }
        accountMap[aid].total++
        if (job.status === 'done') accountMap[aid].jobs_done++
        if (job.status === 'failed') accountMap[aid].jobs_failed++
      }

      // Get account names
      const accountIds = Object.keys(accountMap)
      if (accountIds.length > 0) {
        const { data: accounts } = await supabase.from('accounts').select('id, username').in('id', accountIds)
        for (const acc of (accounts || [])) {
          if (accountMap[acc.id]) accountMap[acc.id].account_name = acc.username || acc.id
        }
      }

      // Count friends sent per account from job payload
      for (const f of friends) {
        // friend_request_log may not have account_id directly, skip if not
      }

      // === RECENT ERRORS ===
      const recentErrors = jobs
        .filter(j => j.status === 'failed' && j.error_message)
        .slice(0, 10)
        .map(j => ({ job_id: j.id, type: j.type, error_message: j.error_message, created_at: j.created_at }))

      // === PER-ACTION STATS from activity_log ===
      const { data: activityRows } = await supabase
        .from('campaign_activity_log')
        .select('action_type, result_status, account_id, target_name, target_url, details, created_at')
        .eq('campaign_id', cid)
        .order('created_at', { ascending: false })
        .limit(5000)

      const activities = activityRows || []

      // Action summary — skipped NOT counted in total (total = success + failed only)
      const actionSummary = {}
      for (const a of activities) {
        if (!actionSummary[a.action_type]) actionSummary[a.action_type] = { total: 0, success: 0, failed: 0, skipped: 0 }
        if (a.result_status === 'success') { actionSummary[a.action_type].success++; actionSummary[a.action_type].total++ }
        else if (a.result_status === 'failed') { actionSummary[a.action_type].failed++; actionSummary[a.action_type].total++ }
        else if (a.result_status === 'skipped') { actionSummary[a.action_type].skipped++ }
      }

      // Per-nick action breakdown
      const nickActions = {}
      for (const a of activities) {
        const aid = a.account_id
        if (!aid) continue
        if (!nickActions[aid]) nickActions[aid] = { account_id: aid, actions: {} }
        if (!nickActions[aid].actions[a.action_type]) nickActions[aid].actions[a.action_type] = { total: 0, success: 0, failed: 0, skipped: 0 }
        nickActions[aid].actions[a.action_type].total++
        if (a.result_status === 'success') nickActions[aid].actions[a.action_type].success++
        if (a.result_status === 'failed') nickActions[aid].actions[a.action_type].failed++
      }
      // Enrich with account names
      for (const aid of Object.keys(nickActions)) {
        nickActions[aid].account_name = accountMap[aid]?.account_name || aid.slice(0, 8)
      }

      // Recent comments with links (for report detail)
      const recentComments = activities
        .filter(a => a.action_type === 'comment' && a.result_status === 'success')
        .slice(0, 50)
        .map(a => ({
          group_name: a.target_name,
          group_url: a.target_url,
          post_url: a.details?.post_url || null,
          comment_text: a.details?.comment_text || '',
          account_id: a.account_id,
          account_name: accountMap[a.account_id]?.account_name || a.account_id?.slice(0, 8),
          created_at: a.created_at,
        }))

      // Recent likes with links
      const recentLikes = activities
        .filter(a => a.action_type === 'like' && a.result_status === 'success')
        .slice(0, 50)
        .map(a => ({
          group_name: a.target_name,
          group_url: a.target_url,
          post_url: a.details?.post_url || null,
          account_name: accountMap[a.account_id]?.account_name || a.account_id?.slice(0, 8),
          created_at: a.created_at,
        }))

      // Groups joined
      const groupsJoined = activities
        .filter(a => a.action_type === 'join_group' && a.result_status === 'success')
        .map(a => ({
          group_name: a.target_name,
          group_url: a.target_url,
          member_count: a.details?.member_count || null,
          account_name: accountMap[a.account_id]?.account_name || a.account_id?.slice(0, 8),
          created_at: a.created_at,
        }))

      // Checkpoint/error events
      const checkpointEvents = [
        ...recentErrors.map(e => ({ ...e, event_type: 'job_error' })),
        ...activities
          .filter(a => a.result_status === 'failed')
          .slice(0, 20)
          .map(a => ({
            event_type: 'action_error',
            action: a.action_type,
            error: a.details?.error || 'Unknown',
            target: a.target_name,
            account_name: accountMap[a.account_id]?.account_name || a.account_id?.slice(0, 8),
            created_at: a.created_at,
          })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)

      return {
        summary: {
          total_jobs: totalJobs,
          jobs_done: jobsDone,
          jobs_failed: jobsFailed,
          success_rate: successRate,
          total_targets: (tqDone.count || 0) + (tqFailed.count || 0) + (tqPending.count || 0),
          targets_done: tqDone.count || 0,
          targets_failed: tqFailed.count || 0,
          friends_sent: friendsSent,
          friends_accepted: friendsAccepted,
          accept_rate: acceptRate,
          avg_job_duration_sec: avgDuration,
          total_runs: campaign.total_runs || 0,
          first_run_at: firstJob,
          last_run_at: campaign.last_run_at,
          total_activities: activities.filter(a => a.result_status !== 'skipped').length,
          total_skipped: activities.filter(a => a.result_status === 'skipped').length,
        },
        daily: Object.values(dailyMap),
        by_role: Object.values(roleMap),
        by_account: Object.values(accountMap),
        action_summary: actionSummary,
        nick_actions: Object.values(nickActions),
        recent_comments: recentComments,
        recent_likes: recentLikes,
        groups_joined: groupsJoined,
        checkpoint_events: checkpointEvents,
        recent_errors: recentErrors,
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /campaigns/:id/targets — target queue (paginated)
  fastify.get('/:id/targets', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { status, limit = 50, offset = 0 } = req.query
    let query = supabase.from('target_queue')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data, total: count }
  })

  // GET /campaigns/:id/friend-log — friend request history
  fastify.get('/:id/friend-log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 50, offset = 0 } = req.query
    const { data, count, error } = await supabase.from('friend_request_log')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)
      .order('sent_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) return reply.code(500).send({ error: error.message })
    return { data, total: count }
  })

  // GET /campaigns/:id/groups — Campaign-scoped groups (via campaign_ids array)
  fastify.get('/:id/groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, campaign_roles(account_ids)')
      .eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const accountIds = [...new Set((campaign.campaign_roles || []).flatMap(r => r.account_ids || []))]
    if (!accountIds.length) return []

    const { data, error } = await supabase
      .from('fb_groups')
      .select('id, fb_group_id, name, url, member_count, group_type, topic, ai_relevance, is_blocked, campaign_ids, account_id, joined_via_campaign_id')
      .in('account_id', accountIds)
      .contains('campaign_ids', [req.params.id])
      .or('is_blocked.is.null,is_blocked.eq.false')
      .order('name')

    if (error) return reply.code(500).send({ error: error.message })

    // Enrich with account username
    const { data: accounts } = await supabase.from('accounts').select('id, username').in('id', accountIds)
    const accountMap = Object.fromEntries((accounts || []).map(a => [a.id, a.username]))

    return (data || []).map(g => ({
      ...g,
      account_username: accountMap[g.account_id] || null,
    }))
  })

  // GET /campaigns/:id/leads — Campaign-scoped leads
  fastify.get('/:id/leads', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { status, search, page = 1, limit = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)
      .order('discovered_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)
    if (search) query = query.or(`name.ilike.%${search}%,fb_uid.ilike.%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // Stats
    const { data: allLeads } = await supabase
      .from('leads')
      .select('status, ai_type')
      .eq('campaign_id', req.params.id)

    const byStatus = {}, byType = {}
    for (const l of (allLeads || [])) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1
      if (l.ai_type) byType[l.ai_type] = (byType[l.ai_type] || 0) + 1
    }

    return {
      data: data || [],
      total: count || 0,
      page: parseInt(page),
      pages: Math.ceil((count || 0) / parseInt(limit)),
      stats: { total: (allLeads || []).length, by_status: byStatus, by_type: byType },
    }
  })

  // PUT /campaigns/:id/groups/:groupId — Assign/remove group from campaign
  fastify.put('/:id/groups/:groupId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { action } = req.body // 'add' or 'remove'
    const groupId = req.params.groupId

    if (action === 'add') {
      // Get group's fb_group_id and account_id
      const { data: group } = await supabase.from('fb_groups')
        .select('fb_group_id, account_id').eq('id', groupId).single()
      if (!group) return reply.code(404).send({ error: 'Group not found' })

      await supabase.rpc('append_campaign_to_group', {
        p_account_id: group.account_id,
        p_fb_group_id: group.fb_group_id,
        p_campaign_id: req.params.id,
      })
      return { ok: true, action: 'added' }
    } else if (action === 'remove') {
      const { data: group } = await supabase.from('fb_groups')
        .select('campaign_ids').eq('id', groupId).single()
      if (!group) return reply.code(404).send({ error: 'Group not found' })

      const newIds = (group.campaign_ids || []).filter(id => id !== req.params.id)
      await supabase.from('fb_groups').update({ campaign_ids: newIds }).eq('id', groupId)
      return { ok: true, action: 'removed' }
    }

    return reply.code(400).send({ error: 'action must be add or remove' })
  })

  // PUT /campaigns/:id/groups/:groupId/review — User approve/reject AI evaluation
  fastify.put('/:id/groups/:groupId/review', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { approved } = req.body // true = approve, false = reject
    if (typeof approved !== 'boolean') return reply.code(400).send({ error: 'approved must be true or false' })

    const { error } = await supabase.from('fb_groups')
      .update({ user_approved: approved })
      .eq('id', req.params.groupId)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true, approved }
  })

  // ── POST /campaigns/:id/priority-groups ──
  // Mark a Facebook group as priority (tier A) for a campaign. Resolves the
  // group from a URL or raw fb_group_id, then upserts fb_groups with
  // score_tier='A', user_approved=true, joined_via_campaign_id=campaign.id.
  // Body: { group_url: "https://facebook.com/groups/xxx" } OR { fb_group_id: "12345" }
  fastify.post('/:id/priority-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Verify ownership
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, account_ids, topic').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { group_url, fb_group_id: rawId, name } = req.body || {}
    let fbGroupId = rawId || null
    let groupUrl = group_url || null

    if (group_url && !fbGroupId) {
      // Parse fb_group_id from URL — supports facebook.com/groups/<id> and m.facebook.com variants
      const m = String(group_url).match(/(?:facebook\.com|fb\.com)\/groups\/([^/?#]+)/i)
      if (m) fbGroupId = m[1]
    }
    if (!fbGroupId) {
      return reply.code(400).send({ error: 'group_url hoặc fb_group_id required (URL phải là facebook.com/groups/...)' })
    }
    if (!groupUrl) groupUrl = `https://www.facebook.com/groups/${fbGroupId}`

    // Need at least one account on the campaign for the FK
    const acctIds = campaign.account_ids || []
    if (acctIds.length === 0) {
      return reply.code(400).send({ error: 'Campaign chưa có nick — gán nick trước rồi thêm group ưu tiên' })
    }
    const accountId = acctIds[0]

    // Upsert each account row (one fb_groups row per (account_id, fb_group_id))
    const rows = acctIds.map(aid => ({
      account_id: aid,
      fb_group_id: fbGroupId,
      url: groupUrl,
      name: name || null,
      score_tier: 'A',
      user_approved: true,
      joined_via_campaign_id: req.params.id,
      topic: campaign.topic || null,
      last_scored_at: new Date().toISOString(),
    }))

    const { data, error } = await supabase.from('fb_groups')
      .upsert(rows, { onConflict: 'account_id,fb_group_id' })
      .select()

    if (error) return reply.code(500).send({ error: error.message })

    // Try to append campaign id via existing rpc (multi-campaign support)
    try {
      await supabase.rpc('append_campaign_to_group', {
        p_account_id: accountId, p_fb_group_id: fbGroupId, p_campaign_id: req.params.id,
      })
    } catch {}

    return { ok: true, fb_group_id: fbGroupId, count: data?.length || 0, groups: data }
  })

  // GET /campaigns/:id/priority-groups — list current tier-A groups for this campaign
  fastify.get('/:id/priority-groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { data, error } = await supabase
      .from('fb_groups')
      .select('id, fb_group_id, name, url, score_tier, member_count, last_scored_at, total_interactions')
      .eq('joined_via_campaign_id', req.params.id)
      .eq('score_tier', 'A')
      .order('last_scored_at', { ascending: false })
      .limit(100)

    if (error) return reply.code(500).send({ error: error.message })
    // Dedupe by fb_group_id (multiple accounts may share the same group)
    const seen = new Set()
    const unique = []
    for (const g of data || []) {
      if (seen.has(g.fb_group_id)) continue
      seen.add(g.fb_group_id)
      unique.push(g)
    }
    return unique
  })

  // DELETE /campaigns/:id/priority-groups/:fbGroupId — demote a priority group back to tier C
  fastify.delete('/:id/priority-groups/:fbGroupId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { error } = await supabase.from('fb_groups')
      .update({ score_tier: 'C' })
      .eq('joined_via_campaign_id', req.params.id)
      .eq('fb_group_id', req.params.fbGroupId)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // GET /campaigns/:id/activity-log — granular per-action log (cursor-based)
  fastify.get('/:id/activity-log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 30, after, page = 1, action_type, account_id, result_status, date_from, date_to } = req.query
    const lim = Math.min(parseInt(limit) || 30, 200)
    const pageNum = Math.max(1, parseInt(page) || 1)

    // Build base filter
    let baseFilter = supabase
      .from('campaign_activity_log')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)

    if (action_type) baseFilter = baseFilter.eq('action_type', action_type)
    if (account_id) baseFilter = baseFilter.eq('account_id', account_id)
    if (result_status) baseFilter = baseFilter.eq('result_status', result_status)
    if (date_from) baseFilter = baseFilter.gte('created_at', date_from)
    if (date_to) baseFilter = baseFilter.lte('created_at', date_to)

    let query, isPolling = false

    if (after) {
      // Poll mode: fetch entries NEWER than this timestamp (no pagination)
      query = baseFilter.gt('created_at', after).order('created_at', { ascending: true }).limit(lim)
      isPolling = true
    } else {
      // Page mode: offset-based pagination
      const offset = (pageNum - 1) * lim
      query = baseFilter.order('created_at', { ascending: false }).range(offset, offset + lim - 1)
    }

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // When polling (after), reverse so newest is first for frontend prepend
    const entries = isPolling ? (data || []).reverse() : (data || [])

    // Enrich with account names
    const accountIds = [...new Set(entries.map(d => d.account_id).filter(Boolean))]
    let accountMap = {}
    if (accountIds.length) {
      const { data: accounts } = await supabase.from('accounts').select('id, username').in('id', accountIds)
      accountMap = Object.fromEntries((accounts || []).map(a => [a.id, a.username]))
    }

    const enriched = entries.map(d => ({
      ...d,
      account_name: accountMap[d.account_id] || d.account_id?.slice(0, 8),
    }))

    // Summary: aggregate over ENTIRE campaign (not just this page)
    let sumRows = null
    try {
      const { data } = await supabase.rpc('campaign_activity_summary', { p_campaign_id: req.params.id })
      sumRows = data
    } catch {}
    const summary = {}
    if (sumRows) {
      for (const r of sumRows) {
        summary[r.action_type] = { total: r.total, success: r.success, failed: r.failed }
      }
    } else {
      // Fallback: count from this page only
      for (const d of enriched) {
        const key = d.action_type
        if (!summary[key]) summary[key] = { total: 0, success: 0, failed: 0 }
        summary[key].total++
        if (d.result_status === 'success') summary[key].success++
        else if (d.result_status === 'failed') summary[key].failed++
      }
    }

    // Total count (from query with filters applied, or from count param)
    let total = count
    if (total == null) {
      const { count: c } = await supabase
        .from('campaign_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', req.params.id)
      total = c || 0
    }

    const totalPages = Math.ceil(total / lim)

    // Get distinct accounts in this campaign (for filter dropdown)
    const { data: accountRows } = await supabase
      .from('campaign_activity_log')
      .select('account_id')
      .eq('campaign_id', req.params.id)
    const uniqueAccountIds = [...new Set((accountRows || []).map(r => r.account_id).filter(Boolean))]
    let accounts = []
    if (uniqueAccountIds.length) {
      const { data: accs } = await supabase.from('accounts').select('id, username').in('id', uniqueAccountIds)
      accounts = (accs || []).map(a => ({ id: a.id, name: a.username || a.id.slice(0, 8) }))
    }

    return { data: enriched, total, summary, page: pageNum, per_page: lim, total_pages: totalPages, accounts }
  })

  // GET /campaigns/:id/activity — real-time activity log (recent jobs)
  fastify.get('/:id/activity', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 30, status: filterStatus } = req.query

    let query = supabase.from('jobs')
      .select('id, type, status, payload, result, error_message, started_at, finished_at, created_at, attempt')
      .eq('payload->>campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (filterStatus) query = query.eq('status', filterStatus)

    const { data: jobs, error } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // Enrich with account name and role name
    const accountIds = [...new Set((jobs || []).map(j => j.payload?.account_id).filter(Boolean))]
    const roleIds = [...new Set((jobs || []).map(j => j.payload?.role_id).filter(Boolean))]

    const [accountsRes, rolesRes] = await Promise.all([
      accountIds.length ? supabase.from('accounts').select('id, username').in('id', accountIds) : { data: [] },
      roleIds.length ? supabase.from('campaign_roles').select('id, name, role_type').in('id', roleIds) : { data: [] },
    ])

    const accountMap = Object.fromEntries((accountsRes.data || []).map(a => [a.id, a.username]))
    const roleMap = Object.fromEntries((rolesRes.data || []).map(r => [r.id, { name: r.name, type: r.role_type }]))

    const enriched = (jobs || []).map(j => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempt: j.attempt,
      account_name: accountMap[j.payload?.account_id] || j.payload?.account_id?.slice(0, 8),
      role_name: roleMap[j.payload?.role_id]?.name || '-',
      role_type: roleMap[j.payload?.role_id]?.type || '-',
      topic: j.payload?.topic,
      // Extract useful summary from result
      summary: extractJobSummary(j),
      error_message: j.error_message,
      started_at: j.started_at,
      finished_at: j.finished_at,
      created_at: j.created_at,
    }))

    // Count by status for filter pills
    let statusCounts = null
    try {
      const { data } = await supabase.rpc('count_by_status_jsonb', { cid: req.params.id })
      statusCounts = data
    } catch {}

    // Fallback count
    let counts = statusCounts
    if (!counts) {
      const allStatuses = (jobs || []).map(j => j.status)
      counts = {
        pending: allStatuses.filter(s => s === 'pending').length,
        running: allStatuses.filter(s => s === 'running').length,
        done: allStatuses.filter(s => s === 'done').length,
        failed: allStatuses.filter(s => s === 'failed').length,
      }
    }

    return { data: enriched, counts }
  })

  // ── Phase 4: GET /campaigns/:id/ad-report — Ads tab data ──
  fastify.get('/:id/ad-report', { preHandler: fastify.authenticate }, async (req, reply) => {
    const campaignId = req.params.id
    // Verify ownership
    const { data: c } = await supabase.from('campaigns')
      .select('id').eq('id', campaignId).eq('owner_id', req.user.id).single()
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const { data: posts, error } = await supabase
      .from('shared_posts')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('is_ad_opportunity', true)
      .order('detected_at', { ascending: false })
      .limit(200)
    if (error) return reply.code(500).send({ error: error.message })

    const all = posts || []
    const total_opportunities = all.length
    const total_acted = all.filter(p => (p.swarm_count || 0) > 0).length

    // Group by group_fb_id → enrich with group name
    const groupIds = [...new Set(all.map(p => p.group_fb_id).filter(Boolean))]
    let groupNameMap = {}
    if (groupIds.length) {
      const { data: gs } = await supabase.from('fb_groups')
        .select('fb_group_id, name').in('fb_group_id', groupIds)
      groupNameMap = Object.fromEntries((gs || []).map(g => [g.fb_group_id, g.name]))
    }

    const byGroupMap = {}
    for (const p of all) {
      const k = p.group_fb_id || 'unknown'
      if (!byGroupMap[k]) byGroupMap[k] = { group_fb_id: k, group_name: groupNameMap[k] || k, opportunities: 0, acted: 0 }
      byGroupMap[k].opportunities++
      if ((p.swarm_count || 0) > 0) byGroupMap[k].acted++
    }
    const by_group = Object.values(byGroupMap).sort((a, b) => b.opportunities - a.opportunities)

    // Recent: only those acted upon
    const acted = all.filter(p => (p.swarm_count || 0) > 0).slice(0, 30)
    // Resolve account_name for first swarm account
    const accIds = [...new Set(acted.flatMap(p => p.swarm_account_ids || []))]
    let accMap = {}
    if (accIds.length) {
      const { data: accs } = await supabase.from('accounts')
        .select('id, username').in('id', accIds)
      accMap = Object.fromEntries((accs || []).map(a => [a.id, a.username]))
    }
    const recent = acted.map(p => ({
      id: p.id,
      post_preview: (p.post_content || '').slice(0, 200),
      post_url: p.post_url,
      ad_reason: p.ad_reason,
      ai_score: p.ai_score,
      comment_posted: (p.swarm_comments && p.swarm_comments[0]) || null,
      nick_name: accMap[(p.swarm_account_ids || [])[0]] || null,
      acted_at: p.detected_at,
      group_name: groupNameMap[p.group_fb_id] || p.group_fb_id,
    }))

    return {
      total_opportunities,
      total_acted,
      success_rate: total_opportunities > 0 ? Math.round((total_acted / total_opportunities) * 100) : 0,
      by_group,
      recent,
    }
  })
}

function extractJobSummary(job) {
  const r = job.result
  if (!r) return null
  if (r.skipped) return `⏭️ ${r.reason?.replace('SKIP_', '') || 'skipped'}`

  const parts = []

  // Group names from details
  const groupNames = (r.details || []).map(d => d.group_name).filter(Boolean)
  if (groupNames.length > 0) parts.push(groupNames.slice(0, 2).join(', '))

  // Counts — handle both key formats (likes/liked, comments/commented)
  const likes = r.likes ?? r.liked ?? 0
  const comments = r.comments ?? r.commented ?? 0
  const friendsSent = r.friends_sent ?? r.requests_sent ?? 0
  const groupsJoined = r.groups_joined ?? 0
  const groupsVisited = r.groups_visited ?? 0

  const counts = []
  if (groupsJoined > 0) counts.push(`+${groupsJoined} nhóm`)
  if (groupsVisited > 0 && !groupsJoined) counts.push(`${groupsVisited} nhóm`)
  if (likes > 0) counts.push(`${likes} like`)
  if (comments > 0) counts.push(`${comments} cmt`)
  if (friendsSent > 0) counts.push(`${friendsSent} kết bạn`)
  if (r.posts_scanned) counts.push(`${r.posts_scanned} bài scan`)

  if (counts.length > 0) parts.push(counts.join(', '))

  // Duration
  const dur = r.duration_seconds
  if (dur) parts.push(dur < 60 ? `${dur}s` : `${Math.round(dur / 60)}m`)

  if (r.message) parts.push(r.message)
  return parts.length > 0 ? parts.join(' · ') : null
}
