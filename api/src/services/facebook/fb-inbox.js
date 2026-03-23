const axios = require('axios')
const { getDtsgWithRefresh, FB_HEADERS, buildAxiosProxy } = require('./fb-auth')

async function fetchPageInbox(fanpage, account, supabase) {
  // If page has access_token → use Graph API (fast, stable)
  if (fanpage.access_token) {
    return fetchInboxViaGraphAPI(fanpage)
  }

  // No token → use cookie, but limit to once per 6 hours
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  if (fanpage.inbox_last_checked_at && fanpage.inbox_last_checked_at > sixHoursAgo) {
    console.log(`[INBOX] Skipping ${fanpage.name} — last checked ${fanpage.inbox_last_checked_at}, next after 6h`)
    return []
  }

  return fetchInboxViaCookie(fanpage, account, supabase)
}

// Graph API method — requires page access_token
// Loads all messages per thread (up to 50 per thread, 25 threads)
async function fetchInboxViaGraphAPI(fanpage) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v19.0/${fanpage.fb_page_id}/conversations`, {
      params: {
        fields: 'id,updated_time,participants,messages.limit(50){message,from,created_time,attachments}',
        limit: 25,
        access_token: fanpage.access_token,
      }
    })

    const threads = res.data?.data || []
    const allMessages = []

    for (const thread of threads) {
      const msgs = thread.messages?.data || []
      for (const msg of msgs) {
        if (!msg.message && !msg.attachments) continue
        allMessages.push({
          fanpage_id: fanpage.id,
          fb_thread_id: thread.id,
          fb_message_id: msg.id,
          sender_name: msg.from?.name || 'Unknown',
          sender_fb_id: msg.from?.id,
          message_text: msg.message || '',
          message_type: 'inbox',
          received_at: msg.created_time || new Date().toISOString()
        })
      }
    }

    return allMessages
  } catch (err) {
    console.error('[INBOX] Graph API error:', err.response?.data?.error?.message || err.message)
    return []
  }
}

// Cookie method — fallback, rate limited
async function fetchInboxViaCookie(fanpage, account, supabase) {
  const proxy = account.proxy_id ? await getProxy(account.proxy_id, supabase) : null
  const dtsg = await getDtsgWithRefresh(account, supabase, proxy)

  const body = new URLSearchParams({
    fb_dtsg: dtsg,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PageThreadListQuery',
    variables: JSON.stringify({
      pageID: fanpage.fb_page_id,
      count: 20,
      beforeTimestamp: null
    }),
    doc_id: '6104853496266146'
  })

  try {
    const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
      headers: {
        Cookie: account.cookie_string,
        'User-Agent': account.user_agent,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...FB_HEADERS
      },
      ...(proxy && { proxy: buildAxiosProxy(proxy) })
    })

    return parseInboxResult(res.data, fanpage.id)
  } catch (err) {
    console.error('[INBOX] Cookie fetch error:', err.message)
    return []
  }
}

async function replyToMessage(fanpage, account, threadId, replyText, supabase) {
  // If page has access_token → use Graph API
  if (fanpage.access_token) {
    try {
      await axios.post(`https://graph.facebook.com/v19.0/${threadId}/messages`, {
        message: replyText,
      }, {
        params: { access_token: fanpage.access_token }
      })
      return { success: true }
    } catch (err) {
      console.error('[INBOX] Reply via Graph API error:', err.response?.data?.error?.message || err.message)
      throw err
    }
  }

  // Fallback: cookie
  const proxy = account.proxy_id ? await getProxy(account.proxy_id, supabase) : null
  const dtsg = await getDtsgWithRefresh(account, supabase, proxy)

  const body = new URLSearchParams({
    fb_dtsg: dtsg,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PageSendMessageMutation',
    variables: JSON.stringify({
      input: {
        page_id: fanpage.fb_page_id,
        thread_id: threadId,
        message: { text: replyText }
      }
    }),
    doc_id: '6868237146543901'
  })

  await axios.post('https://www.facebook.com/api/graphql/', body, {
    headers: {
      Cookie: account.cookie_string,
      'User-Agent': account.user_agent,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...FB_HEADERS
    },
    ...(proxy && { proxy: buildAxiosProxy(proxy) })
  })

  return { success: true }
}

function parseInboxResult(data, fanpageId) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data

    // Extract ALL messages from GraphQL response
    const threads = parsed?.data?.page?.threads?.nodes || []
    const messages = []

    for (const thread of threads) {
      const threadMsgs = thread.messages?.nodes || []
      for (const msg of threadMsgs) {
        if (!msg.message?.text) continue
        messages.push({
          fanpage_id: fanpageId,
          fb_thread_id: thread.thread_key,
          fb_message_id: msg.message_id,
          sender_name: msg.sender?.name || 'Unknown',
          sender_fb_id: msg.sender?.id,
          message_text: msg.message?.text || '',
          message_type: 'inbox',
          received_at: new Date(parseInt(msg.timestamp_precise)).toISOString()
        })
      }
    }

    return messages
  } catch {
    return []
  }
}

// ============================================
// PERSONAL MESSENGER — cookie-based only
// ============================================

