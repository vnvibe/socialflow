const axios = require('axios')

const FB_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://www.facebook.com',
  'Referer': 'https://www.facebook.com/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors'
}

async function getFbDtsg(account, proxyConfig = null) {
  const res = await axios.get('https://www.facebook.com/', {
    headers: { Cookie: account.cookie_string, 'User-Agent': account.user_agent, ...FB_HEADERS },
    ...(proxyConfig && { proxy: buildAxiosProxy(proxyConfig) }),
    timeout: 15000
  })

  const patterns = [
    /"DTSGInitData".*?"token":"([^"]+)"/,
    /"fb_dtsg","value":"([^"]+)"/
  ]

  for (const p of patterns) {
    const m = res.data.match(p)
    if (m) return m[1]
  }
  return null
}

async function validateCookie(account, proxyConfig = null) {
  try {
    const res = await axios.get('https://www.facebook.com/', {
      headers: { Cookie: account.cookie_string, 'User-Agent': account.user_agent || getDefaultUA(), ...FB_HEADERS },
      ...(proxyConfig && { proxy: buildAxiosProxy(proxyConfig) }),
      timeout: 10000
    })

    const isLoggedIn = res.data.includes('"is_logged_in":true') ||
                       !res.data.includes('"is_logged_in":false')

    const ERROR_PATTERNS = {
      CHECKPOINT: ['checkpoint', 'security check', 'verify your identity'],
      SESSION_EXPIRED: ['session expired', 'please log in'],
      RATE_LIMIT: ['try again later', 'too many requests'],
      DISABLED: ['account disabled']
    }

    for (const [type, checks] of Object.entries(ERROR_PATTERNS)) {
      if (checks.some(c => res.data.toLowerCase().includes(c))) {
        return { valid: false, reason: type }
      }
    }

    return { valid: isLoggedIn }
  } catch {
    return { valid: false, reason: 'NETWORK_ERROR' }
  }
}

async function getDtsgWithRefresh(account, supabase, proxyConfig) {
  const now = new Date()
  const expiresAt = account.dtsg_expires_at ? new Date(account.dtsg_expires_at) : null

  if (!account.fb_dtsg || !expiresAt || now > new Date(expiresAt - 5 * 60 * 1000)) {
    const dtsg = await getFbDtsg(account, proxyConfig)
    if (!dtsg) throw new Error('Cannot get fb_dtsg - cookie may be expired')

    await supabase.from('accounts').update({
      fb_dtsg: dtsg,
      dtsg_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    }).eq('id', account.id)

    return dtsg
  }

  return account.fb_dtsg
}

function buildAxiosProxy(proxy) {
  return {
    host: proxy.host,
    port: proxy.port,
    ...(proxy.username && { auth: { username: proxy.username, password: proxy.password } })
  }
}

function getDefaultUA() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

function extractCUserId(cookieString) {
  const match = cookieString.match(/c_user=(\d+)/)
  return match ? match[1] : null
}

function generateFingerprint(seed) {
  const hash = require('crypto').createHash('md5').update(seed || '').digest('hex')
  const viewports = [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 }
  ]
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  const idx = parseInt(hash.substring(0, 8), 16)
  return {
    userAgent: userAgents[idx % userAgents.length],
    viewport: viewports[idx % viewports.length],
    timezone: 'Asia/Ho_Chi_Minh'
  }
}

module.exports = { getFbDtsg, validateCookie, getDtsgWithRefresh, FB_HEADERS, buildAxiosProxy, getDefaultUA, extractCUserId, generateFingerprint }
