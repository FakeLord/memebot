import { app, safeStorage, utilityProcess, type UtilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineHostStatus } from '../shared/types'

// Motoru bu bilgisayarda arka planda çalıştırır (proje VPS'e taşınana kadar).
// Ayarlar (service_role anahtarı + kasanın ana anahtarı) Windows şifrelemesiyle (safeStorage) saklanır.
// Motor ayrı bir süreçte (utilityProcess) çalışır; çökerse artan beklemeyle yeniden başlatılır.

interface HostConfig {
  enabled: boolean
  serviceRoleKey?: string
  masterKey: string
}

const MAX_LOG = 300

export class EngineHost {
  private proc: UtilityProcess | null = null
  private logs: string[] = []
  private restartDelay = 2_000
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private quitting = false
  private stopping = new WeakSet<UtilityProcess>() // bilerek durdurulanlar yeniden başlatılmaz
  private readonly dir = join(app.getPath('userData'), 'engine')
  private readonly file = join(this.dir, 'host.bin')

  constructor(private readonly supabaseUrl: string | undefined) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private load(): HostConfig {
    // Sadece geliştirmede (paketlenmemiş): yerel Supabase ile denemek için ayar ortam değişkeninden gelebilir
    const devKey = !app.isPackaged ? process.env.MEMEBOT_DEV_SERVICE_KEY : undefined
    if (devKey) return { enabled: true, serviceRoleKey: devKey, masterKey: process.env.MEMEBOT_DEV_MASTER_KEY ?? 'A'.repeat(43) + '=' }
    if (existsSync(this.file)) {
      try {
        return JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as HostConfig
      } catch {
        this.push('ayar dosyası okunamadı; yeniden oluşturuluyor')
      }
    }
    const cfg: HostConfig = { enabled: false, masterKey: randomBytes(32).toString('base64') }
    this.save(cfg)
    return cfg
  }

  private save(cfg: HostConfig) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu bilgisayarda şifreleme kullanılamıyor')
    writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(cfg)))
  }

  private push(line: string) {
    if (!app.isPackaged) process.stdout.write(`[motor] ${line}
`)
    this.logs.push(line)
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG)
  }

  status(): EngineHostStatus {
    const cfg = this.load()
    return { enabled: cfg.enabled, hasServiceKey: !!cfg.serviceRoleKey, running: !!this.proc, logs: this.logs.slice(-80) }
  }

  configure(patch: { enabled?: boolean; serviceRoleKey?: string }): EngineHostStatus {
    const cfg = this.load()
    if (patch.serviceRoleKey !== undefined) {
      const k = patch.serviceRoleKey.trim()
      // service_role anahtarı bir JWT ya da yeni biçimde "sb_secret_" ile başlar
      if (k && !/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]+)$/.test(k)) throw new Error('Bu bir service_role anahtarına benzemiyor')
      cfg.serviceRoleKey = k || undefined
    }
    if (patch.enabled !== undefined) cfg.enabled = patch.enabled
    this.save(cfg)
    this.stop()
    if (cfg.enabled) this.start()
    return this.status()
  }

  start(): void {
    if (this.proc || this.quitting) return
    const cfg = this.load()
    if (!cfg.enabled) return
    if (!cfg.serviceRoleKey || !this.supabaseUrl) {
      this.push('motor başlatılmadı: service_role anahtarı ya da Supabase adresi eksik')
      return
    }
    const proc = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
      serviceName: 'MemeBot Engine',
      stdio: 'pipe',
      env: {
        ...process.env,
        SUPABASE_URL: this.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: cfg.serviceRoleKey,
        ENGINE_MASTER_KEY: cfg.masterKey,
        ENGINE_DATA_DIR: this.dir
      }
    })
    this.proc = proc
    const onData = (b: Buffer) => b.toString('utf-8').split('\n').filter(Boolean).forEach((l) => this.push(l))
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('spawn', () => {
      this.restartDelay = 2_000
      this.importLegacy(proc)
    })
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null
      this.push(`motor süreci kapandı (kod ${code})`)
      if (this.quitting || this.stopping.has(proc) || !this.load().enabled) return
      // Çökme: artan beklemeyle yeniden başlat (en çok 1 dk)
      this.restartTimer = setTimeout(() => this.start(), this.restartDelay)
      this.restartDelay = Math.min(60_000, this.restartDelay * 2)
    })
  }

  // 0.1.x sürümleri sırları userData/secrets/<kullanıcı>.<tür> dosyalarında tutuyordu. Motor ilk açılışta
  // bunları kendi kasasına alır; kullanıcı anahtarlarını yeniden girmek zorunda kalmaz.
  private importLegacy(proc: UtilityProcess) {
    const dir = join(app.getPath('userData'), 'secrets')
    if (!existsSync(dir)) return
    const users: Record<string, Record<string, unknown>> = {}
    for (const f of readdirSync(dir)) {
      const m = /^([0-9a-f-]{36})\.(gmgn|telegram|xflux)$/i.exec(f)
      if (!m) continue
      try {
        users[m[1]] = { ...users[m[1]], [m[2]]: JSON.parse(safeStorage.decryptString(readFileSync(join(dir, f)))) }
      } catch {
        this.push(`eski sır okunamadı: ${m[2]}`)
      }
    }
    if (!Object.keys(users).length) return
    proc.postMessage({ type: 'import-secrets', users })
    renameSync(dir, `${dir}.imported-${Date.now()}`)
    this.push(`eski sürümden ${Object.keys(users).length} kullanıcının anahtarları motora aktarıldı`)
  }

  stop(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const p = this.proc
    this.proc = null
    if (!p) return
    this.stopping.add(p)
    p.postMessage('stop')
    // Kibarca kapanmazsa 5 sn sonra zorla
    setTimeout(() => p.kill(), 5_000)
  }

  /** Uygulama kapanırken: motora kapanma mesajı gönderir, kısa süre bekler. */
  async shutdown(): Promise<void> {
    this.quitting = true
    const p = this.proc
    if (!p) return
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        p.kill()
        resolve()
      }, 4_000)
      p.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
      p.postMessage('stop')
    })
    this.proc = null
  }
}
