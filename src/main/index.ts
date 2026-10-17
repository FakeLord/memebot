import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { setupUpdater } from './updater'
import { EngineHost } from './engineHost'

// Masaüstü kabuğu: arayüzü gösterir, otomatik güncellemeyi yönetir ve (ayarlıysa) motoru bu
// bilgisayarda arka planda çalıştırır. Alım-satım, GMGN, Telegram, X mantığı motorda (src/engine).

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#111113',
    // Paketli uygulamada ikon .exe'den gelir; geliştirmede build/icon.png
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    title: 'MemeBot',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  // Dış bağlantılar (Solscan vb.) varsayılan tarayıcıda açılır; uygulama içinde değil.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(updater: ReturnType<typeof setupUpdater>, engine: EngineHost): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('updater:check', () => updater.check())
  ipcMain.handle('updater:install', () => updater.install())
  ipcMain.handle('engine:status', () => engine.status())
  ipcMain.handle('engine:configure', (_e, patch: { enabled?: unknown; serviceRoleKey?: unknown }) => {
    try {
      const clean: { enabled?: boolean; serviceRoleKey?: string } = {}
      if (typeof patch?.enabled === 'boolean') clean.enabled = patch.enabled
      if (typeof patch?.serviceRoleKey === 'string') clean.serviceRoleKey = patch.serviceRoleKey
      return { ok: true, status: engine.configure(clean) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

// Aynı bilgisayarda uygulama iki kez açılmasın (iki motor süreci olmasın)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  const engine = new EngineHost(import.meta.env.VITE_SUPABASE_URL as string | undefined)

  app.whenReady().then(() => {
    app.setAppUserModelId('com.fakelord.memebot')
    registerIpc(setupUpdater(() => win), engine)
    engine.start()
    createWindow()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    // Motora kibarca kapanma fırsatı ver (açık işlemlerin durumu yazılsın)
    e.preventDefault()
    quitting = true
    engine.shutdown().finally(() => app.quit())
  })

  app.on('window-all-closed', () => app.quit())
}
