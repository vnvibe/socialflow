/**
 * Browser Session Pool
 * Giữ browser mở giữa các job để tránh checkpoint từ việc đóng/mở liên tục
 */
const { launchBrowser } = require('./launcher')
const path = require('path')
const os = require('os')

const PROFILES_DIR = path.join(os.homedir(), '.socialflow', 'profiles')
const IDLE_TIMEOUT_MS = 15 * 60 * 1000 // 15 phút (tăng lên vì fetch có thể lâu)

// Map account_id -> { browser, context, storageFile, lastUsed, closing }
const sessions = new Map()

let cleanupInterval = null

/**
 * Lấy session hiện có hoặc tạo mới
 * @param {object} account - account record từ DB
 * @param {object} opts - { headless: boolean } - override headless mode
 */
async function getSession(account, opts = {}) {
  const id = account.id || account.account_id

  const existing = sessions.get(id)
  if (existing && !existing.closing) {
    // Check browser còn sống không
    try {
      const contexts = existing.browser.contexts()
      if (contexts.length > 0) {
        existing.lastUsed = Date.now()
        console.log(`[SESSION-POOL] Reusing session for ${account.username || id}`)
        return existing
      }
    } catch {
      // Browser đã chết, xóa và tạo mới
      sessions.delete(id)
    }
  }

  // Tạo session mới
  const headlessLabel = opts.headless ? ' (headless)' : ''
  console.log(`[SESSION-POOL] Creating new session for ${account.username || id}${headlessLabel}`)
  const session = await launchBrowser({ ...account, proxy: account.proxies ? {
    type: account.proxies.type || 'http',
    host: account.proxies.host,
    port: account.proxies.port,
    username: account.proxies.username,
    password: account.proxies.password
  } : account.proxy || null }, { headless: opts.headless })

  const entry = {
    browser: session.browser,
    context: session.context,
    storageFile: session.storageFile,
    profileDir: session.profileDir,
    lastUsed: Date.now(),
    closing: false,
  }

  sessions.set(id, entry)
  startCleanup()
  return entry
}

/**
 * Check xem profile dir đã có FB cookies hợp lệ chưa.
 * Hợp lệ = có c_user (uid) VÀ xs (session secret) và đều non-empty.
 */
async function hasValidFbCookies(context) {
  try {
    const cookies = await context.cookies('https://www.facebook.com')
    const cUser = cookies.find(c => c.name === 'c_user' && c.value && c.value.length > 0)
    const xs = cookies.find(c => c.name === 'xs' && c.value && c.value.length > 0)
    return !!(cUser && xs)
  } catch {
    return false
  }
}

/**
 * Inject cookies từ account.cookie_string (DB) vào context.
 * Chỉ gọi khi profile dir KHÔNG có cookies hợp lệ.
 */
async function injectDbCookies(context, account) {
  if (!account.cookie_string) return false
  const cookies = account.cookie_string.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=')
    return name ? {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: '.facebook.com',
      path: '/',
      secure: true,
      sameSite: 'None'
    } : null
  }).filter(Boolean)
  if (!cookies.length) return false
  await context.addCookies(cookies)
  return true
}

/**
 * Tạo page mới với cookies từ account.
 *
 * Cookie priority (Fix checkpoint spam):
 *   1. Profile dir cookies (persistent storage.json) — fresh, do playwright giữ live
 *   2. DB cookies (account.cookie_string) — fallback khi profile trống/invalid
 *
 * DB cookies thường stale (user paste 1 lần rồi thôi) → nếu inject đè lên profile
 * sẽ ghi đè session đang hoạt động → FB detect inconsistency → checkpoint.
 *
 * @param {object} account - account record từ DB
 * @param {object} opts - { headless: boolean } - override headless mode
 */
async function getPage(account, opts = {}) {
  const id = account.id || account.account_id
  const username = account.username || id

  let session = await getSession(account, opts)
  let page

  // Thử newPage — nếu fail, recreate session rồi thử lại
  try {
    page = await session.context.newPage()
  } catch (err) {
    console.warn(`[SESSION-POOL] newPage failed for ${username}: ${err.message} — recreating session`)
    try { await closeSession(id) } catch {}
    session = await getSession(account, opts)
    page = await session.context.newPage()
  }

  // Decide cookie source: profile > DB
  const profileHasCookies = await hasValidFbCookies(session.context)
  if (profileHasCookies) {
    console.log(`[SESSION-POOL] 🍪 Using profile cookies for ${username} (profile dir has valid c_user+xs)`)
  } else {
    const injected = await injectDbCookies(session.context, account)
    if (injected) {
      console.log(`[SESSION-POOL] 💉 Injecting DB cookies for ${username} (profile dir empty/invalid)`)
    } else {
      console.warn(`[SESSION-POOL] ⚠️  No cookies available for ${username} — neither profile nor DB has FB cookies`)
    }
  }

  return { page, session }
}

/**
 * Đánh dấu session idle (KHÔNG đóng)
 */
function releaseSession(accountId) {
  const session = sessions.get(accountId)
  if (session) {
    session.lastUsed = Date.now()
  }
}

/**
 * Đóng session thật + save cookies
 */
async function closeSession(accountId) {
  const session = sessions.get(accountId)
  if (!session || session.closing) return

  session.closing = true
  console.log(`[SESSION-POOL] Closing session for ${accountId}`)

  try {
    await session.context.storageState({ path: session.storageFile })
  } catch {}
  try {
    await session.browser.close()
  } catch {}

  sessions.delete(accountId)
}

/**
 * Đóng tất cả sessions (gọi khi agent shutdown)
 */
async function closeAll() {
  console.log(`[SESSION-POOL] Closing all ${sessions.size} sessions...`)
  const promises = []
  for (const [id] of sessions) {
    promises.push(closeSession(id))
  }
  await Promise.allSettled(promises)
  stopCleanup()
}

/**
 * Cleanup idle sessions - KHÔNG đóng nếu còn page đang mở (đang chạy job)
 */
function cleanupIdleSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > IDLE_TIMEOUT_MS && !session.closing) {
      // Check xem còn page nào đang mở không (= đang chạy job)
      try {
        const pages = session.context.pages()
        if (pages.length > 0) {
          // Có page đang mở → job đang chạy, KHÔNG đóng, refresh lastUsed
          session.lastUsed = Date.now()
          console.log(`[SESSION-POOL] Session ${id} has ${pages.length} active pages, keeping alive`)
          continue
        }
      } catch {
        // Context đã chết, đóng luôn
      }
      console.log(`[SESSION-POOL] Session ${id} idle for ${Math.round(IDLE_TIMEOUT_MS / 60000)}min, closing...`)
      closeSession(id)
    }
  }
}

function startCleanup() {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupIdleSessions, 30000) // check mỗi 30s
  }
}

function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

function getActiveSessions() {
  return sessions.size
}

module.exports = {
  getSession,
  getPage,
  releaseSession,
  closeSession,
  closeAll,
  getActiveSessions,
}
