import type { EngineContext } from './context'
import type { FeedWriter } from './feed'
import { TelegramService } from './telegram/service'
import { pollMonitors } from './xflux/client'
import { normalizeHandle, tweetStream, tweetToHit, type TsEnvelope, type TsRegion, type TsSocket, type TweetStreamApi } from './tweetstream/client'
import { extractMints } from '../shared/extract'
import type { TelegramMessage, XHit, XMonitor, XPollResult } from '../shared/types'

// Sinyal kaynakları: her kullanıcının Telegram oturumu, XFlux izleyicileri ve TweetStream akışı motorda çalışır.
// Her gönderi akışa kart olarak yazılır; içindeki mint adresleri engine_record_signal ile sinyal olur.

interface SourceRow {
  id: string
  user_id: string
  type: 'telegram' | 'x' | 'manual'
  chat_id: string
  title: string
  is_active: boolean
}

export class SourceHub {
  private telegram = new Map<string, TelegramService>()
  private sources = new Map<string, SourceRow[]>() // kullanıcı → aktif kaynaklar
  private x = new Map<string, XPoller>()
  private ts = new Map<string, TsStreamer>()
  private tsInactive = new Set<string>() // "kullanıcı:ts:hesap" → Hesaplar'da izlemeden çıkarılmış

  constructor(
    private readonly ctx: EngineContext,
    private readonly feed: FeedWriter,
    private readonly xPoll: (apiKey: string, hitLimit?: number) => Promise<XPollResult> = pollMonitors,
    readonly tsApi: TweetStreamApi = tweetStream
  ) {}

  async start(): Promise<void> {
    await this.reloadSources()
    for (const userId of this.ctx.vault.userIds()) {
      if (!this.ctx.users.active(userId)) continue
      if (this.ctx.vault.get(userId).telegram) void this.tg(userId).attach()
      else this.ctx.state.patch(userId, { telegram: { state: 'needs_setup' } })
      this.syncX(userId)
      this.syncTs(userId)
    }
  }

  async stop(): Promise<void> {
    for (const p of this.x.values()) p.stop()
    for (const t of this.ts.values()) t.stop()
    await Promise.all([...this.telegram.values()].map((s) => s.detach()))
  }

  async reloadSources(): Promise<void> {
    const { data, error } = await this.ctx.db.from('sources').select('id, user_id, type, chat_id, title, is_active').eq('is_active', true)
    if (error) return this.ctx.log.warn('kaynaklar alınamadı', { error: error.message })
    const by = new Map<string, SourceRow[]>()
    for (const s of (data as SourceRow[]) ?? []) by.set(s.user_id, [...(by.get(s.user_id) ?? []), s])
    this.sources = by
    this.tsInactive.clear()
    for (const [userId, svc] of this.telegram) svc.setWatched(this.active(userId, 'telegram').map((s) => s.chat_id))
  }

  private active(userId: string, type: SourceRow['type']): SourceRow[] {
    return (this.sources.get(userId) ?? []).filter((s) => s.type === type)
  }

  // ------------------------------------------------------------------ Telegram
  tg(userId: string): TelegramService {
    let svc = this.telegram.get(userId)
    if (!svc) {
      const vault = this.ctx.vault
      svc = new TelegramService(
        {
          load: () => vault.get(userId).telegram,
          save: (s) => vault.set(userId, 'telegram', s),
          clear: () => vault.set(userId, 'telegram', undefined)
        },
        {
          status: (s) => this.ctx.state.patch(userId, { telegram: s }),
          message: (m) => void this.onTelegram(userId, m)
        }
      )
      svc.setWatched(this.active(userId, 'telegram').map((s) => s.chat_id))
      this.telegram.set(userId, svc)
    }
    return svc
  }

