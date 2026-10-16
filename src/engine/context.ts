import type { SupabaseClient } from '@supabase/supabase-js'
import { GmgnClient, type GmgnApi, type GmgnCredentials } from './gmgn/client'
import type { Logger } from './log'
import type { GmgnSecret, Vault } from './vault'
import { ruleFromRow, type Rule, type RuleRow } from '../shared/rules'
import type { EngineUserState } from '../shared/engine'
import type { Role } from '../shared/types'

// Motorun modülleri arasında paylaşılan bağlam: veritabanı, kasa, kullanıcı dizini, durum yazıcı.

export interface EngineOptions {
  db: SupabaseClient
  vault: Vault
  log: Logger
  version: string
  timeZone?: string // günlük limitlerin sıfırlandığı saat dilimi
  gmgnFactory?: (creds: GmgnCredentials) => GmgnApi // testlerde sahte GMGN
  pollMs?: number // komut/emir/sinyal yoklama aralığı (gerçek zamanlı kaçırılırsa yedek)
  trackOrderMs?: number // GMGN emir durumu sorgulama aralığı
  trackerMs?: number // pozisyon fiyat takibi aralığı
}

interface ProfileLite {
  id: string
  username: string
  role: Role
  is_active: boolean
}

export class Users {
  private profiles = new Map<string, ProfileLite>()
  private rules = new Map<string, Rule>()

  constructor(private readonly db: SupabaseClient) {}

  async load(): Promise<void> {
    const [{ data: p, error: pe }, { data: r, error: re }] = await Promise.all([
      this.db.from('profiles').select('id, username, role, is_active'),
      this.db.from('rules').select('user_id, mode, thresholds, limits, tp_sl_template')
    ])
    if (pe) throw new Error(`profiles: ${pe.message}`)
    if (re) throw new Error(`rules: ${re.message}`)
    this.profiles = new Map(((p as ProfileLite[]) ?? []).map((x) => [x.id, x]))
    this.rules = new Map(((r as (RuleRow & { user_id: string })[]) ?? []).map((x) => [x.user_id, ruleFromRow(x)]))
  }

  setRuleRow(userId: string, row: RuleRow | null) {
    if (row) this.rules.set(userId, ruleFromRow(row))
    else this.rules.delete(userId)
  }

  active(userId: string): boolean {
    return this.profiles.get(userId)?.is_active === true
  }

  canTrade(userId: string): boolean {
    const p = this.profiles.get(userId)
    return !!p?.is_active && (p.role === 'founder' || p.role === 'developer')
  }

  activeIds(): string[] {
    return [...this.profiles.values()].filter((p) => p.is_active).map((p) => p.id)
  }

  /** Önbellekteki kural (karar motoru için). Para yolunda freshRule kullanılır. */
  rule(userId: string): Rule {
    return this.rules.get(userId) ?? ruleFromRow(null)
  }

  /** Emir anında veritabanından taze kural ve rol (önbellek bayat olabilir). */
  async fresh(userId: string): Promise<{ rule: Rule; canTrade: boolean; active: boolean }> {
    const [{ data: p }, { data: r }] = await Promise.all([
      this.db.from('profiles').select('id, username, role, is_active').eq('id', userId).maybeSingle(),
      this.db.from('rules').select('mode, thresholds, limits, tp_sl_template').eq('user_id', userId).maybeSingle()
    ])
    const prof = p as ProfileLite | null
    if (prof) this.profiles.set(userId, prof)
    const rule = ruleFromRow(r as RuleRow | null)
    this.rules.set(userId, rule)
    return {
      rule,
      active: !!prof?.is_active,
      canTrade: !!prof?.is_active && (prof.role === 'founder' || prof.role === 'developer')
    }
  }
}

type StatePatch = Partial<Pick<EngineUserState, 'gmgn' | 'telegram' | 'x' | 'pipeline' | 'notice'>>

