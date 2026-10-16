import { contextBridge, ipcRenderer } from 'electron'
import type { MemeBotApi, TelegramMessage, TelegramStatus, UpdateStatus } from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

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
  telegram: {
    attach: (userId) => ipcRenderer.invoke('telegram:attach', userId),
    detach: () => ipcRenderer.invoke('telegram:detach'),
    startLogin: (apiId, apiHash, phone) => ipcRenderer.invoke('telegram:startLogin', apiId, apiHash, phone),
    submitCode: (code) => ipcRenderer.invoke('telegram:submitCode', code),
    submitPassword: (pw) => ipcRenderer.invoke('telegram:submitPassword', pw),
    logout: () => ipcRenderer.invoke('telegram:logout'),
    listChats: () => ipcRenderer.invoke('telegram:listChats'),
    setWatched: (ids) => ipcRenderer.invoke('telegram:setWatched', ids),
    onStatus: (cb) => subscribe<TelegramStatus>('telegram:status', cb),
    onMessage: (cb) => subscribe<TelegramMessage>('telegram:message', cb)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb) => subscribe<UpdateStatus>('updater:status', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
