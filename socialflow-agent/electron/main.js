const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { fork, execSync, spawn } = require('child_process')
const fs = require('fs')

// Global safety net — never let a child-process ENOENT crash the whole
// Electron main process. We log and swallow; individual handlers already
// surface the error to the UI. Prevents the "A JavaScript error occurred
// in the main process" dialog.
process.on('uncaughtException', (err) => {
  try { addLog(`[UNCAUGHT] ${err && err.message ? err.message : err}`, 'error') } catch {}
  console.error('[UNCAUGHT]', err)
})
process.on('unhandledRejection', (reason) => {
  try { addLog(`[UNHANDLED REJECTION] ${reason && reason.message ? reason.message : reason}`, 'error') } catch {}
  console.error('[UNHANDLED REJECTION]', reason)
})

let mainWindow = null
let tray = null
let agentProcess = null
let isQuitting = false
let logs = []
const MAX_LOGS = 500

// Paths — using __dirname consistently resolves through asar. The old
// path.join(process.resourcesPath, 'app') variant didn't, because the
// packaged app lives at resources/app.asar (a file), not resources/app
// (a folder). __dirname inside the asar evaluates to
// resources/app.asar/electron and going up one gives us the asar root
// that Electron's fs layer correctly reads inside.
const isPackaged = !process.defaultApp
const appRoot = path.join(__dirname, '..')

function addLog(line, type = 'info') {
  const entry = { time: new Date().toISOString(), text: line, type }
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.shift()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry)
  }
}

// Check if Playwright Chromium is installed
async function ensurePlaywright() {
  addLog('Checking Playwright Chromium...', 'info')
  try {
    // Try to get browser path
    const pw = require(path.join(appRoot, 'node_modules', 'playwright'))
    const chromium = pw.chromium
    const browserPath = chromium.executablePath()
    if (fs.existsSync(browserPath)) {
      addLog('Playwright Chromium ready', 'success')
      return true
    }
  } catch {}

  // Need to install
  addLog('Installing Playwright Chromium (first run, ~150MB)...', 'warn')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup-progress', 'Installing Chromium browser...')
  }

  return new Promise((resolve) => {
    // Windows Electron packaged apps sometimes launch with a minimal env
    // missing SystemRoot / ComSpec / PATH — `shell: true` then tries to
    // locate cmd.exe via those vars and throws `spawn cmd.exe ENOENT`.
    // Reconstruct a safe env before spawning.
    const safeEnv = { ...process.env }
    if (process.platform === 'win32') {
      safeEnv.SystemRoot = safeEnv.SystemRoot || 'C:\\Windows'
      safeEnv.ComSpec = safeEnv.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
      safeEnv.PATH = safeEnv.PATH || `${safeEnv.SystemRoot}\\System32;${safeEnv.SystemRoot}`
      if (!safeEnv.PATH.toLowerCase().includes('system32')) {
        safeEnv.PATH = `${safeEnv.SystemRoot}\\System32;${safeEnv.PATH}`
      }
    }
    safeEnv.PLAYWRIGHT_BROWSERS_PATH = path.join(appRoot, '.browsers')

    // Use fork() instead of spawn('npx.cmd') — .cmd files on Windows
    // REQUIRE cmd.exe as interpreter even with shell:false, and packaged
    // Electron apps often launch with a stripped env where cmd.exe can't
    // be located. fork() runs a Node script directly in the current
    // Electron's Node runtime → no shell, no .cmd wrapper needed.
    const playwrightCli = path.join(appRoot, 'node_modules', 'playwright', 'cli.js')
    if (!fs.existsSync(playwrightCli)) {
      addLog(`Playwright CLI not found at ${playwrightCli}`, 'error')
      return resolve(false)
    }

    const child = fork(playwrightCli, ['install', 'chromium'], {
      cwd: appRoot,
      env: safeEnv,
      silent: true,  // pipe stdout/stderr so we can stream install progress
    })

    // MUST attach 'error' listener — if fork itself fails (missing binary,
    // permissions), Node emits 'error' async. Without this handler,
    // Electron catches it as Uncaught Exception and shows the scary JS
    // error dialog.
    child.on('error', (err) => {
      addLog(`Chromium install fork failed: ${err.message}`, 'error')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup-progress', null)
      }
      resolve(false)
    })

    child.stdout.on('data', (d) => addLog(d.toString().trim(), 'info'))
    child.stderr.on('data', (d) => {
      const msg = d.toString().trim()
      if (msg) addLog(msg, 'warn')
    })

    child.on('close', (code) => {
      if (code === 0) {
        addLog('Chromium installed successfully', 'success')
        resolve(true)
      } else {
        addLog('Chromium install failed — agent may not work', 'error')
        resolve(false)
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup-progress', null)
      }
    })
  })
}

