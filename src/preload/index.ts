import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, UpdateStatus } from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DesktopApi = {
  appVersion: () => ipcRenderer.invoke('app:version'),
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb) => subscribe<UpdateStatus>('updater:status', cb)
  },
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    configure: (patch) => ipcRenderer.invoke('engine:configure', patch)
  }
}

contextBridge.exposeInMainWorld('desktop', api)
