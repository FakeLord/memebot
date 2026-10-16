import { createClient } from '@supabase/supabase-js'
import { Engine } from './engine'
import { createLogger } from './log'
import { Vault } from './vault'

// MemeBot Engine giriş noktası. Ayarlar ortam değişkenlerinden gelir:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — motorun veritabanı erişimi (service_role, repoya girmez)
//   ENGINE_MASTER_KEY                       — kasanın ana anahtarı (32 bayt, base64)
//   ENGINE_DATA_DIR                         — kasa dosyasının klasörü
//   ENGINE_TZ                               — günlük limitlerin saat dilimi (varsayılan Europe/Istanbul)
// Bilgisayarda masaüstü uygulaması bu süreci kendisi başlatır; VPS'te: node --env-file=.env.engine out/main/engine.js

declare const __APP_VERSION__: string

function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) {
    process.stderr.write(`Eksik ayar: ${name}\n`)
    process.exit(2)
  }
  return v
}

async function main() {
  const log = createLogger()
  const vault = await Vault.open(required('ENGINE_DATA_DIR'), required('ENGINE_MASTER_KEY'))
  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const engine = new Engine({
    db,
    vault,
    log,
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    timeZone: process.env.ENGINE_TZ || undefined
  })

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info('kapatılıyor', { signal })
    await engine.stop().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // Masaüstü uygulaması kapanırken "stop" mesajı gönderir (utilityProcess)
  const parentPort = (process as unknown as { parentPort?: { on(ev: 'message', cb: (e: { data?: unknown }) => void): void } }).parentPort
  parentPort?.on('message', (e) => {
    if (e.data === 'stop') return void shutdown('parent')
    const msg = e.data as { type?: string; users?: Record<string, Record<string, unknown>> }
    if (msg?.type === 'import-secrets' && msg.users) {
      const n = engine.importSecrets(msg.users)
      log.info('eski sürümün anahtarları kasaya alındı', { kayit: n })
    }
  })
  process.on('unhandledRejection', (e) => log.error('yakalanmamış hata', { error: String(e) }))

  await engine.start()
}

void main().catch((e) => {
  process.stderr.write(`Motor başlatılamadı: ${(e as Error).message}\n`)
  process.exit(1)
})