// engine_user_state: kullanıcı başına motor durumu. Sık değişen alanlar (X yoklama) toplanıp yazılır.
export class StateWriter {
  private state = new Map<string, StatePatch>()
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly db: SupabaseClient,
    private readonly log: Logger
  ) {}

  /** Açılışta mevcut satırları yükler: motor yeniden başlayınca son durum silinmesin. */
  async load(): Promise<void> {
    const { data } = await this.db.from('engine_user_state').select('user_id, gmgn, telegram, x, pipeline, notice')
    for (const r of (data as EngineUserState[]) ?? []) {
      const { user_id, ...rest } = r
      this.state.set(user_id, { ...rest, ...this.state.get(user_id) })
    }
  }

  get(userId: string): StatePatch {
    return this.state.get(userId) ?? {}
  }

  patch(userId: string, p: StatePatch): void {
    const cur = this.state.get(userId) ?? {}
    const next: StatePatch = { ...cur }
    for (const k of Object.keys(p) as (keyof StatePatch)[]) {
      const v = p[k]
      // JSON alanları birleştirilir; notice ve telegram durumu bütün olarak değişir
      if (k === 'notice' || k === 'telegram') (next as Record<string, unknown>)[k] = v
      else (next as Record<string, unknown>)[k] = { ...((cur[k] as object) ?? {}), ...(v as object) }
    }
    this.state.set(userId, next)
    this.dirty.add(userId)
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 300)
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ids = [...this.dirty]
    this.dirty.clear()
    if (!ids.length) return
    // Çok satırlı upsert'te eksik sütunlar NULL gider: her satır tüm sütunları taşır
    const at = new Date().toISOString()
    const rows = ids.map((id) => {
      const s = this.state.get(id) ?? {}
      return { user_id: id, gmgn: s.gmgn ?? {}, telegram: s.telegram ?? {}, x: s.x ?? {}, pipeline: s.pipeline ?? {}, notice: s.notice ?? null, updated_at: at }
    })
    const { error } = await this.db.from('engine_user_state').upsert(rows, { onConflict: 'user_id' })
    if (error) {
      this.log.warn('engine_user_state yazılamadı', { error: error.message })
      ids.forEach((id) => this.dirty.add(id))
      if (!this.timer) this.timer = setTimeout(() => void this.flush(), 5_000)
    }
  }
}

export class EngineContext {
  readonly db: SupabaseClient
  readonly vault: Vault
  readonly log: Logger
  readonly users: Users
  readonly state: StateWriter
  readonly timeZone: string
  readonly pollMs: number
  readonly trackOrderMs: number
  readonly trackerMs: number
  readonly version: string
  private readonly factory: (creds: GmgnCredentials) => GmgnApi
  private clients = new Map<string, GmgnApi>()

  constructor(o: EngineOptions) {
    this.db = o.db
    this.vault = o.vault
    this.log = o.log
    this.version = o.version
    this.timeZone = o.timeZone ?? 'Europe/Istanbul'
    this.pollMs = o.pollMs ?? 2_000
    this.trackOrderMs = o.trackOrderMs ?? 3_000
    this.trackerMs = o.trackerMs ?? 15_000
    this.factory = o.gmgnFactory ?? ((c) => new GmgnClient(c))
    this.users = new Users(o.db)
    this.state = new StateWriter(o.db, o.log)
  }

  /** Kullanıcının GMGN istemcisi ve sırrı; anahtar yoksa null. */
  gmgn(userId: string): { client: GmgnApi; secret: GmgnSecret } | null {
    const secret = this.vault.get(userId).gmgn
    if (!secret) return null
    const id = `${secret.apiKey}:${secret.plan ?? 'free'}`
    let client = this.clients.get(id)
    if (!client) {
      client = this.factory({ apiKey: secret.apiKey, privateKeyPem: secret.privateKeyPem, plan: secret.plan })
      this.clients.set(id, client)
    }
    return { client, secret }
  }

  /** Okuma amaçlı (güvenlik, fiyat) GMGN: önce kullanıcının anahtarı, yoksa motordaki herhangi bir anahtar. */
  gmgnRead(userId: string): GmgnApi | null {
    const own = this.gmgn(userId)
    if (own) return own.client
    for (const id of this.vault.userIds()) {
      if (!this.users.active(id)) continue
      const g = this.gmgn(id)
      if (g) return g.client
    }
    return null
  }

  async audit(userId: string | null, action: string, detail: Record<string, unknown> = {}): Promise<void> {
    const { error } = await this.db.from('audit_log').insert({ user_id: userId, action, detail })
    if (error) this.log.warn('audit_log yazılamadı', { action, error: error.message })
  }

  /** Okunamazsa "açık" sayılır: emin olamıyorsak alım yapmayız. */
  async killSwitch(): Promise<boolean> {
    const { data, error } = await this.db.from('app_settings').select('value').eq('key', 'kill_switch').maybeSingle()
    if (error) return true
    return data?.value === true
  }
}
