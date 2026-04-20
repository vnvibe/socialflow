const { chromium } = require('playwright')
const path = require('path')
const os = require('os')
const fs = require('fs')

const PROFILES_DIR = path.join(os.homedir(), '.socialflow', 'profiles')

// launchPersistentContext gives each nick its OWN Chromium user-data-dir —
// cookies, localStorage, IndexedDB, service workers, cache, fingerprint
// all persist across runs exactly like a real user. Old approach (launch
// + newContext storageState) only kept cookies + localStorage, so FB saw
// a "fresh browser" every session and raised checkpoint risk.
//
// Returns { browser, context, profileDir, storageFile } to keep callers
// stable — browser === context.browser() on persistent contexts.
async function launchBrowser(account, options = {}) {
  const profileDir = path.join(PROFILES_DIR, account.id)
  fs.mkdirSync(profileDir, { recursive: true })

  const storageFile = path.join(profileDir, 'storage.json')
  const proxyConfig = account.proxy || null

  const headless = options.headless !== undefined ? options.headless : process.env.HEADLESS === 'true'

  const launchOptions = {
    headless,
    userAgent: account.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: account.viewport || { width: 1366, height: 768 },
    locale: 'vi-VN',
    timezoneId: account.timezone || 'Asia/Ho_Chi_Minh',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--disable-features=IsolateOrigins,site-per-process',
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

  // First boot: if we have a storage.json from the old non-persistent flow,
  // migrate it into the new persistent profile once by passing storageState.
  // launchPersistentContext accepts it for initial population then keeps
  // everything inside profileDir. After first run the file stays as a
  // reference backup (saveAndClose still writes to it).
  const oldStorageExists = fs.existsSync(storageFile) &&
    !fs.existsSync(path.join(profileDir, 'Default'))
  if (oldStorageExists) {
    launchOptions.storageState = storageFile
  }

  const context = await browserType.launchPersistentContext(profileDir, launchOptions)

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
    window.chrome = { runtime: {} }
  })

  const browser = context.browser()
  return { browser, context, profileDir, storageFile }
}

async function saveAndClose(browser, context, storageFile) {
  // Persistent context writes profile-dir on its own; we also dump a
  // portable storageState.json for disaster recovery / cookie export.
  try { await context.storageState({ path: storageFile }) } catch {}
  try { await context.close() } catch {}
  try { if (browser) await browser.close() } catch {}
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
