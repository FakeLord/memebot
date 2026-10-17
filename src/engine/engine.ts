import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { EngineContext, type EngineOptions } from './context'
import { OrderEngine, type OrderRow } from './orders'
import { Pipeline } from './pipeline'
import { Tracker } from './tracker'
import { DashboardFeed } from './dashboard'
import { SourceHub } from './sources'
import type { TweetStreamApi } from './tweetstream/client'
import { Commands } from './commands'
import { FeedWriter } from './feed'
import { DeployEngine } from './deploy'
import { lastLatencyMs } from './gmgn/client'
import type { RuleRow } from '../shared/rules'
import type { XPollResult } from '../shared/types'

// MemeBot Engine: tek etkin motor (engine_claim). Gerçek zamanlı bildirimler hızlı yol; her şey ayrıca
// kısa aralıklarla yoklanır, böylece kaçan bir bildirim işi sadece birkaç saniye geciktirir.

const HEARTBEAT_MS = 10_000
const CLAIM_TTL_SEC = 30

export interface EngineStartOptions extends EngineOptions {
  instanceId?: string
  xPoll?: (apiKey: string, hitLimit?: number) => Promise<XPollResult>
  tsApi?: TweetStreamApi
}

export class Engine {
  readonly ctx: EngineContext
  readonly orders: OrderEngine
  readonly pipeline: Pipeline
  readonly tracker: Tracker
  readonly sources: SourceHub
  readonly dashboard: DashboardFeed
  readonly commands: Commands
  readonly feed: FeedWriter
  readonly deploy: DeployEngine
  readonly instanceId: string
  private active = false
  private stopped = false
  private timers: ReturnType<typeof setInterval>[] = []
  private channel: RealtimeChannel | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastBeat = Date.now()

  constructor(o: EngineStartOptions) {
    this.ctx = new EngineContext(o)
    this.instanceId = o.instanceId ?? randomUUID()
    this.orders = new OrderEngine(this.ctx)
    this.pipeline = new Pipeline(this.ctx, this.orders)
    this.tracker = new Tracker(this.ctx)
    this.feed = new FeedWriter(this.ctx, (id) => this.ctx.users.keywords(id))
    this.sources = new SourceHub(this.ctx, this.feed, o.xPoll, o.tsApi)
    this.dashboard = new DashboardFeed(this.ctx)
    this.deploy = new DeployEngine(this.ctx)
    this.commands = new Commands(this.ctx, { orders: this.orders, pipeline: this.pipeline, sources: this.sources, deploy: this.deploy, dashboard: this.dashboard, xPoll: o.xPoll })
  }

  get isActive(): boolean {
    return this.active
  }

