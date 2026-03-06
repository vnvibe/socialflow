const axios = require('axios')
const { getDtsgWithRefresh, FB_HEADERS, buildAxiosProxy } = require('./fb-auth')

async function fetchPageInbox(fanpage, account, supabase) {
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
    console.error('Fetch inbox error:', err.message)
    return []
  }
}

async function replyToMessage(fanpage, account, threadId, replyText, supabase) {
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

  const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
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
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    const parsed = typeof data === 'string' ? JSON.parse(data) : data

    // Extract messages from GraphQL response
    const threads = parsed?.data?.page?.threads?.nodes || []
    const messages = []

    for (const thread of threads) {
      const lastMsg = thread.messages?.nodes?.[0]
      if (!lastMsg) continue

      messages.push({
        fanpage_id: fanpageId,
        fb_thread_id: thread.thread_key,
        fb_message_id: lastMsg.message_id,
        sender_name: lastMsg.sender?.name || 'Unknown',
        sender_fb_id: lastMsg.sender?.id,
        message_text: lastMsg.message?.text || '',
        message_type: 'inbox',
        received_at: new Date(lastMsg.timestamp_precise).toISOString()
      })
    }

    return messages
  } catch {
    return []
  }
}

async function getProxy(proxyId, supabase) {
  const { data } = await supabase.from('proxies').select('*').eq('id', proxyId).single()
  return data
}

module.exports = { fetchPageInbox, replyToMessage }
