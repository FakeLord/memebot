import type { EngineContext } from './context'
import { extractMints } from '../shared/extract'
import { extractTickers, searchTerms, type FeedAuthor, type FeedMedia, type FeedRef, type FeedSuggestion, type KeywordRule } from '../shared/feed'

// Canlı akış yazıcısı: izlenen kaynakların gönderilerini karta (feed_items) çevirir,
// Telegram görsel önizlemelerini karta ekler ve kartın öneri ızgarasını GMGN aramasıyla doldurur.
// Telegram önizlemesi kartın içinde (data URL) durur: özel grupların görselleri herkese açık bir depoya gitmez,
// satırla birlikte RLS korumasında kalır ve 7 gün sonra kartla birlikte silinir.

const PHOTO_MAX_BYTES = 150 * 1024
const RETENTION_MS = 7 * 24 * 3600_000
const SEARCH_CACHE_MS = 2 * 60_000
const MAX_SUGGESTIONS = 6

export interface FeedInput {
  platform: 'telegram' | 'x'
  externalId: string
  author: FeedAuthor
  body: string // kartta görünen metin
  scanText?: string // adres ayıklama için (gizli bağlantılar dahil); yoksa body
  media?: FeedMedia[]
  kind?: 'post' | 'reply' | 'quote' | 'repost'
  ref?: FeedRef
  url?: string
  postedAt?: Date
  edited?: boolean
}

type Obj = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function parseSearchCoins(data: unknown, term: string): FeedSuggestion[] {
  const root = data && typeof data === 'object' && 'data' in (data as Obj) ? (data as Obj).data : data
  const coins = root && typeof root === 'object' ? (root as Obj).coins : undefined
  if (!Array.isArray(coins)) return []
  return coins
    .filter((c): c is Obj => !!c && typeof c === 'object' && (!(c as Obj).chain || (c as Obj).chain === 'sol') && typeof (c as Obj).address === 'string')
    .map((c) => ({
      address: c.address as string,
      name: str(c.name),
      symbol: str(c.symbol),
      logo: str(c.logo) ?? str(c.image) ?? str(c.icon),
      priceUsd: num(c.price),
      mcapUsd: num(c.mcp) ?? num(c.market_cap),
      holders: num(c.holder_count),
      term
    }))
}

export class FeedWriter {
  private cache = new Map<string, { at: number; coins: FeedSuggestion[] }>()

  constructor(
    private readonly ctx: EngineContext,
    private readonly keywordsFor: (userId: string) => KeywordRule[] = () => []
  ) {}

  /** Gönderiyi karta yazar (aynı gönderi tek kart; düzenlenirse metin güncellenir). */
  async ingest(userId: string, sourceId: string | null, f: FeedInput): Promise<string | null> {
    const scan = f.scanText ?? f.body
    const row: Obj = {
      user_id: userId,
      source_id: sourceId,
      platform: f.platform,
      external_id: f.externalId,
      author: f.author,
      text: f.body.slice(0, 4000),
      kind: f.kind ?? 'post',
      ref: f.ref ?? null,
      url: f.url ?? null,
      mints: extractMints(scan).slice(0, 5),
      tickers: extractTickers(f.body).slice(0, 10),
      posted_at: f.postedAt?.toISOString() ?? null
    }
    if (f.media?.length) row.media = f.media
    const { data, error } = await this.ctx.db
      .from('feed_items')
      .upsert(row, { onConflict: 'user_id,platform,external_id' })
      .select('id, suggestions')
      .single()
    if (error) {
      this.ctx.log.warn('akış kartı yazılamadı', { error: error.message })
      return null
    }
    if (data.suggestions == null || f.edited) void this.suggest(userId, data.id, f.body)
    return data.id
  }

  /** Telegram görsel önizlemesi: küçükse karta gömülür (büyük görseller atlanır). */
  async attachPhoto(userId: string, platform: 'telegram' | 'x', externalId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > PHOTO_MAX_BYTES) return
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
    const url = `data:image/${isPng ? 'png' : 'jpeg'};base64,${Buffer.from(bytes).toString('base64')}`
    await this.ctx.db
      .from('feed_items')
      .update({ media: [{ type: 'photo', url }] })
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('external_id', externalId)
  }

  private async search(userId: string, term: string): Promise<FeedSuggestion[]> {
    const key = term.toLocaleLowerCase('tr')
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.coins
    const client = this.ctx.gmgnRead(userId)
    if (!client) return []
    const r = await client.marketSearch(term)
    if (!r.ok) return []
    const coins = parseSearchCoins(r.data, term)
    this.cache.set(key, { at: Date.now(), coins })
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!)
    return coins
  }

  /** Kartın öneri ızgarası: $TICKER, tırnak içi ve anahtar kelimelerle eşleşen en fazla 6 token. */
  async suggest(userId: string, itemId: string, body: string): Promise<FeedSuggestion[]> {
    // Regex türü kelimeler motorda çalıştırılmaz: hatalı/ağır bir ifade motoru (herkes için) kilitleyebilir.
    // Vurgu ve bildirim için regex sadece kullanıcının kendi tarayıcısında uygulanır.
    const terms = searchTerms(body, this.keywordsFor(userId).filter((k) => k.match !== 'regex'))
    const out: FeedSuggestion[] = []
    for (const term of terms) {
      for (const c of await this.search(userId, term)) {
        if (out.length >= MAX_SUGGESTIONS) break
        if (!out.some((x) => x.address === c.address)) out.push(c)
      }
    }
    await this.ctx.db.from('feed_items').update({ suggestions: out }).eq('id', itemId)
    return out
  }

  /** 7 günden eski kartları siler. */
  async cleanup(): Promise<number> {
    const before = new Date(Date.now() - RETENTION_MS).toISOString()
    const { data } = await this.ctx.db.from('feed_items').delete().lt('received_at', before).select('id')
    return data?.length ?? 0
  }
}
