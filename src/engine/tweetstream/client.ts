import type { FeedAuthor, FeedMedia } from '../../shared/feed'
import type { XHit } from '../../shared/types'

// TweetStream (tweetstream.io): X gönderilerini WebSocket ile anında iten servis.
//  - Gerçek zamanlı akış: wss://ws-global.tweetstream.io/ws (ABD'de ws-iad), kimlik alt protokolle
//  - İzlenen hesaplar TweetStream tarafında tutulur: REST /api/add-account, /api/remove-account, /api/me
//  - Zarf: { v, t, op, id?, ts, d }; gönderi t="tweet", op="content"
// Belgeler: https://tweetstream.io/docs (connection-auth-heartbeat, payloads, account-management)

export const TS_WS = { global: 'wss://ws-global.tweetstream.io/ws', usa: 'wss://ws-iad.tweetstream.io/ws' } as const
export type TsRegion = keyof typeof TS_WS
const TS_API = 'https://api.tweetstream.io'

export interface TsEnvelope {
  v?: number
  t?: string
  op?: string
  id?: string
  ts?: number
  d?: unknown
}

export interface TsMe {
  plan?: string
  tracked: { count: number; limit?: number; handles: string[] }
  websocket?: { count?: number; limit?: number }
  subscription?: string
}

export type TsResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; retryAfterSec?: number }

export type TsHandleState = 'added' | 'already_following' | 'invalid_input' | 'duplicate' | 'not_found' | 'failed' | 'removed' | 'not_following'
export interface TsHandleResult {
  input: string
  state: TsHandleState
  message?: string
}

export interface TsSocket {
  close(): void
}

export interface TsSocketHandlers {
  open: () => void
  event: (e: TsEnvelope) => void
  close: (code: number, reason: string) => void
}

/** Motorun kullandığı arayüz (testlerde sahtesi verilir). */
export interface TweetStreamApi {
  me(apiKey: string): Promise<TsResult<TsMe>>
  add(apiKey: string, handles: string[]): Promise<TsResult<TsHandleResult[]>>
  remove(apiKey: string, handles: string[]): Promise<TsResult<TsHandleResult[]>>
  connect(apiKey: string, region: TsRegion, h: TsSocketHandlers): TsSocket
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** "@Ad" → "ad"; geçersizse null */
export function normalizeHandle(h: string): string | null {
  const s = h
    .trim()
    .replace(/^(https?:\/\/)?(www\.|mobile\.)?(x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s.toLowerCase() : null
}

async function call<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<TsResult<T>> {
  try {
    const r = await fetch(TS_API + path, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000)
    })
    const text = await r.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* düz metin hata */
    }
    // 207: kısmi başarı (satır satır sonuç)
    if (r.ok || r.status === 207) return { ok: true, data: json as T }
    const o = isObj(json) ? json : {}
    const retry = Number(o.retryAfterSeconds ?? r.headers.get('retry-after'))
    return {
      ok: false,
      status: r.status,
      error: str(o.error) ?? str(o.message) ?? (text.slice(0, 200) || `HTTP ${r.status}`),
      retryAfterSec: Number.isFinite(retry) ? retry : undefined
    }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
}

function parseMe(d: unknown): TsMe {
  const o = isObj(d) ? d : {}
  const t = isObj(o.trackedAccounts) ? o.trackedAccounts : {}
  const w = isObj(o.websocket) ? o.websocket : {}
  const s = isObj(o.stripe) ? o.stripe : {}
  return {
    plan: str(o.plan),
    tracked: {
      count: num(t.count) ?? (Array.isArray(t.handles) ? t.handles.length : 0),
      limit: num(t.limit),
      handles: (Array.isArray(t.handles) ? t.handles : []).map((x) => normalizeHandle(String(x))).filter((x): x is string => !!x)
    },
    websocket: { count: num(w.count), limit: num(w.limit) },
    subscription: str(s.subscriptionStatus)
  }
}

function parseResults(d: unknown): TsHandleResult[] {
  const o = isObj(d) ? d : {}
  return (Array.isArray(o.results) ? o.results : []).filter(isObj).map((r) => ({
    input: String(r.input ?? ''),
    state: String(r.state ?? 'failed') as TsHandleState,
    message: str(r.message)
  }))
}

export const tweetStream: TweetStreamApi = {
  async me(apiKey) {
    const r = await call<unknown>(apiKey, 'GET', '/api/me')
    return r.ok ? { ok: true, data: parseMe(r.data) } : r
  },
  async add(apiKey, handles) {
    const r = await call<unknown>(apiKey, 'POST', '/api/add-account', { accounts: handles })
    return r.ok ? { ok: true, data: parseResults(r.data) } : r
  },
  async remove(apiKey, handles) {
    const r = await call<unknown>(apiKey, 'DELETE', '/api/remove-account', { accounts: handles })
    return r.ok ? { ok: true, data: parseResults(r.data) } : r
  },
  connect(apiKey, region, h) {
    // Kimlik WebSocket alt protokolüyle gider (başlık gerekmez); ping/pong'u çalışma ortamı kendisi yanıtlar
    const ws = new WebSocket(TS_WS[region], ['tweetstream.v1', `tweetstream.auth.token.${apiKey}`])
    let closed = false
    ws.addEventListener('open', () => h.open())
    ws.addEventListener('message', (m) => {
      try {
        h.event(JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)) as TsEnvelope)
      } catch {
        /* bozuk çerçeve: yok say */
      }
    })
    ws.addEventListener('close', (e) => {
      if (closed) return
      closed = true
      h.close(e.code, e.reason)
    })
    ws.addEventListener('error', () => {
      /* ardından close gelir */
    })
    return {
      close: () => {
        closed = true
        try {
          ws.close()
        } catch {
          /* zaten kapalı */
        }
      }
    }
  }
}

