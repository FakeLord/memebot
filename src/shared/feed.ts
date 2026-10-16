// Canlı akış: gönderi kartı tipleri ve metin yardımcıları (motor ve arayüz ortak).

export interface FeedAuthor {
  name?: string
  handle?: string
  avatar?: string
  verified?: boolean
  followers?: number
}

export interface FeedMedia {
  type: 'photo' | 'video'
  url: string
}

export interface FeedSuggestion {
  address: string
  name?: string
  symbol?: string
  logo?: string
  priceUsd?: number
  mcapUsd?: number
  holders?: number
  term: string // hangi arama teriminden geldi
}

export interface FeedRef {
  author?: FeedAuthor
  text?: string
}

export interface FeedItem {
  id: string
  user_id: string
  source_id: string | null
  platform: 'telegram' | 'x'
  external_id: string
  author: FeedAuthor
  text: string
  media: FeedMedia[]
  kind: 'post' | 'reply' | 'quote' | 'repost'
  ref: FeedRef | null
  url: string | null
  mints: string[]
  tickers: string[]
  suggestions: FeedSuggestion[] | null
  hidden: boolean
  pinned: boolean
  posted_at: string | null
  received_at: string
}

// $TICKER: 2–12 harf/rakam, başında harf; fiyat ($100) sayılmaz
const TICKER = /(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{1,11})(?![\w])/g
// "tırnak içi" (düz ve kıvrık tırnak), 2–40 karakter
const QUOTE = /["“”]([^"“”\n]{2,40})["“”]/g

export function extractTickers(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TICKER)) {
    const t = m[1].toUpperCase()
    if (!out.includes(t)) out.push(t)
  }
  return out
}

export function extractQuotes(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(QUOTE)) {
    const q = m[1].trim()
    if (q && !out.includes(q)) out.push(q)
  }
  return out
}

export type KeywordMatch = 'partial' | 'word' | 'regex'

export interface KeywordRule {
  pattern: string
  match: KeywordMatch
  muted?: boolean
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Anahtar kelime → düzenli ifade. Geçersiz regex null döner (yok sayılır). */
export function keywordRegex(k: KeywordRule): RegExp | null {
  if (!k.pattern.trim()) return null
  try {
    if (k.match === 'regex') return new RegExp(k.pattern, 'giu')
    const body = escapeRe(k.pattern.trim())
    return new RegExp(k.match === 'word' ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, 'giu')
  } catch {
    return null
  }
}

/** Gönderinin öneri ızgarası için arama terimleri: önce $TICKER, sonra tırnak içi, sonra eşleşen anahtar kelimeler. */
export function searchTerms(text: string, keywords: KeywordRule[] = [], max = 3): string[] {
  const terms = [...extractTickers(text), ...extractQuotes(text)]
  for (const k of keywords) {
    if (k.muted) continue
    const re = keywordRegex(k)
    if (!re) continue
    for (const m of text.matchAll(re)) {
      if (m[0].trim().length >= 2) terms.push(m[0].trim())
    }
  }
  const seen = new Set<string>()
  return terms.filter((t) => {
    const key = t.toLocaleLowerCase('tr')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, max)
}

export type Segment = { text: string; mark?: 'ticker' | 'quote' | 'keyword' | 'mint' | 'link'; color?: string }

/** Metni vurgulu parçalara böler (arayüz kart gövdesi). Çakışmada önce gelen/uzun olan kazanır. */
export function highlight(text: string, opts: { keywords?: (KeywordRule & { color?: string | null })[]; mints?: string[] } = {}): Segment[] {
  type Span = { start: number; end: number; mark: NonNullable<Segment['mark']>; color?: string }
  const spans: Span[] = []
  const add = (re: RegExp, mark: Span['mark'], group = 0, color?: string) => {
    for (const m of text.matchAll(re)) {
      const full = m[0]
      const part = m[group] ?? full
      const start = (m.index ?? 0) + full.indexOf(part)
      spans.push({ start, end: start + part.length, mark, color })
    }
  }
  add(/https?:\/\/[^\s]+/g, 'link')
  for (const mint of opts.mints ?? []) add(new RegExp(escapeRe(mint), 'g'), 'mint')
  add(/\$[A-Za-z][A-Za-z0-9]{1,11}(?![\w])/g, 'ticker')
  add(/["“”][^"“”\n]{2,40}["“”]/g, 'quote')
  for (const k of opts.keywords ?? []) {
    if (k.muted) continue
    const re = keywordRegex(k)
    if (re) add(re, 'keyword', 0, k.color ?? undefined)
  }
  spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const out: Segment[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start < pos || s.end <= s.start) continue
    if (s.start > pos) out.push({ text: text.slice(pos, s.start) })
    out.push({ text: text.slice(s.start, s.end), mark: s.mark, color: s.color })
    pos = s.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
