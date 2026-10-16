import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { GmgnClient } from './gmgn/client'
import { assertSigningKey } from './gmgn/signer'
import type { GmgnPlan } from './gmgn/limiter'
import { clearGmgnCredentials, loadGmgnCredentials, saveGmgnCredentials } from './secrets'
import { setupUpdater } from './updater'
import { TelegramService } from './telegram/service'
import { isLikelyMint } from '../shared/extract'
import type { BuyRequest, GmgnResult, SellRequest } from '../shared/types'
import * as trade from './gmgn/trade'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0c',
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

function clientFor(userId: string): GmgnClient | null {
  const creds = loadGmgnCredentials(userId)
  return creds ? new GmgnClient(creds) : null
}

const NO_KEY: GmgnResult = { ok: false, status: 0, error: 'GMGN API anahtarı girilmemiş (Ayarlar)' }
const BAD_MINT: GmgnResult = { ok: false, status: 0, error: 'Geçersiz token adresi' }

function registerIpc(updater: ReturnType<typeof setupUpdater>): void {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('gmgn:save', (_e, userId: string, apiKey: string, pem: string) => {
    try {
      if (!apiKey?.trim()) throw new Error('API anahtarı boş')
      const normalized = pem.replace(/\\n/g, '\n').trim() + '\n'
      assertSigningKey(normalized)
      const prev = loadGmgnCredentials(userId)
      // Cüzdan API anahtarına bağlı: anahtar değiştiyse seçimi sıfırla
      const wallet = prev?.apiKey === apiKey.trim() ? prev.wallet : undefined
      saveGmgnCredentials(userId, { apiKey: apiKey.trim(), privateKeyPem: normalized, plan: prev?.plan, wallet })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('gmgn:has', (_e, userId: string) => loadGmgnCredentials(userId) !== null)
  ipcMain.handle('gmgn:getPlan', (_e, userId: string) => loadGmgnCredentials(userId)?.plan ?? 'free')
  ipcMain.handle('gmgn:setPlan', (_e, userId: string, plan: string) => {
    const creds = loadGmgnCredentials(userId)
    if (!creds || !['free', 'plus', 'pro'].includes(plan)) return false
    saveGmgnCredentials(userId, { ...creds, plan: plan as GmgnPlan })
    return true
  })
  ipcMain.handle('gmgn:clear', (_e, userId: string) => clearGmgnCredentials(userId))

  ipcMain.handle('gmgn:userInfo', (_e, userId: string) => clientFor(userId)?.userInfo() ?? NO_KEY)
  ipcMain.handle('gmgn:tokenInfo', (_e, userId: string, mint: string) => {
    if (!isLikelyMint(mint)) return BAD_MINT
    return clientFor(userId)?.tokenInfo(mint) ?? NO_KEY
  })
  ipcMain.handle('gmgn:tokenSecurity', (_e, userId: string, mint: string) => {
    if (!isLikelyMint(mint)) return BAD_MINT
    return clientFor(userId)?.tokenSecurity(mint) ?? NO_KEY
  })

  ipcMain.handle('trade:wallets', (_e, userId: string) => trade.wallets(userId))
  ipcMain.handle('trade:selectedWallet', (_e, userId: string) => loadGmgnCredentials(userId)?.wallet ?? null)
  ipcMain.handle('trade:setWallet', (_e, userId: string, address: string) => {
    const creds = loadGmgnCredentials(userId)
    if (!creds || !isLikelyMint(address)) return false
    saveGmgnCredentials(userId, { ...creds, wallet: address })
    return true
  })
  ipcMain.handle('trade:buy', (_e, userId: string, r: BuyRequest) => trade.buy(userId, r))
  ipcMain.handle('trade:sell', (_e, userId: string, r: SellRequest) => trade.sell(userId, r))
  ipcMain.handle('trade:queryOrder', (_e, userId: string, orderId: string) => trade.queryOrder(userId, String(orderId)))
  ipcMain.handle('trade:holdings', (_e, userId: string) => trade.holdings(userId))
  ipcMain.handle('trade:tokenPrice', (_e, userId: string, mint: string) => {
    if (!isLikelyMint(mint)) return BAD_MINT
    return clientFor(userId)?.tokenPrice(mint) ?? NO_KEY
  })

  const telegram = new TelegramService({
    status: (s) => win?.webContents.send('telegram:status', s),
    message: (m) => win?.webContents.send('telegram:message', m)
  })
  app.on('before-quit', () => {
    telegram.detach()
  })
  ipcMain.handle('telegram:attach', (_e, userId: string) => telegram.attach(userId))
  ipcMain.handle('telegram:detach', () => telegram.detach())
  ipcMain.handle('telegram:startLogin', (_e, apiId: number, apiHash: string, phone: string) =>
    telegram.startLogin(Number(apiId), String(apiHash).trim(), String(phone))
  )
  ipcMain.handle('telegram:submitCode', (_e, code: string) => telegram.submitCode(String(code)))
  ipcMain.handle('telegram:submitPassword', (_e, pw: string) => telegram.submitPassword(String(pw)))
  ipcMain.handle('telegram:logout', () => telegram.logout())
  ipcMain.handle('telegram:listChats', async () => {
    try {
      return { ok: true, chats: await telegram.listChats() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('telegram:setWatched', (_e, ids: string[]) => telegram.setWatched(Array.isArray(ids) ? ids.map(String) : []))

  ipcMain.handle('updater:check', () => updater.check())
  ipcMain.handle('updater:install', () => updater.install())
}

// Aynı bilgisayarda uygulama iki kez açılmasın (çift işlem riskini önler)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.fakelord.memebot')
    registerIpc(setupUpdater(() => win))
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