  private async onTelegram(userId: string, m: TelegramMessage): Promise<void> {
    const source = this.active(userId, 'telegram').find((s) => s.chat_id === m.chatId)
    if (!source) return
    const externalId = `${m.chatId}:${m.msgId}`
    if (m.mediaOnly) {
      if (m.photo) await this.feed.attachPhoto(userId, 'telegram', externalId, m.photo)
      return
    }
    // Önce sinyal (hız), sonra kart
    const sender = m.senderId ? { id: m.senderId, name: m.senderName, handle: m.senderHandle } : undefined
    if (m.text) await this.record(userId, source.id, String(m.msgId), m.text, new Date(m.date * 1000), 5, sender)
    await this.feed.ingest(userId, source.id, {
      platform: 'telegram',
      externalId,
      // Gruplarda kartın yazarı mesajı yazan kişidir (kanal adı yanında); kanallarda kanalın kendisi
      author: sender ? { name: `${sender.name ?? sender.handle ?? 'Üye'} · ${source.title}`, handle: sender.handle ?? m.channelUsername } : { name: source.title, handle: m.channelUsername },
      body: m.body,
      scanText: m.text,
      kind: m.replyText ? 'reply' : 'post',
      ref: m.replyText ? { text: m.replyText } : undefined,
      url: m.channelUsername ? `https://t.me/${m.channelUsername}/${m.msgId}` : undefined,
      postedAt: new Date(m.date * 1000),
      edited: m.edited
    })
  }

  /** X gönderisi: sinyal + kart. */
  async onX(userId: string, sourceId: string, h: XHit, monitorUsername: string): Promise<void> {
    await this.record(userId, sourceId, h.tweetId, h.text, new Date(h.createdAt ?? Date.now()))
    const handle = h.author?.handle ?? monitorUsername
    await this.feed.ingest(userId, sourceId, {
      platform: 'x',
      externalId: h.tweetId,
      author: { handle, ...h.author },
      body: h.body ?? h.text,
      scanText: h.text,
      media: h.media,
      kind: h.kind,
      ref: h.ref,
      url: `https://x.com/${handle}/status/${h.tweetId}`,
      postedAt: h.createdAt ? new Date(h.createdAt) : undefined
    })
  }

  async record(userId: string, sourceId: string, msgId: string, text: string, at: Date, limit = 5, sender?: { id: string; name?: string; handle?: string }): Promise<number> {
    let n = 0
    for (const mint of extractMints(text).slice(0, limit)) {
      const { error } = await this.ctx.db.rpc('engine_record_signal', {
        p_user_id: userId,
        p_source_id: sourceId,
        p_msg_id: msgId, // 19 haneli tweet kimliği: sayıya çevirmeden metin olarak
        p_mint: mint,
        p_raw_text: text,
        p_msg_ts: at.toISOString(),
        p_sender_id: sender?.id ?? null,
        p_sender_name: sender?.name ?? null,
        p_sender_handle: sender?.handle ?? null
      })
      if (error) this.ctx.log.warn('sinyal yazılamadı', { error: error.message })
      else n++
    }
    return n
  }

  // ------------------------------------------------------------------ X (XFlux)
  /** Anahtar eklendi/silindi: yoklayıcıyı başlat ya da durdur. */
  syncX(userId: string): void {
    const key = this.ctx.vault.get(userId).xflux?.apiKey
    const cur = this.x.get(userId)
    if (!key) {
      cur?.stop()
      this.x.delete(userId)
      this.ctx.state.patch(userId, { x: { configured: false, state: 'no_key', error: null, monitors: [] } })
      return
    }
    if (cur) return
    const p = new XPoller(this.ctx, userId, this, this.xPoll)
    this.x.set(userId, p)
    p.start()
  }

  xSources(userId: string): SourceRow[] {
    return this.active(userId, 'x')
  }

  // ------------------------------------------------------------------ X (TweetStream)
  /** Anahtar eklendi/silindi/bölge değişti: akışı başlat, yeniden başlat ya da durdur. */
  syncTs(userId: string, restart = false): void {
    const key = this.ctx.vault.get(userId).tweetstream?.apiKey
    const cur = this.ts.get(userId)
    if (cur && (restart || !key)) {
      cur.stop()
      this.ts.delete(userId)
    }
    if (!key) {
      this.ctx.state.patch(userId, { x: { ts: { configured: false, state: 'no_key', error: null } } })
      return
    }
    if (this.ts.has(userId)) return
    const t = new TsStreamer(this.ctx, userId, this, this.tsApi)
    this.ts.set(userId, t)
    t.start()
  }

