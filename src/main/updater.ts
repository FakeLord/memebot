import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

// Güncellemeler GitHub Releases'ten gelir (electron-builder.yml → publish).
// Yeni sürüm: package.json sürümünü artır → "vX.Y.Z" etiketi push'la → GitHub Actions yayınlar.

const { autoUpdater } = electronUpdater

export function setupUpdater(getWindow: () => BrowserWindow | null): { check: () => Promise<void>; install: () => void } {
  const emit = (s: UpdateStatus) => getWindow()?.webContents.send('updater:status', s)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => emit({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => emit({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => emit({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => emit({ state: 'error', message: e.message }))

  const check = async () => {
    if (!app.isPackaged) {
      emit({ state: 'none' })
      return
    }
    await autoUpdater.checkForUpdates().catch((e: Error) => emit({ state: 'error', message: e.message }))
  }

  // Açılışta ve her 30 dakikada bir kontrol
  setTimeout(check, 5_000)
  setInterval(check, 30 * 60_000)

  return { check, install: () => autoUpdater.quitAndInstall() }
}