// ------------------------------------------------------------------ gönderi dönüşümü

function author(a: unknown): FeedAuthor | undefined {
  if (!isObj(a)) return undefined
  const out: FeedAuthor = {
    name: str(a.name),
    handle: str(a.handle)?.replace(/^@/, ''),
    avatar: str(a.profileImage),
    verified: typeof a.verifiedType === 'string' ? a.verifiedType !== 'none' : undefined,
    followers: num(a.followersCount)
  }
  return out.name || out.handle ? out : undefined
}

function media(list: unknown): FeedMedia[] {
  if (!Array.isArray(list)) return []
  const out: FeedMedia[] = []
  for (const m of list) {
    if (!isObj(m)) continue
    const video = m.type === 'video'
    // Video kartında oynatılabilir dosya değil, kapak görseli gösterilir
    const url = video ? (str(m.thumbnail) ?? undefined) : (str(m.url) ?? str(m.thumbnail))
    if (url && /^https:\/\//.test(url) && !out.some((x) => x.url === url)) out.push({ type: video || m.type === 'gif' ? 'video' : 'photo', url })
  }
  return out.slice(0, 4)
}

/** tweet/content → motorun X gönderisi biçimi. Adres taraması için metin, bağlantılar ve alıntılanan gönderi birleştirilir. */
export function tweetToHit(d: unknown): XHit | null {
  if (!isObj(d)) return null
  const tweetId = str(d.tweetId)
  if (!tweetId) return null
  const a = isObj(d.author) ? d.author : {}
  if (a.platform && a.platform !== 'twitter') return null
  const text = typeof d.text === 'string' ? d.text : ''
  const ref = isObj(d.ref) ? d.ref : undefined
  const urls = (Array.isArray(d.urls) ? d.urls : []).filter(isObj).map((u) => str(u.url)).filter((u): u is string => !!u)
  const refText = ref && typeof ref.text === 'string' ? ref.text : ''
  const kindRaw = str(d.kind)
  const kind = kindRaw === 'retweet' ? 'repost' : kindRaw === 'reply' || kindRaw === 'quote' ? kindRaw : 'post'
  return {
    tweetId,
    text: [text, ...urls, refText].filter(Boolean).join('\n'),
    body: text,
    createdAt: num(d.createdAt),
    author: author(d.author),
    media: media(d.media).length ? media(d.media) : media(ref?.media),
    kind,
    ref: ref ? { author: author(ref.author), text: refText || undefined } : undefined
  }
}