  /** Plan/hesap bilgisini hemen tazele (hesap eklenip çıkarılınca). */
  async refreshTs(userId: string): Promise<void> {
    await this.ts.get(userId)?.refreshMe(false)
  }

  /** TweetStream'de izlenen her hesap için kaynak satırı (Hesaplar'da görünsün, izle/sessiz ayarlansın). */
  async syncTsSources(userId: string, handles: string[]): Promise<void> {
    if (!handles.length) return
    const rows = handles.map((h) => ({ user_id: userId, type: 'x', chat_id: `ts:${h}`, title: `@${h}`, is_active: true }))
    const { error } = await this.ctx.db.from('sources').upsert(rows, { onConflict: 'user_id,type,chat_id', ignoreDuplicates: true })
    if (error) this.ctx.log.warn('TweetStream kaynakları yazılamadı', { error: error.message })
    else await this.reloadSources()
  }

  /** Gönderinin geldiği hesabın kaynak satırı; yoksa oluşturulur. İzlemeden çıkarılmışsa null. */
  async tsSource(userId: string, handle: string): Promise<SourceRow | null> {
    const chat = `ts:${handle}`
    const hit = this.active(userId, 'x').find((s) => s.chat_id === chat)
    if (hit) return hit
    const k = `${userId}:${chat}`
    if (this.tsInactive.has(k)) return null
    const { data } = await this.ctx.db
      .from('sources')
      .upsert({ user_id: userId, type: 'x', chat_id: chat, title: `@${handle}`, is_active: true }, { onConflict: 'user_id,type,chat_id', ignoreDuplicates: true })
      .select('id, user_id, type, chat_id, title, is_active')
      .maybeSingle()
    let row = data as SourceRow | null
    if (!row) {
      const r = await this.ctx.db.from('sources').select('id, user_id, type, chat_id, title, is_active').eq('user_id', userId).eq('type', 'x').eq('chat_id', chat).maybeSingle()
      row = (r.data as SourceRow | null) ?? null
    }
    if (!row || !row.is_active) {
      this.tsInactive.add(k)
      return null
    }
    this.sources.set(userId, [...(this.sources.get(userId) ?? []), row])
    return row
  }
}

// XFlux yoklama döngüsü (kullanıcı başına). Aralık kalan aylık kotaya göre ayarlanır; motor açılırken
// eski gönderiler sinyal sayılmaz (ilk yoklama başlangıç noktasıdır).
const MIN_INTERVAL_MS = 3_000
const DEFAULT_INTERVAL_MS = 15_000
const STALE_MS = 10 * 60_000
const FRESH_ON_START_MS = 2 * 60_000
const LIST_REFRESH_MS = 5 * 60_000

export function intervalFor(quotaRemaining?: number, now = new Date()): number {
  if (quotaRemaining === undefined || !Number.isFinite(quotaRemaining)) return DEFAULT_INTERVAL_MS
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  const minutesLeft = Math.max(1, (monthEnd - now.getTime()) / 60_000)
  const perMinute = (quotaRemaining * 0.9) / minutesLeft // %10 pay bırak
  if (perMinute <= 0) return 10 * 60_000
  return Math.min(10 * 60_000, Math.max(MIN_INTERVAL_MS, 60_000 / perMinute))
}

