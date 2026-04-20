const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agent', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  start: () => ipcRenderer.invoke('start-agent'),
  stop: () => ipcRenderer.invoke('stop-agent'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  onLog: (callback) => {
    ipcRenderer.on('log', (_, entry) => callback(entry))
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (_, status) => callback(status))
  },
  onSetup: (callback) => {
    ipcRenderer.on('setup-progress', (_, msg) => callback(msg))
  },
})

// SaaS login — hits API /auth/login, stores JWT + user locally so the
// poller can filter jobs for the correct owner. Without this the agent
// would either run for no one (single-user embed) or against the wrong
// user's campaigns.
contextBridge.exposeInMainWorld('auth', {
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  me: () => ipcRenderer.invoke('auth:me'),
})