async function fetchPersonalInbox(account, supabase) {
  const proxy = account.proxy_id ? await getProxy(account.proxy_id, supabase) : null
  const dtsg = await getDtsgWithRefresh(account, supabase, proxy)

  // Use Mercury/Lightspeed thread list query
  const body = new URLSearchParams({
    fb_dtsg: dtsg,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'LSPlatformGraphQLLightspeedRequestForIGDQuery',
    variables: JSON.stringify({
      deviceId: account.fb_user_id,
      requestId: 0,
      requestPayload: JSON.stringify({
        database: 1,
        version: '9477666248971112',
        epoch_id: 0,
        last_applied_cursor: null,
        sync_params: JSON.stringify({}),
      }),
      requestType: 1,
    }),
    doc_id: '7357610580975136'
  })

  try {
    const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
      headers: {
        Cookie: account.cookie_string,
        'User-Agent': account.user_agent,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...FB_HEADERS
      },
      ...(proxy && { proxy: buildAxiosProxy(proxy) }),
      timeout: 15000,
    })

    return parsePersonalInbox(res.data, account.id)
  } catch (err) {
    console.error('[INBOX] Personal messenger error:', err.message)
    // Fallback: try older mercury API
    return fetchPersonalInboxFallback(account, dtsg, proxy)
  }
}

// Fallback: use older thread_info API
async function fetchPersonalInboxFallback(account, dtsg, proxy) {
  try {
    const body = new URLSearchParams({
      fb_dtsg: dtsg,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'MercuryThreadlistQuery',
      variables: JSON.stringify({
        limit: 20,
        before: null,
        tags: ['inbox'],
        includeDeliveryReceipts: false,
        includeSeqID: false,
      }),
      doc_id: '3336396659757958'
    })

    const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
      headers: {
        Cookie: account.cookie_string,
        'User-Agent': account.user_agent,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...FB_HEADERS
      },
      ...(proxy && { proxy: buildAxiosProxy(proxy) }),
      timeout: 15000,
    })

    return parseMercuryThreadList(res.data, account.id)
  } catch (err) {
    console.error('[INBOX] Mercury fallback error:', err.message)
    return []
  }
}

function parsePersonalInbox(data, accountId) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    const steps = parsed?.data?.lightspeed_web_request_for_igd?.payload?.steps || []
    const messages = []

    for (const step of steps) {
      if (!step?.step_data) continue
      try {
        const stepData = typeof step.step_data === 'string' ? JSON.parse(step.step_data) : step.step_data
        // Extract thread/message data from Lightspeed response
        if (Array.isArray(stepData)) {
          for (const row of stepData) {
            if (row?.threadKey && row?.snippet) {
              messages.push({
                account_id: accountId,
                fb_thread_id: row.threadKey,
                fb_message_id: `${row.threadKey}_${row.timestampMs || Date.now()}`,
                sender_name: row.senderName || row.participantNames?.[0] || 'Unknown',
                sender_fb_id: row.senderId || null,
                message_text: row.snippet || '',
                message_type: 'personal',
                received_at: row.timestampMs ? new Date(parseInt(row.timestampMs)).toISOString() : new Date().toISOString(),
              })
            }
          }
        }
      } catch { /* skip malformed step */ }
    }

    return messages
  } catch {
    return []
  }
}

function parseMercuryThreadList(data, accountId) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    const threads = parsed?.data?.viewer?.message_threads?.nodes || []
    const messages = []

    for (const thread of threads) {
      const lastMsg = thread.last_message?.nodes?.[0]
      const participants = thread.all_participants?.nodes || []
      const otherUser = participants.find(p => p.messaging_actor?.id !== String(accountId))

      messages.push({
        account_id: accountId,
        fb_thread_id: thread.thread_key?.thread_fbid || thread.thread_key?.other_user_id,
        fb_message_id: lastMsg?.message_id || `thread_${thread.thread_key?.thread_fbid}_${Date.now()}`,
        sender_name: otherUser?.messaging_actor?.name || lastMsg?.message_sender?.messaging_actor?.name || 'Unknown',
        sender_fb_id: otherUser?.messaging_actor?.id || null,
        message_text: lastMsg?.message?.text || lastMsg?.snippet || '',
        message_type: 'personal',
        received_at: lastMsg?.timestamp_precise ? new Date(parseInt(lastMsg.timestamp_precise)).toISOString() : new Date().toISOString(),
      })
    }

    return messages
  } catch {
    return []
  }
}

async function replyPersonalMessage(account, threadId, replyText, supabase) {
  const proxy = account.proxy_id ? await getProxy(account.proxy_id, supabase) : null
  const dtsg = await getDtsgWithRefresh(account, supabase, proxy)

  const body = new URLSearchParams({
    fb_dtsg: dtsg,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'useSendMessageMutation',
    variables: JSON.stringify({
      input: {
        thread_id: threadId,
        message: { text: replyText },
        actor_id: account.fb_user_id,
      }
    }),
    doc_id: '7197189730318592'
  })

  await axios.post('https://www.facebook.com/api/graphql/', body, {
    headers: {
      Cookie: account.cookie_string,
      'User-Agent': account.user_agent,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...FB_HEADERS
    },
    ...(proxy && { proxy: buildAxiosProxy(proxy) }),
  })

  return { success: true }
}

async function getProxy(proxyId, supabase) {
  const { data } = await supabase.from('proxies').select('*').eq('id', proxyId).single()
  return data
}

module.exports = { fetchPageInbox, replyToMessage, fetchPersonalInbox, replyPersonalMessage }
