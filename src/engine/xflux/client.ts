import { request } from 'node:https'
import type { XHit, XMonitor, XPollResult } from '../../shared/types'
import type { FeedAuthor, FeedMedia } from '../../shared/feed'

// XFlux (X/Twitter veri servisi) — https://www.xfluxapi.com/docs/api
// İzleyiciler (monitor) XFlux panelinden kurulur; API ile sadece okunur.
// Tüm izleyiciler ve son gönderileri TEK çağrıda alınır: GET /monitors?include_hits=1
// Yanıt şeması belgelenmediği için alanlar esnek okunur.

const HOST = 'www.xfluxapi.com'

function get(path: string, apiKey: string) {
  return new Promise<{ status: number; text: string; headers: Record<string, string | undefined> }>((resolve, reject) => {
    const req = request(
      { host: HOST, method: 'GET', path, headers: { 'X-API-Key': apiKey, 'User-Agent': 'memebot' }, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf-8'),
            headers: {
              quotaRemaining: res.headers['x-quota-remaining'] as string | undefined,
              quotaLimit: res.headers['x-quota-limit'] as string | undefined,
              retryAfter: res.headers['retry-after'] as string | undefined
            }
          })
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error('XFlux isteği zaman aşımına uğradı')))
    req.on('error', reject)
    req.end()
  })
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (...vs: unknown[]) => vs.find((v) => typeof v === 'string' && v) as string | undefined
const idStr = (...vs: unknown[]) => {
  for (const v of vs) if ((typeof v === 'string' && v) || typeof v === 'number') return String(v)
  return undefined
}

function arrayIn(o: unknown, keys: string[]): unknown[] {
  if (Array.isArray(o)) return o
  if (!isObj(o)) return []
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  for (const k of keys) if (isObj(o[k])) {
    const inner = arrayIn(o[k], keys)
    if (inner.length) return inner
  }
  return []
}

// Gönderi metni + bağlantılar: mint adresi çoğu zaman link içinde (pump.fun/…, dexscreener/…)
function hitText(h: Obj): string {
  const parts: string[] = []
  const walk = (v: unknown, key: string, depth: number) => {
    // tweet → entities → urls → [i] → expanded_url: 5+ seviye derinlik gerekebilir
    if (depth > 8) return
    if (typeof v === 'string') {
      if (/text|content|body|url|expanded|link|caption/i.test(key) && !/profile|avatar|image|media|photo/i.test(key)) parts.push(v)
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key, depth + 1))
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1)
  }
  walk(h, '', 0)
  return [...new Set(parts)].join('\n')
}

// Gönderi yazarı: X API v1 (user.screen_name) ve v2 (author.username) biçimlerini dener
function parseAuthor(o: unknown): FeedAuthor | undefined {
  if (!isObj(o)) return undefined
  const u = [o.user, o.author, o.core && isObj(o.core) ? (o.core as Obj).user : undefined].find(isObj) as Obj | undefined
  if (!u) return undefined
  const legacy = isObj(u.legacy) ? (u.legacy as Obj) : u
  const followers = Number(legacy.followers_count ?? u.followers_count ?? (isObj(u.public_metrics) ? (u.public_metrics as Obj).followers_count : undefined))
  const avatar = str(legacy.profile_image_url_https, u.profile_image_url_https, u.profile_image_url, u.avatar)
  const a: FeedAuthor = {
    name: str(legacy.name, u.name, u.display_name),
    handle: str(legacy.screen_name, u.screen_name, u.username, u.handle)?.replace(/^@/, ''),
    // Profil fotoğrafının büyük sürümü (X "_normal" = 48 px)
    avatar: avatar?.replace('_normal.', '_bigger.'),
    verified: Boolean(u.verified ?? u.is_blue_verified ?? legacy.verified),
    followers: Number.isFinite(followers) ? followers : undefined
  }
  return a.name || a.handle ? a : undefined
}

function parseMedia(t: Obj): FeedMedia[] {
  const lists = [
    isObj(t.extended_entities) ? (t.extended_entities as Obj).media : undefined,
    isObj(t.entities) ? (t.entities as Obj).media : undefined,
    t.media,
    t.attachments && isObj(t.attachments) ? (t.attachments as Obj).media : undefined
  ]
  const out: FeedMedia[] = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const m of list) {
      if (!isObj(m)) continue
      const url = str(m.media_url_https, m.media_url, m.preview_image_url, m.url)
      if (!url || !/^https:\/\//.test(url) || out.some((x) => x.url === url)) continue
      out.push({ type: /video|gif/.test(String(m.type ?? '')) ? 'video' : 'photo', url })
    }
    if (out.length) break
  }
  return out.slice(0, 4)
}