function startAgent() {
  if (agentProcess) return

  const agentPath = path.join(appRoot, 'agent.js')

  if (!fs.existsSync(agentPath)) {
    addLog(`agent.js not found at: ${agentPath}`, 'error')
    return
  }

  // Load .env if exists (optional — config.js has embedded credentials from build)
  const envVars = {}
  const envPath = path.join(appRoot, '.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/)
      if (match) envVars[match[1]] = match[2].trim()
    }
  }

  // Same safe-env treatment as ensurePlaywright — the forked agent spawns
  // powershell + taskkill on boot (killZombieChromium), needs SystemRoot.
  const forkEnv = { ...process.env, ...envVars }
  if (process.platform === 'win32') {
    forkEnv.SystemRoot = forkEnv.SystemRoot || 'C:\\Windows'
    forkEnv.ComSpec = forkEnv.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
    const sys32 = `${forkEnv.SystemRoot}\\System32`
    if (!forkEnv.PATH || !forkEnv.PATH.toLowerCase().includes('system32')) {
      forkEnv.PATH = `${sys32};${forkEnv.PATH || ''}`
    }
  }

  // Scope this agent to the logged-in user — poller filters jobs by
  // AGENT_USER_ID, so multiple users running the same binary each
  // process only their own campaigns.
  if (authSession) {
    forkEnv.AGENT_USER_ID = authSession.user.id
    forkEnv.AGENT_USER_EMAIL = authSession.user.email
    forkEnv.AGENT_USER_TOKEN = authSession.token
  }

  agentProcess = fork(agentPath, [], {
    cwd: appRoot,
    env: forkEnv,
    silent: true,
  })

  agentProcess.on('error', (err) => {
    addLog(`Agent fork failed: ${err.message}`, 'error')
    agentProcess = null
  })

  agentProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    lines.forEach(line => {
      const type = line.includes('[ERROR]') || line.includes('Error') ? 'error'
        : line.includes('[WARN]') ? 'warn'
        : line.includes('[OK]') ? 'success'
        : 'info'
      addLog(line, type)
    })
  })

  agentProcess.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => addLog(line, 'error'))
  })

  agentProcess.on('exit', (code) => {
    addLog(`Agent stopped (code: ${code})`, code === 0 ? 'info' : 'error')
    agentProcess = null
    updateTray()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { running: false })
    }
  })

  addLog('Agent started', 'success')
  updateTray()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { running: true })
  }
}