class XPoller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private seen = new Set<string>()
  private firstPoll = true
  private quota: number | undefined
  private knowsMonitors = false
  private lastPoll = 0

  constructor(
    private readonly ctx: EngineContext,
    private readonly userId: string,
    private readonly hub: SourceHub,
    private readonly poll: (apiKey: string, hitLimit?: number) => Promise<XPollResult>
  ) {}

  start() {
    this.ctx.state.patch(this.userId, { x: { configured: true, state: 'starting', error: null } })
    void this.tick()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }

  private async tick(): Promise<void> {
    let next = intervalFor(this.quota)
    const patch = (x: Record<string, unknown>) => this.ctx.state.patch(this.userId, { x })
    try {
      const key = this.ctx.vault.get(this.userId).xflux?.apiKey
      if (!key) return this.stop()
      // İzlenen izleyici yoksa kotayı harcama: izleyici listesini 5 dk'da bir yenilemek yeterli
      if (!this.hub.xSources(this.userId).length && this.knowsMonitors && Date.now() - this.lastPoll < LIST_REFRESH_MS) {
        patch({ state: 'polling' })
        next = 30_000
        return
      }
      const r = await this.poll(key)
      this.lastPoll = Date.now()
      if (r.quotaRemaining !== undefined) this.quota = r.quotaRemaining
      if (!r.ok) {
        next = r.retryAfterSec ? r.retryAfterSec * 1000 : 60_000
        patch({ state: 'error', error: r.error, quotaRemaining: this.quota, lastPollAt: Date.now() })
        return
      }
      this.knowsMonitors = true
      next = intervalFor(this.quota)
      patch({
        state: 'polling',
        error: null,
        quotaRemaining: this.quota,
        lastPollAt: Date.now(),
        monitors: r.monitors.map((m) => ({ id: m.id, username: m.username, hits: m.hits.length }))
      })
      for (const m of r.monitors) await this.record(m)
      this.firstPoll = false
    } catch (e) {
      next = 60_000
      patch({ state: 'error', error: (e as Error).message })
    } finally {
      patch({ intervalMs: next })
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), next)
    }
  }

  private async record(m: XMonitor) {
    const source = this.hub.xSources(this.userId).find((s) => s.chat_id === m.id)
    for (const h of m.hits) {
      const key = `${m.id}:${h.tweetId}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      const age = h.createdAt ? Date.now() - h.createdAt : undefined
      // İlk yoklamada zamanı bilinmeyen ya da eski gönderiler başlangıç noktası sayılır
      if (this.firstPoll && (age === undefined || age > FRESH_ON_START_MS)) continue
      if (age !== undefined && age > STALE_MS) continue
      if (!source) continue
      await this.hub.onX(this.userId, source.id, h, m.username)
    }
  }
}

// ------------------------------------------------------------------ X (TweetStream)
// Kullanıcı başına tek WebSocket. Gönderi itildiği anda sinyal + kart olur (yoklama yok).
// Kopunca üstel bekleyişle yeniden bağlanır; 30 sn ayakta kalan bağlantı bekleyişi sıfırlar.
// Anahtar reddedilir ya da abonelik biterse 5 dk'da bir yeniden denenir.
const TS_BACKOFF_MAX = 30_000
const TS_ME_REFRESH = 5 * 60_000
const TS_AUTH_RETRY = 5 * 60_000
const TS_SEEN_MAX = 5_000

export interface TsStat {
  configured: boolean
  state: 'connecting' | 'live' | 'reconnecting' | 'error' | 'no_key'
  error: string | null
  region?: TsRegion
  plan?: string
  count?: number
  limit?: number
  handles?: string[]
  connectedAt?: number
  lastEventAt?: number
  lastLatencyMs?: number
  events?: number
}

class TsStreamer {
  private sock: TsSocket | null = null
  private stopped = false
  private backoff = 1_000
  private fails = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private refresh: ReturnType<typeof setInterval> | null = null
  private seen = new Set<string>()
  private stat: TsStat = { configured: true, state: 'connecting', error: null, events: 0 }

  constructor(
    private readonly ctx: EngineContext,
    private readonly userId: string,
    private readonly hub: SourceHub,
    private readonly api: TweetStreamApi
  ) {}

  private get secret() {
    return this.ctx.vault.get(this.userId).tweetstream
  }

  private patch(p: Partial<TsStat>) {
    this.stat = { ...this.stat, ...p }
    this.ctx.state.patch(this.userId, { x: { ts: this.stat } })
  }

  start() {
    this.patch({ state: 'connecting', error: null, region: this.secret?.region ?? 'global' })
    void this.refreshMe(true)
    this.refresh = setInterval(() => void this.refreshMe(false), TS_ME_REFRESH)
  }

  stop() {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    if (this.refresh) clearInterval(this.refresh)
    this.sock?.close()
    this.sock = null
  }

  /** Plan ve izlenen hesaplar; izlenen her hesap kaynak olarak kaydedilir. connect: ardından akışı aç. */
  async refreshMe(connect: boolean): Promise<void> {
    const key = this.secret?.apiKey
    if (!key || this.stopped) return
    const r = await this.api.me(key)
    if (this.stopped) return
    if (!r.ok) {
      const auth = r.status === 401 || r.status === 403
      this.patch({ state: 'error', error: auth ? tsAuthError(r.status, r.error) : `TweetStream: ${r.error}` })
      if (connect) this.schedule(auth ? TS_AUTH_RETRY : this.nextBackoff(), true)
      return
    }
    this.patch({ plan: r.data.plan, count: r.data.tracked.count, limit: r.data.tracked.limit, handles: r.data.tracked.handles })
    await this.hub.syncTsSources(this.userId, r.data.tracked.handles)
    if (connect && !this.sock) this.open()
  }

  private nextBackoff() {
    const b = this.backoff
    this.backoff = Math.min(TS_BACKOFF_MAX, this.backoff * 2)
    return b
  }

  private schedule(ms: number, withMe: boolean) {
    if (this.stopped) return
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => (withMe ? void this.refreshMe(true) : this.open()), ms)
  }

  private open() {
    const key = this.secret?.apiKey
    if (!key || this.stopped || this.sock) return
    const opened = Date.now()
    this.sock = this.api.connect(key, this.secret?.region ?? 'global', {
      open: () => {
        this.fails = 0
        this.patch({ state: 'live', error: null, connectedAt: Date.now() })
      },
      event: (e) => void this.onEvent(e),
      close: (code, reason) => {
        this.sock = null
        if (this.stopped) return
        if (Date.now() - opened > 30_000) this.backoff = 1_000
        this.fails++
        this.patch({ state: 'reconnecting', error: reason || (code !== 1000 ? `Bağlantı koptu (${code})` : null) })
        // Üst üste kısa ömürlü bağlantılar: anahtar/abonelik sorunu olabilir, önce /api/me ile kontrol et
        this.schedule(this.nextBackoff(), this.fails >= 3)
      }
    })
  }

  private async onEvent(e: TsEnvelope) {
    if (e.t !== 'tweet' || e.op !== 'content') return
    const hit = tweetToHit(e.d)
    if (!hit || this.seen.has(hit.tweetId)) return
    this.seen.add(hit.tweetId)
    if (this.seen.size > TS_SEEN_MAX) this.seen.delete(this.seen.values().next().value as string)
    // Yeniden bağlanınca gelebilecek eski gönderiler sinyal sayılmaz
    if (hit.createdAt && Date.now() - hit.createdAt > STALE_MS) return
    const handle = hit.author?.handle ? normalizeHandle(hit.author.handle) : null
    if (!handle) return
    const source = await this.hub.tsSource(this.userId, handle)
    this.patch({
      lastEventAt: Date.now(),
      lastLatencyMs: hit.createdAt ? Math.max(0, Date.now() - hit.createdAt) : undefined,
      events: (this.stat.events ?? 0) + 1
    })
    if (!source) return // hesap Hesaplar'da izlemeden çıkarılmış
    await this.hub.onX(this.userId, source.id, hit, handle)
  }
}

function tsAuthError(status: number, error: string): string {
  if (status === 401) return 'TweetStream anahtarı geçersiz'
  return /subscription|plan|trial/i.test(error) ? 'TweetStream aboneliği etkin değil (deneme ya da ücretli plan gerekli)' : `TweetStream: ${error}`
}
