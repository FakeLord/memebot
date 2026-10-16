import { request } from 'node:https'
import type { XHit, XMonitor, XPollResult } from '../../shared/types'

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

export function parseHit(raw: unknown): XHit | null {
  if (!isObj(raw)) return null
  const t = isObj(raw.tweet) ? raw.tweet : raw
  // Hit'in kendi kimliği UUID olabilir; tweet kimliği sayısaldır — ilk sayısal adayı al
  const id = [t.id_str, t.tweet_id, t.id, raw.tweet_id, raw.id].map((v) => idStr(v)).find((v) => v && /^\d{1,19}$/.test(v))
  if (!id) return null
  const created = str(t.created_at, raw.created_at, raw.detected_at, raw.createdAt)
  const ts = created ? Date.parse(created) : NaN
  return {
    tweetId: id,
    text: hitText(raw),
    createdAt: Number.isFinite(ts) ? ts : undefined
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
