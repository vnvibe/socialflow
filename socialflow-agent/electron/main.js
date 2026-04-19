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

// Paths
const isPackaged = !process.defaultApp
const appRoot = isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..')

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

// IPC handlers
ipcMain.handle('get-status', () => ({ running: !!agentProcess }))
ipcMain.handle('get-logs', () => logs)
ipcMain.handle('start-agent', async () => {
  await ensurePlaywright()
  startAgent()
  return true
})
ipcMain.handle('stop-agent', () => { stopAgent(); return true })
ipcMain.handle('clear-logs', () => { logs = []; return true })

// App lifecycle
app.whenReady().then(async () => {
  createTray()
  createWindow()

  // Auto-setup and start
  await ensurePlaywright()
  startAgent()
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
