import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GmgnCredentials } from './gmgn/client'

// GMGN anahtarları ve Telegram oturumu Supabase'e gönderilmez. Her kullanıcının sırları
// sadece kendi bilgisayarında, Windows DPAPI (Electron safeStorage) ile şifrelenmiş dosyada durur.

const USER_ID = /^[0-9a-f-]{36}$/i

export interface TelegramSecret {
  apiId: number
  apiHash: string
  session: string
}

type Kind = 'gmgn' | 'telegram'

function fileFor(userId: string, kind: Kind): string {
  if (!USER_ID.test(userId)) throw new Error('Geçersiz kullanıcı kimliği')
  const dir = join(app.getPath('userData'), 'secrets')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${userId}.${kind}`)
}

function save(userId: string, kind: Kind, value: unknown): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu bilgisayarda şifreleme kullanılamıyor')
  writeFileSync(fileFor(userId, kind), safeStorage.encryptString(JSON.stringify(value)))
}

function load<T>(userId: string, kind: Kind): T | null {
  const f = fileFor(userId, kind)
  if (!existsSync(f)) return null
  return JSON.parse(safeStorage.decryptString(readFileSync(f))) as T
}

function clear(userId: string, kind: Kind): void {
  const f = fileFor(userId, kind)
  if (existsSync(f)) rmSync(f)
}

export const saveGmgnCredentials = (userId: string, creds: GmgnCredentials) => save(userId, 'gmgn', creds)
export const loadGmgnCredentials = (userId: string) => load<GmgnCredentials>(userId, 'gmgn')
export const clearGmgnCredentials = (userId: string) => clear(userId, 'gmgn')

export const saveTelegramSecret = (userId: string, s: TelegramSecret) => save(userId, 'telegram', s)
export const loadTelegramSecret = (userId: string) => load<TelegramSecret>(userId, 'telegram')
export const clearTelegramSecret = (userId: string) => clear(userId, 'telegram')
