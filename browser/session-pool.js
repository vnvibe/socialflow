/**
 * Browser Session Pool
 * Giữ browser mở giữa các job để tránh checkpoint từ việc đóng/mở liên tục
 */
const { launchBrowser } = require('./launcher')
const path = require('path')
const os = require('os')

const PROFILES_DIR = path.join(os.homedir(), '.socialflow', 'profiles')
const IDLE_TIMEOUT_MS = 20 * 60 * 1000 // 20 phút — giữ session sống lâu hơn giữa jobs
const MAX_SESSIONS = 4 // Giới hạn RAM — max 4 browser cùng lúc

// Map account_id -> { browser, context, storageFile, lastUsed, closing, busy, createdAt }
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
    // Check context còn sống không
    try {
      const pages = existing.context.pages()
      existing.lastUsed = Date.now()
      console.log(`[SESSION-POOL] Reusing session for ${account.username || id} (${pages.length} tabs)`)
      return existing
    } catch {
      // Browser/context đã chết, xóa và tạo mới
      console.log(`[SESSION-POOL] Session dead for ${account.username || id}, recreating...`)
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

  // If at max sessions, close oldest idle session first
  if (sessions.size >= MAX_SESSIONS) {
    let oldestId = null, oldestTime = Infinity
    for (const [sid, s] of sessions) {
      if (!s.busy && !s.closing && s.lastUsed < oldestTime) {
        oldestTime = s.lastUsed
        oldestId = sid
      }
    }
    if (oldestId) {
      console.log(`[SESSION-POOL] At max ${MAX_SESSIONS} sessions, evicting idle session ${oldestId.slice(0, 8)}`)
      await closeSession(oldestId)
    }
  }

  const entry = {
    browser: session.browser,
    context: session.context,
    storageFile: session.storageFile,
    profileDir: session.profileDir,
    isPersistent: true, // launchPersistentContext — browser data tách riêng mỗi nick
    lastUsed: Date.now(),
    createdAt: Date.now(),
    closing: false,
    busy: false,
  }

  sessions.set(id, entry)
  startCleanup()
  return entry
}

// Per-account lock to prevent concurrent getPage for same nick
const sessionLocks = new Map()

/**
 * Tạo page mới với cookies từ account
 * @param {object} account - account record từ DB
 * @param {object} opts - { headless: boolean } - override headless mode
 */
async function getPage(account, opts = {}) {
  const id = account.id || account.account_id

  // Wait for any pending getPage for this account (prevent concurrent access)
  while (sessionLocks.has(id)) {
    await sessionLocks.get(id)
  }
  let lockResolve
  sessionLocks.set(id, new Promise(r => { lockResolve = r }))

  try {
  return await _getPageInternal(account, opts)
  } finally {
    sessionLocks.delete(id)
    lockResolve()
  }
}

async function _getPageInternal(account, opts = {}) {
  let session = await getSession(account, opts)
  const id = account.id || account.account_id
  session.busy = true

  // Reuse tab đang có thay vì mở tab mới
  let page = null
  try {
    const pages = session.context.pages()
    page = pages.find(p => !p.isClosed()) || null
    if (page) console.log(`[SESSION-POOL] Reusing existing tab for ${account.username || account.id}`)
  } catch {}

  const isNewPage = !page
  if (!page) {
    try {
      page = await session.context.newPage()
    } catch (err) {
      // Context/browser died — destroy and recreate
      console.log(`[SESSION-POOL] newPage failed: ${err.message}, recreating session...`)
      sessions.delete(id)
      const fresh = await getSession(account, opts)
      session = fresh // reassign for cookie injection below
      try {
        const freshPages = fresh.context.pages()
        page = freshPages.find(p => !p.isClosed()) || null
      } catch {}
      if (!page) page = await fresh.context.newPage()
    }
  }

  // Set cookies — chỉ inject khi session mới (persistent context giữ cookies tự động)
  if (account.cookie_string && !session._cookiesInjected) {
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
    await session.context.addCookies(cookies)
    session._cookiesInjected = true
    console.log(`[SESSION-POOL] Cookies injected for ${account.username || account.id} (${cookies.length} cookies)`)
  }

  // Warmup: navigate FB nếu page đang blank hoặc chưa ở facebook
  const currentUrl = page.url()
  const needsWarmup = !currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('facebook.com')
  if (needsWarmup) {
    try {
      console.log(`[SESSION-POOL] Warming up ${account.username || id} (was: ${currentUrl})`)
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      // Random wait 1.5-3s — không fix cứng
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500))
      const url = page.url()
      if (url.includes('/login') || url.includes('checkpoint')) {
        console.warn(`[SESSION-POOL] ⚠️ Not logged in: ${account.username || id} → ${url}`)
        // Mark session as problematic for error classification
        session._loginFailed = true
      }
    } catch (err) {
      console.warn(`[SESSION-POOL] Warmup failed for ${account.username || id}: ${err.message}`)
    }
  }

  // Dismiss any lingering dialogs from previous job (e.g. open composer)
  try {
    const hasDialog = await page.locator('[role="dialog"]').first().isVisible({ timeout: 500 }).catch(() => false)
    if (hasDialog) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  } catch {}

  return { page, session }
}

/**
 * Đánh dấu session idle (KHÔNG đóng)
 */
function releaseSession(accountId) {
  const session = sessions.get(accountId)
  if (session) {
    session.lastUsed = Date.now()
    session.busy = false
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
    // Persistent context: close context = close browser
    await session.context.close()
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
      // Dùng busy flag thay vì check pages.length (vì tab được reuse và không đóng)
      if (session.busy) {
        session.lastUsed = Date.now()
        console.log(`[SESSION-POOL] Session ${id} is busy, keeping alive`)
        continue
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