  /** Motoru başlatır. Başka bir motor etkinse onun susmasını bekler (çift işlem olmaz). */
  async start(): Promise<void> {
    const { log } = this.ctx
    log.info('motor başlıyor', { version: this.ctx.version, instance: this.instanceId })
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS)
    await this.beat()
  }

  private async beat(): Promise<void> {
    if (this.stopped) return
    const { db, log } = this.ctx
    // Zamanlayıcı uzun süre çalışmadıysa süreç dondurulmuş demektir (uyku, enerji tasarrufu)
    const gap = Date.now() - this.lastBeat
    this.lastBeat = Date.now()
    if (gap > HEARTBEAT_MS * 3) log.warn('motor bir süre çalışmadı (bilgisayar uyku ya da enerji tasarrufunda olabilir)', { saniye: Math.round(gap / 1000) })
    const { data, error } = await db.rpc('engine_claim', { p_instance: this.instanceId, p_ttl_sec: CLAIM_TTL_SEC })
    if (error) return log.warn('motor kilidi alınamadı', { error: error.message })
    const won = data === true
    if (won && !this.active) await this.activate()
    else if (!won && this.active) {
      // Başka bir motor devraldı (bu süreç donmuş olabilir): hemen bırak
      log.warn('başka bir motor devraldı, bu motor bekleme moduna geçiyor')
      await this.deactivate()
    } else if (!won && !this.active) log.info('başka bir motor etkin; bekleniyor')
    if (this.active) {
      await db.from('engine_status').update({ gmgn_latency_ms: lastLatencyMs }).eq('id', 'main').eq('instance_id', this.instanceId)
    }
  }

  private async activate(): Promise<void> {
    const { db, log, users, vault } = this.ctx
    this.active = true
    await db
      .from('engine_status')
      .update({ version: this.ctx.version, host: hostname(), started_at: new Date().toISOString(), public_key: vault.publicJwk })
      .eq('id', 'main')
      .eq('instance_id', this.instanceId)
    await users.load()
    await this.ctx.state.load()

    // Kasadaki her kullanıcı için GMGN durumu arayüze
    for (const id of users.activeIds()) {
      const g = vault.get(id).gmgn
      this.ctx.state.patch(id, { gmgn: { configured: !!g, plan: g?.plan ?? 'free', wallet: g?.wallet ?? null } })
    }
    await this.orders.recover()
    await this.deploy.recover()
    await this.sources.start()
    this.subscribe()

    const every = (ms: number, fn: () => Promise<void>) => {
      let running = false
      this.timers.push(
        setInterval(async () => {
          if (running || !this.active) return
          running = true
          try {
            await fn()
          } catch (e) {
            log.warn('periyodik iş hatası', { error: (e as Error).message })
          } finally {
            running = false
          }
        }, ms)
      )
    }
    every(this.ctx.pollMs, () => this.commands.processPending())
    every(this.ctx.pollMs, () => this.orders.processCreated())
    every(this.ctx.pollMs, () => this.pipeline.processPending())
    every(this.ctx.trackerMs, () => this.tracker.tick())
    every(30_000, () => this.pipeline.expireCandidates())
    every(15_000, () => this.dashboard.tick())
    every(3600_000, async () => void (await this.feed.cleanup()))
    every(30_000, async () => {
      await users.load()
      await this.sources.reloadSources()
    })
    log.info('motor etkin')
  }

  private subscribe(): void {
    const { db } = this.ctx
    this.channel = db
      .channel('engine')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'engine_commands' }, () => void this.commands.processPending())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (p) => {
        const o = p.new as OrderRow
        if (o.status === 'created') void this.orders.execute(o)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, () => void this.pipeline.processPending())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rules' }, (p) => {
        const r = (p.new ?? {}) as RuleRow & { user_id?: string }
        if (r.user_id) this.ctx.users.setRuleRow(r.user_id, r)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sources' }, () => void this.sources.reloadSources())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'keywords' }, () => void this.ctx.users.loadKeywords())
      .subscribe()
  }

  private async deactivate(): Promise<void> {
    this.active = false
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.channel) await this.ctx.db.removeChannel(this.channel)
    this.channel = null
    await this.sources.stop()
    await this.ctx.state.flush()
  }

  /** Eski masaüstü sürümünün sırlarını kasaya alır (kasada zaten olanın üstüne yazmaz). */
  importSecrets(users: Record<string, Record<string, unknown>>): number {
    const { vault, state } = this.ctx
    let n = 0
    for (const [userId, kinds] of Object.entries(users)) {
      const cur = vault.get(userId)
      for (const kind of ['gmgn', 'telegram', 'xflux'] as const) {
        if (!kinds[kind] || cur[kind]) continue
        vault.set(userId, kind, kinds[kind] as never)
        n++
      }
      if (this.active) {
        const g = vault.get(userId).gmgn
        state.patch(userId, { gmgn: { configured: !!g, plan: g?.plan ?? 'free', wallet: g?.wallet ?? null } })
        if (kinds.telegram) void this.sources.tg(userId).attach()
        if (kinds.xflux) this.sources.syncX(userId)
      }
    }
    return n
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.active) {
      await this.deactivate()
      // Bir sonraki motor beklemeden devralabilsin
      await this.ctx.db.from('engine_status').update({ heartbeat_at: new Date(0).toISOString() }).eq('id', 'main').eq('instance_id', this.instanceId)
    }
    this.ctx.log.info('motor durdu')
  }
}