function stopAgent() {
  if (!agentProcess) return
  agentProcess.kill('SIGTERM')
  setTimeout(() => {
    if (agentProcess) {
      agentProcess.kill('SIGKILL')
      agentProcess = null
    }
  }, 5000)
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'SocialFlow Agent',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function updateTray() {
  if (!tray) return
  const running = !!agentProcess
  const contextMenu = Menu.buildFromTemplate([
    { label: `SocialFlow Agent — ${running ? 'Running' : 'Stopped'}`, enabled: false },
    { type: 'separator' },
    { label: 'Open', click: createWindow },
    {
      label: running ? 'Stop Agent' : 'Start Agent',
      click: () => running ? stopAgent() : startAgent()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        stopAgent()
        setTimeout(() => app.quit(), 1500)
      }
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.setToolTip(`SocialFlow Agent — ${running ? 'Running' : 'Stopped'}`)
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png')
  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
    icon = icon.resize({ width: 16, height: 16 })
  } else {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  tray.on('double-click', createWindow)
  updateTray()
}

// ── Auth (SaaS login) ──────────────────────────────────────────────────
// Each user's agent runs against THEIR campaigns; the poller filters
// jobs by user_id. So we need email+password login that calls the VPS
// API /auth/login (not Supabase cloud — that DB is dead) and persists
// { token, user } to disk so the session survives restart.

const AUTH_STORE_PATH = path.join(app.getPath('userData'), 'auth.json')
let authSession = null // { token, user: { id, email, username } }

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_STORE_PATH)) {
      authSession = JSON.parse(fs.readFileSync(AUTH_STORE_PATH, 'utf8'))
    }
  } catch (err) {
    authSession = null
    try { fs.unlinkSync(AUTH_STORE_PATH) } catch {}
  }
  return authSession
}

function saveAuth(session) {
  authSession = session
  try {
    if (session) fs.writeFileSync(AUTH_STORE_PATH, JSON.stringify(session, null, 2))
    else if (fs.existsSync(AUTH_STORE_PATH)) fs.unlinkSync(AUTH_STORE_PATH)
  } catch (err) {
    addLog(`[AUTH] failed to persist session: ${err.message}`, 'warn')
  }
}

async function apiLogin(email, password) {
  // Resolve API URL from config.js (build-embedded) or env.
  let apiUrl = process.env.API_URL || process.env.API_BASE_URL
  if (!apiUrl) {
    try {
      const cfg = require(path.join(appRoot, 'lib', 'config'))
      apiUrl = cfg.API_URL || 'https://103-142-24-60.sslip.io'
    } catch {
      apiUrl = 'https://103-142-24-60.sslip.io'
    }
  }
  const url = `${apiUrl.replace(/\/$/, '')}/auth/login`
  const body = JSON.stringify({ email, password })

  const https = require('https')
  const http = require('http')
  const lib = url.startsWith('https:') ? https : http
  return new Promise((resolve) => {
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (res.statusCode === 200 && json.token) {
            resolve({ ok: true, token: json.token, user: json.user })
          } else {
            resolve({ ok: false, error: json.error || `HTTP ${res.statusCode}` })
          }
        } catch (err) {
          resolve({ ok: false, error: 'invalid response' })
        }
      })
    })
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.write(body)
    req.end()
  })
}

// IPC handlers
ipcMain.handle('get-status', () => ({ running: !!agentProcess, loggedIn: !!authSession }))
ipcMain.handle('get-logs', () => logs)
ipcMain.handle('start-agent', async () => {
  if (!authSession) {
    addLog('[AGENT] Login required before starting', 'warn')
    return false
  }
  await ensurePlaywright()
  startAgent()
  return true
})
ipcMain.handle('stop-agent', () => { stopAgent(); return true })
ipcMain.handle('clear-logs', () => { logs = []; return true })

ipcMain.handle('auth:login', async (_, { email, password }) => {
  const result = await apiLogin(email, password)
  if (result.ok) {
    saveAuth({ token: result.token, user: result.user })
    addLog(`[AUTH] Logged in as ${result.user.email}`, 'success')
  } else {
    addLog(`[AUTH] Login failed: ${result.error}`, 'error')
  }
  return result
})
ipcMain.handle('auth:logout', async () => {
  stopAgent()
  saveAuth(null)
  addLog('[AUTH] Logged out', 'info')
  return { ok: true }
})
ipcMain.handle('auth:me', () => authSession?.user || null)

// App lifecycle
app.whenReady().then(async () => {
  loadAuth()
  createTray()
  createWindow()

  // Auto-start ONLY if previously logged in — otherwise UI shows
  // login form and waits for the user.
  if (authSession) {
    await ensurePlaywright()
    startAgent()
  }
})

app.on('window-all-closed', () => {
  // Stay in tray
})

app.on('activate', createWindow)

app.on('before-quit', () => {
  isQuitting = true
  stopAgent()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.close()
  }
})
