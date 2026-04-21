const { chromium } = require('playwright')
const path = require('path')
const os = require('os')
const fs = require('fs')

const PROFILES_DIR = path.join(os.homedir(), '.socialflow', 'profiles')

// Per-nick deterministic fingerprint pool — each account.id hashes to
// a fixed (UA, viewport) combo so a nick always looks the same browser
// across sessions, but different nicks in the same campaign cluster
// don't all share the exact same UA string. FB's fingerprint-based
// multi-account clustering looks for identical UA+viewport across
// co-located logins; spreading these across the pool reduces that
// signal. 10 modern Chrome/Edge UAs + 5 common desktop viewports =
// 50 fingerprint cells.
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
]
const VIEWPORT_POOL = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

function pickFingerprint(accountId) {
  const seed = String(accountId || '')
  const hex1 = seed.match(/^([0-9a-f]{8})/i)
  const hex2 = seed.match(/^[0-9a-f]+-([0-9a-f]+)/i)
  let uaIdx, vpIdx
  if (hex1) {
    uaIdx = parseInt(hex1[1], 16) % UA_POOL.length
  } else {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
    uaIdx = Math.abs(h) % UA_POOL.length
  }
  if (hex2 && hex2[1]) {
    vpIdx = parseInt(hex2[1].slice(0, 4), 16) % VIEWPORT_POOL.length
  } else {
    let h = 131 // prime salt
    for (let i = 0; i < seed.length; i++) h = ((h << 3) + h + seed.charCodeAt(i)) | 0
    vpIdx = Math.abs(h) % VIEWPORT_POOL.length
  }
  return { userAgent: UA_POOL[uaIdx], viewport: VIEWPORT_POOL[vpIdx] }
}

// Revert to launch() + newContext({storageState}) — launchPersistentContext
// (attempted 2026-04-20 for full cookie/fingerprint independence) broke
// group-page scraping: nicks appeared logged-in but posts_found dropped
// to 0 on every visit. Session state didn't fully carry across the
// migration. Going back to the classic pattern; cookies + localStorage
// are persisted via storageState, which was sufficient for months prior.
async function launchBrowser(account, options = {}) {
  const profileDir = path.join(PROFILES_DIR, account.id)
  fs.mkdirSync(profileDir, { recursive: true })

  const storageFile = path.join(profileDir, 'storage.json')
  const proxyConfig = account.proxy || null

  const headless = options.headless !== undefined ? options.headless : process.env.HEADLESS === 'true'

  const launchOptions = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      ...(headless ? ['--disable-gpu'] : []),
    ],
    ...(proxyConfig && {
      proxy: {
        server: `${proxyConfig.type || 'http'}://${proxyConfig.host}:${proxyConfig.port}`,
        username: proxyConfig.username,
        password: proxyConfig.password
      }
    })
  }

  let browserType = chromium
  if (account.browser_type === 'camoufox') {
    const { firefox } = require('playwright')
    const camoPath = getCamoufoxPath()
    if (fs.existsSync(camoPath)) {
      browserType = firefox
      launchOptions.executablePath = camoPath
    } else {
      console.warn('[WARN] Camoufox not found, falling back to Chromium')
    }
  }

  const browser = await browserType.launch(launchOptions)

  const fp = pickFingerprint(account.id)
  const contextOptions = {
    userAgent: account.user_agent || fp.userAgent,
    viewport: account.viewport || fp.viewport,
    locale: 'vi-VN',
    timezoneId: account.timezone || 'Asia/Ho_Chi_Minh',
    ...(fs.existsSync(storageFile) && { storageState: storageFile })
  }

  const context = await browser.newContext(contextOptions)

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
    window.chrome = { runtime: {} }
  })

  return { browser, context, profileDir, storageFile }
}

async function saveAndClose(browser, context, storageFile) {
  try { await context.storageState({ path: storageFile }) } catch {}
  try { await browser.close() } catch {}
}

function getCamoufoxPath() {
  const paths = {
    linux: path.join(os.homedir(), '.socialflow', 'browsers', 'camoufox', 'firefox'),
    darwin: path.join(os.homedir(), '.socialflow', 'browsers', 'camoufox', 'Camoufox.app/Contents/MacOS/firefox'),
    win32: path.join(os.homedir(), '.socialflow', 'browsers', 'camoufox', 'camoufox.exe')
  }
  return paths[process.platform] || paths.linux
}

const delay = (min, max) => new Promise(r => setTimeout(r, Math.random() * (max - min) + min))

async function humanType(page, selector, text) {
  await page.click(selector)
  await delay(300, 700)
  for (const char of text) {
    await page.keyboard.type(char)
    await delay(40, 180)
  }
}

module.exports = { launchBrowser, saveAndClose, delay, humanType, getCamoufoxPath }
