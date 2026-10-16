import type { EngineContext } from './context'
import type { FeedWriter } from './feed'
import { TelegramService } from './telegram/service'
import { pollMonitors } from './xflux/client'
import { extractMints } from '../shared/extract'
import type { TelegramMessage, XHit, XMonitor, XPollResult } from '../shared/types'

// Sinyal kaynakları: her kullanıcının Telegram oturumu ve XFlux izleyicileri motorda çalışır.
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

  constructor(
    private readonly ctx: EngineContext,
    private readonly feed: FeedWriter,
    private readonly xPoll: (apiKey: string, hitLimit?: number) => Promise<XPollResult> = pollMonitors
  ) {}

  async start(): Promise<void> {
    await this.reloadSources()
    for (const userId of this.ctx.vault.userIds()) {
      if (!this.ctx.users.active(userId)) continue
      if (this.ctx.vault.get(userId).telegram) void this.tg(userId).attach()
      else this.ctx.state.patch(userId, { telegram: { state: 'needs_setup' } })
      this.syncX(userId)
    }
  }

  async stop(): Promise<void> {
    for (const p of this.x.values()) p.stop()
    await Promise.all([...this.telegram.values()].map((s) => s.detach()))
  }

  async reloadSources(): Promise<void> {
    const { data, error } = await this.ctx.db.from('sources').select('id, user_id, type, chat_id, title, is_active').eq('is_active', true)
    if (error) return this.ctx.log.warn('kaynaklar alınamadı', { error: error.message })
    const by = new Map<string, SourceRow[]>()
    for (const s of (data as SourceRow[]) ?? []) by.set(s.user_id, [...(by.get(s.user_id) ?? []), s])
    this.sources = by
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
    if (m.text) await this.record(userId, source.id, String(m.msgId), m.text, new Date(m.date * 1000))
    await this.feed.ingest(userId, source.id, {
      platform: 'telegram',
      externalId,
      author: { name: source.title, handle: m.channelUsername },
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

  async record(userId: string, sourceId: string, msgId: string, text: string, at: Date, limit = 5): Promise<number> {
    let n = 0
    for (const mint of extractMints(text).slice(0, limit)) {
      const { error } = await this.ctx.db.rpc('engine_record_signal', {
        p_user_id: userId,
        p_source_id: sourceId,
        p_msg_id: msgId, // 19 haneli tweet kimliği: sayıya çevirmeden metin olarak
        p_mint: mint,
        p_raw_text: text,
        p_msg_ts: at.toISOString()
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
