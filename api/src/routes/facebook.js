const axios = require('axios')

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

module.exports = async (fastify) => {
  const { supabase } = fastify

  /**
   * Helper: get the full facebook_api settings from system_settings
   */
  async function getFacebookSettings() {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'facebook_api')
      .single()
    return data?.value || {}
  }

  /**
   * Helper: get the real (unmasked) access token from system_settings
   */
  async function getAccessToken() {
    const settings = await getFacebookSettings()
    const token = settings.access_token
    if (!token || token.endsWith('...')) return null
    return token
  }

  /**
   * Helper: exchange short-lived token → long-lived token (60 days)
   */
  async function exchangeForLongLivedToken(shortToken, appId, appSecret) {
    const { data } = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      timeout: 15000,
    })
    return data // { access_token, token_type, expires_in }
  }

  // POST /facebook/test-token - Test Graph API token
  fastify.post('/test-token', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    // Allow testing with a provided token (before saving) or the saved one
    let token = req.body?.access_token
    if (!token || token.endsWith('...')) {
      token = await getAccessToken()
    }
    if (!token) return reply.code(400).send({ error: 'Access token required' })

    try {
      const { data } = await axios.get(`${GRAPH_API_BASE}/me`, {
        params: {
          access_token: token,
          fields: 'id,name'
        },
        timeout: 10000,
      })

      // Also check token info for expiration
      let tokenInfo = null
      try {
        const debugResp = await axios.get(`${GRAPH_API_BASE}/debug_token`, {
          params: {
            input_token: token,
            access_token: token,
          },
          timeout: 10000,
        })
        tokenInfo = debugResp.data?.data
      } catch {}

      return {
        success: true,
        user: data,
        token_info: tokenInfo ? {
          app_id: tokenInfo.app_id,
          type: tokenInfo.type,
          expires_at: tokenInfo.expires_at ? new Date(tokenInfo.expires_at * 1000).toISOString() : 'never',
          scopes: tokenInfo.scopes,
          is_valid: tokenInfo.is_valid,
        } : null,
      }
    } catch (err) {
      const fbError = err.response?.data?.error
      fastify.log.error({
        fbError,
        message: err.message,
        tokenPreview: token ? token.substring(0, 20) + '...' : 'NULL',
        statusCode: err.response?.status,
      }, '[TEST-TOKEN] Facebook API error')
      return reply.code(400).send({
        success: false,
        error: fbError?.message || err.message,
        code: fbError?.code,
      })
    }
  })

  // POST /facebook/exchange-token - Exchange short-lived → long-lived token & save
  fastify.post('/exchange-token', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    let token = req.body?.access_token
    if (!token || token.endsWith('...')) {
      token = await getAccessToken()
    }
    if (!token) return reply.code(400).send({ error: 'Access token required' })

    // Get app credentials from settings or request
    const settings = await getFacebookSettings()
    const appId = req.body?.app_id || settings.app_id
    const appSecret = req.body?.app_secret || settings.app_secret
    if (!appId || !appSecret) {
      return reply.code(400).send({ error: 'App ID và App Secret cần được cấu hình trước' })
    }

    try {
      const result = await exchangeForLongLivedToken(token, appId, appSecret)
      const longLivedToken = result.access_token
      const expiresIn = result.expires_in // seconds

      // Save new long-lived token to DB
      await supabase
        .from('system_settings')
        .upsert({
          key: 'facebook_api',
          value: {
            ...settings,
            access_token: longLivedToken,
            app_id: appId,
            app_secret: appSecret,
            token_exchanged_at: new Date().toISOString(),
            token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
          },
          updated_at: new Date().toISOString(),
          updated_by: req.user.id,
        })

      fastify.log.info(`[EXCHANGE-TOKEN] Successfully exchanged token, expires in ${Math.round(expiresIn / 86400)} days`)

      // Auto-sync page tokens with the new long-lived token
      syncPageTokensFromUserToken(fastify, longLivedToken).catch(err => {
        fastify.log.error({ err: err.message }, '[EXCHANGE-TOKEN] Auto-sync page tokens failed')
      })

      return {
        success: true,
        expires_in: expiresIn,
        expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        message: `Token đã được đổi sang long-lived (${Math.round(expiresIn / 86400)} ngày). Đang tự động cập nhật token cho các Fanpage...`,
      }
    } catch (err) {
      const fbError = err.response?.data?.error
      fastify.log.error({ fbError, message: err.message }, '[EXCHANGE-TOKEN] Error')
      return reply.code(400).send({
        error: fbError?.message || err.message,
        code: fbError?.code,
      })
    }
  })

  // POST /facebook/fetch-pages - Fetch pages managed by user via Graph API
  fastify.post('/fetch-pages', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    let token = req.body?.access_token
    if (!token || token.endsWith('...')) {
      token = await getAccessToken()
    }
    if (!token) return reply.code(400).send({ error: 'Access token not configured' })

    try {
      const pages = []
      let url = `${GRAPH_API_BASE}/me/accounts`
      let params = {
        access_token: token,
        fields: 'id,name,category,fan_count,picture{url},link,access_token',
        limit: 100,
      }

      // Paginate through all pages
      let pageNum = 1
      while (url) {
        fastify.log.info(`[FETCH-PAGES] Fetching page ${pageNum}... (${pages.length} items so far)`)
        const { data: resp } = await axios.get(url, { params, timeout: 30000 })
        if (resp.data) {
          pages.push(...resp.data)
          fastify.log.info(`[FETCH-PAGES] Page ${pageNum}: got ${resp.data.length} items (total: ${pages.length})`)
        }

        // Next page of results
        url = resp.paging?.next || null
        params = {} // next URL has params baked in
        pageNum++

        // Safety: prevent infinite loop
        if (pageNum > 50) {
          fastify.log.warn('[FETCH-PAGES] Safety limit reached (50 pages), stopping pagination')
          break
        }
      }

      fastify.log.info(`[FETCH-PAGES] Done! Total pages found: ${pages.length}`)

      return {
        pages: pages.map(p => ({
          fb_page_id: p.id,
          name: p.name,
          category: p.category || '',
          fan_count: p.fan_count || 0,
          picture_url: p.picture?.data?.url || null,
          link: p.link || `https://www.facebook.com/${p.id}`,
          has_page_token: !!p.access_token,
          access_token: p.access_token,
        })),
        total: pages.length,
      }
    } catch (err) {
      const fbError = err.response?.data?.error
      fastify.log.error({ fbError, message: err.message }, '[FETCH-PAGES] Error fetching pages')
      return reply.code(400).send({
        error: fbError?.message || err.message,
        code: fbError?.code,
      })
    }
  })

  // POST /facebook/import-pages - Import selected pages into fanpages table
  fastify.post('/import-pages', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { account_id, pages } = req.body
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })
    if (!pages?.length) return reply.code(400).send({ error: 'pages[] required' })

    // Verify account exists
    const { data: account } = await supabase.from('accounts').select('id').eq('id', account_id).single()
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const results = []
    for (const page of pages) {
      try {
        // Upsert: if page already exists for this account, update; otherwise insert
        const { data: existing } = await supabase
          .from('fanpages')
          .select('id')
          .eq('account_id', account_id)
          .eq('fb_page_id', page.fb_page_id)
          .maybeSingle()

        if (existing) {
          // Update existing
          const updateData = {
            name: page.name,
            category: page.category || null,
            url: page.link || `https://www.facebook.com/${page.fb_page_id}`,
            access_token: page.access_token || null
          }
          // If page has token, set posting_method to access_token
          if (page.access_token) updateData.posting_method = 'access_token'
          await supabase.from('fanpages').update(updateData).eq('id', existing.id)

          results.push({ fb_page_id: page.fb_page_id, name: page.name, action: 'updated' })
        } else {
          // Insert new
          await supabase.from('fanpages').insert({
            account_id,
            fb_page_id: page.fb_page_id,
            name: page.name,
            category: page.category || null,
            url: page.link || `https://www.facebook.com/${page.fb_page_id}`,
            access_token: page.access_token || null,
            posting_method: page.access_token ? 'access_token' : 'auto'
          })

          results.push({ fb_page_id: page.fb_page_id, name: page.name, action: 'created' })
        }
      } catch (err) {
        results.push({ fb_page_id: page.fb_page_id, name: page.name, action: 'error', error: err.message })
      }
    }

    return {
      results,
      imported: results.filter(r => r.action !== 'error').length,
      errors: results.filter(r => r.action === 'error').length,
    }
  })

  // GET /facebook/pages-status - Check which pages in DB have access tokens
  fastify.get('/pages-status', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { data: fanpages, error } = await supabase
      .from('fanpages')
      .select('id, name, fb_page_id, access_token, account_id')
      .order('name')

    if (error) return reply.code(500).send({ error: error.message })

    return {
      pages: (fanpages || []).map(p => ({
        id: p.id,
        name: p.name,
        fb_page_id: p.fb_page_id,
        account_id: p.account_id,
        has_token: !!p.access_token,
        token_preview: p.access_token ? p.access_token.substring(0, 15) + '...' : null,
      })),
      total: fanpages?.length || 0,
      with_token: (fanpages || []).filter(p => p.access_token).length,
    }
  })
}

