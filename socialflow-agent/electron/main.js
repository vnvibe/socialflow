const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { fork } = require('child_process')

let mainWindow = null
let tray = null
let agentProcess = null
let isQuitting = false
let logs = []
const MAX_LOGS = 500

function addLog(line, type = 'info') {
  const entry = { time: new Date().toISOString(), text: line, type }
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.shift()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry)
  }
}

function startAgent() {
  if (agentProcess) return

  const isPackaged = app.isPackaged
  const appRoot = isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..')
  const agentPath = path.join(appRoot, 'agent.js')
  const envPath = isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(appRoot, '.env')

  // Load .env manually for the forked process
  const dotenv = require('dotenv')
  const envConfig = dotenv.config({ path: envPath })
  const env = { ...process.env, ...(envConfig.parsed || {}) }

  agentProcess = fork(agentPath, [], {
    cwd: appRoot,
    env,
    silent: true,
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
        stopAgent()
        setTimeout(() => app.quit(), 1000)
      }
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.setToolTip(`SocialFlow Agent — ${running ? 'Running' : 'Stopped'}`)
}

function createTray() {
  // Create a simple colored icon
  const iconPath = path.join(__dirname, 'icon.png')
  const fs = require('fs')

  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    // Fallback: create a simple 16x16 icon
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.on('double-click', createWindow)
  updateTray()
}

// IPC handlers
ipcMain.handle('get-status', () => ({ running: !!agentProcess }))
ipcMain.handle('get-logs', () => logs)
ipcMain.handle('start-agent', () => { startAgent(); return true })
ipcMain.handle('stop-agent', () => { stopAgent(); return true })
ipcMain.handle('clear-logs', () => { logs = []; return true })

// App lifecycle
app.whenReady().then(() => {
  createTray()
  createWindow()
  // Auto-start agent
  startAgent()
})

app.on('window-all-closed', () => {
  // Never quit automatically — always stay in tray
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