export function parseHit(raw: unknown): XHit | null {
  if (!isObj(raw)) return null
  const t = isObj(raw.tweet) ? raw.tweet : raw
  // Hit'in kendi kimliği UUID olabilir; tweet kimliği sayısaldır — ilk sayısal adayı al
  const id = [t.id_str, t.tweet_id, t.id, raw.tweet_id, raw.id].map((v) => idStr(v)).find((v) => v && /^\d{1,19}$/.test(v))
  if (!id) return null
  const created = str(t.created_at, raw.created_at, raw.detected_at, raw.createdAt)
  const ts = created ? Date.parse(created) : NaN
  const legacy = isObj(t.legacy) ? (t.legacy as Obj) : t
  const quoted = [t.quoted_status, t.quoted_tweet, t.quote].find(isObj) as Obj | undefined
  const retweeted = [t.retweeted_status, t.retweeted_tweet].find(isObj) as Obj | undefined
  const replyTo = str(legacy.in_reply_to_screen_name, t.in_reply_to_screen_name, t.in_reply_to_username)
  const kind: XHit['kind'] = retweeted ? 'repost' : quoted ? 'quote' : replyTo || t.is_reply === true ? 'reply' : 'post'
  const refSrc = retweeted ?? quoted
  return {
    tweetId: id,
    text: hitText(raw),
    body: str(legacy.full_text, t.full_text, legacy.text, t.text, raw.text, raw.content),
    createdAt: Number.isFinite(ts) ? ts : undefined,
    author: parseAuthor(t) ?? parseAuthor(raw),
    media: parseMedia(legacy).length ? parseMedia(legacy) : parseMedia(t),
    kind,
    ref: refSrc
      ? { author: parseAuthor(refSrc), text: str(refSrc.full_text, refSrc.text) }
      : replyTo
        ? { author: { handle: replyTo } }
        : undefined
  }
}

export function parseMonitors(data: unknown): XMonitor[] {
  return arrayIn(data, ['data', 'monitors', 'items', 'list'])
    .filter(isObj)
    .map((m) => {
      const id = idStr(m.id, m.monitor_id, m.uuid)
      const username = str(m.username, m.target, m.handle, m.screen_name, isObj(m.user) ? m.user.username : undefined)
      const hits = arrayIn(m.hits ?? m.recent_hits ?? [], ['hits', 'data', 'items'])
        .map(parseHit)
        .filter((h): h is XHit => h !== null)
      return id ? { id, username: (username ?? id).replace(/^@/, ''), hits } : null
    })
    .filter((m): m is XMonitor => m !== null)
}

export async function pollMonitors(apiKey: string, hitLimit = 5): Promise<XPollResult> {
  try {
    const res = await get(`/api/v1/monitors?include_hits=1&hit_limit=${Math.min(20, Math.max(1, hitLimit))}`, apiKey)
    const quota = res.headers.quotaRemaining !== undefined ? Number(res.headers.quotaRemaining) : undefined
    let body: unknown
    try {
      body = JSON.parse(res.text)
    } catch {
      return { ok: false, status: res.status, error: `Geçersiz yanıt (${res.status})` }
    }
    if (res.status === 429) {
      const code = isObj(body) ? str(body.code, isObj(body.error) ? body.error.code : undefined) : undefined
      return {
        ok: false,
        status: 429,
        error: code === 'QUOTA_EXCEEDED' ? 'XFlux aylık kotası doldu' : 'XFlux dakikalık istek sınırı aşıldı',
        retryAfterSec: Number(res.headers.retryAfter) || 60,
        quotaRemaining: quota
      }
    }
    if (res.status < 200 || res.status >= 300) {
      const err = isObj(body) ? str(body.error, isObj(body.error) ? body.error.message : undefined, body.message) : undefined
      return { ok: false, status: res.status, error: err ?? `HTTP ${res.status}` }
    }
    return { ok: true, monitors: parseMonitors(body), quotaRemaining: quota }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
}