/**
 * Auto-sync all fanpage tokens when a new User Token is saved.
 */
async function syncPageTokensFromUserToken(fastify, userToken) {
  const { supabase } = fastify
  fastify.log.info('[AUTO-SYNC-PAGES] Fetching page tokens from User Token...')

  const pages = []
  let url = `${GRAPH_API_BASE}/me/accounts`
  let params = { access_token: userToken, fields: 'id,name,access_token', limit: 100 }
  let pageNum = 1

  while (url && pageNum <= 50) {
    const { data: resp } = await axios.get(url, { params, timeout: 30000 })
    if (resp.data) pages.push(...resp.data)
    url = resp.paging?.next || null
    params = {}
    pageNum++
  }

  if (!pages.length) {
    fastify.log.warn('[AUTO-SYNC-PAGES] No pages returned from Facebook')
    return
  }

  const { data: fanpages } = await supabase.from('fanpages').select('id, fb_page_id')
  if (!fanpages?.length) return

  let updated = 0
  for (const fp of fanpages) {
    const fbPage = pages.find(p => p.id === fp.fb_page_id)
    if (fbPage?.access_token) {
      const { error } = await supabase
        .from('fanpages')
        .update({ access_token: fbPage.access_token, token_status: 'active' })
        .eq('id', fp.id)
      if (!error) updated++
    }
  }

  fastify.log.info(`[AUTO-SYNC-PAGES] Updated ${updated}/${fanpages.length} page tokens`)
}
