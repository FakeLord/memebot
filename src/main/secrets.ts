import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GmgnCredentials } from './gmgn/client'

// GMGN anahtarları Supabase'e gönderilmez. Her kullanıcının anahtarı sadece kendi
// bilgisayarında, Windows DPAPI (Electron safeStorage) ile şifrelenmiş dosyada durur.

const USER_ID = /^[0-9a-f-]{36}$/i

function fileFor(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Geçersiz kullanıcı kimliği')
  const dir = join(app.getPath('userData'), 'secrets')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${userId}.gmgn`)
}

export function saveGmgnCredentials(userId: string, creds: GmgnCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu bilgisayarda şifreleme kullanılamıyor')
  writeFileSync(fileFor(userId), safeStorage.encryptString(JSON.stringify(creds)))
}

export function loadGmgnCredentials(userId: string): GmgnCredentials | null {
  const f = fileFor(userId)
  if (!existsSync(f)) return null
  return JSON.parse(safeStorage.decryptString(readFileSync(f))) as GmgnCredentials
}

export function clearGmgnCredentials(userId: string): void {
  const f = fileFor(userId)
  if (existsSync(f)) rmSync(f)
}
