import { contextBridge, ipcRenderer } from 'electron'
import type { MemeBotApi, UpdateStatus } from '../shared/types'

const api: MemeBotApi = {
  appVersion: () => ipcRenderer.invoke('app:version'),
  gmgn: {
    saveCredentials: (userId, apiKey, pem) => ipcRenderer.invoke('gmgn:save', userId, apiKey, pem),
    hasCredentials: (userId) => ipcRenderer.invoke('gmgn:has', userId),
    clearCredentials: (userId) => ipcRenderer.invoke('gmgn:clear', userId),
    userInfo: (userId) => ipcRenderer.invoke('gmgn:userInfo', userId),
    tokenInfo: (userId, mint) => ipcRenderer.invoke('gmgn:tokenInfo', userId, mint),
    tokenSecurity: (userId, mint) => ipcRenderer.invoke('gmgn:tokenSecurity', userId, mint)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb) => {
      const listener = (_e: unknown, s: UpdateStatus) => cb(s)
      ipcRenderer.on('updater:status', listener)
      return () => ipcRenderer.removeListener('updater:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
