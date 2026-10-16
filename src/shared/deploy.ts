// Token deploy (GMGN /v1/cooking/create_token): form tipi, doğrulama, istek gövdesi, ad önerileri.
// Kaynak: github.com/GMGNAI/gmgn-skills → skills/gmgn-cooking/SKILL.md, src/client/OpenApiClient.ts (CreateTokenParams)
// Bundle / sniper / çoklu cüzdan alanları bilinçli olarak YOK (kapsam dışı, V2-TASLAK §3).

import { extractQuotes, extractTickers } from './feed'

export type DeployPlatform = 'pump' | 'bonk' | 'bags'

export const PLATFORM_LABEL: Record<DeployPlatform, string> = { pump: 'Pump.fun', bonk: 'Bonk', bags: 'BAGS' }

export const NAME_MAX = 32
export const SYMBOL_MAX = 13
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const DEPLOY_MAX_BUY_SOL = 5 // emirlerle aynı mutlak sınır

export interface FeeShare {
  provider: 'twitter' | 'solana' | 'github'
  username: string
  percent: number
}

export type AutoSell = { type: 'delay'; seconds: number; percent: number } | { type: 'mcap'; mcapUsd: number; percent: number }

export type DeployImage = { kind: 'url'; url: string } | { kind: 'base64'; data: string; bytes: number }

export interface DeployForm {
  platform: DeployPlatform
  name: string
  symbol: string
  description?: string
  website?: string
  twitter?: string
  telegram?: string
  image: DeployImage | null
  buySol: number // geliştirici alımı (0 = alım yok)
  feeShares: FeeShare[] // sadece pump / bags
  autoSell: AutoSell[]
  preset: 1 | 2 | 3
  feedItemId?: string
}

const URL_RE = /^https?:\/\/[^\s]+$/i

export function validateDeploy(f: DeployForm): string[] {
  const e: string[] = []
  const name = f.name.trim()
  const symbol = f.symbol.trim()
  if (!name) e.push('Ad boş olamaz')
  if (name.length > NAME_MAX) e.push(`Ad en fazla ${NAME_MAX} karakter`)
  if (!symbol) e.push('Sembol boş olamaz')
  if (symbol.length > SYMBOL_MAX) e.push(`Sembol en fazla ${SYMBOL_MAX} karakter`)
  if (symbol && !/^[\p{L}\p{N}]+$/u.test(symbol)) e.push('Sembol sadece harf ve rakam içerebilir')
  if (/[\u0000-\u001f]/.test(name + symbol + (f.description ?? ''))) e.push('Metinlerde kontrol karakteri olamaz')
  if ((f.description ?? '').length > 500) e.push('Açıklama en fazla 500 karakter')
  for (const [label, v] of [['Website', f.website], ['X bağlantısı', f.twitter], ['Telegram bağlantısı', f.telegram]] as const) {
    if (v && !URL_RE.test(v.trim())) e.push(`${label} http(s) ile başlayan bir adres olmalı`)
  }
  if (!f.image) e.push('Görsel seçin')
  else if (f.image.kind === 'url' && !/^https:\/\//i.test(f.image.url)) e.push('Görsel adresi https olmalı')
  else if (f.image.kind === 'base64' && f.image.bytes > IMAGE_MAX_BYTES) e.push('Görsel en fazla 2 MB olabilir')
  if (!(f.buySol >= 0) || f.buySol > DEPLOY_MAX_BUY_SOL) e.push(`Geliştirici alımı 0–${DEPLOY_MAX_BUY_SOL} SOL olmalı`)
  if (f.feeShares.length) {
    if (f.platform === 'bonk') e.push('Bonk ücret paylaşımını desteklemiyor')
    if (f.feeShares.some((s) => !s.username.trim())) e.push('Ücret paylaşımında kullanıcı adı boş olamaz')
    if (f.feeShares.some((s) => !(s.percent > 0))) e.push("Ücret paylaşımı yüzdeleri 0'dan büyük olmalı")
    const total = f.feeShares.reduce((a, s) => a + s.percent, 0)
    if (Math.abs(total - 100) > 1e-9) e.push(`Ücret paylaşımı toplamı %100 olmalı (şu an %${+total.toFixed(2)})`)
  }
  for (const s of f.autoSell) {
    if (!(s.percent > 0 && s.percent <= 100)) e.push('Otomatik satış yüzdesi 1–100 olmalı')
    if (s.type === 'delay' && !(s.seconds >= 1)) e.push('Otomatik satış süresi en az 1 sn')
    if (s.type === 'mcap' && !(s.mcapUsd > 0)) e.push('Otomatik satış piyasa değeri girin')
  }
  if (f.autoSell.length && !(f.buySol > 0)) e.push('Otomatik satış için geliştirici alımı gerekir')
  return [...new Set(e)]
}

export interface DeployFees {
  priorityFeeSol: number
  tipFeeSol: number
  slippage: number | 'auto'
  antiMev: boolean
}

/** GMGN create_token istek gövdesi (snake_case, resmi istemciyle aynı alan adları). */
export function buildCreateToken(f: DeployForm, wallet: string, fees: DeployFees): Record<string, unknown> {
  const p: Record<string, unknown> = {
    chain: 'sol',
    dex: f.platform,
    from_address: wallet,
    name: f.name.trim(),
    symbol: f.symbol.trim(),
    buy_amt: String(f.buySol),
    priority_fee: String(Math.max(0.0001, fees.priorityFeeSol)),
    tip_fee: String(Math.max(0.00001, fees.tipFeeSol)),
    is_anti_mev: fees.antiMev,
    ...(fees.slippage === 'auto' ? { auto_slippage: true } : { slippage: Math.round(Math.min(100, Math.max(1, fees.slippage))) })
  }
  if (f.image?.kind === 'url') p.image_url = f.image.url
  else if (f.image?.kind === 'base64') p.image = f.image.data
  for (const k of ['description', 'website', 'twitter', 'telegram'] as const) if (f[k]?.trim()) p[k] = f[k]!.trim()
  if (f.feeShares.length && f.platform !== 'bonk') {
    const list = f.feeShares.map((s) => ({ provider: s.provider, username: s.username.trim().replace(/^@/, ''), basic_points: Math.round(s.percent * 100) }))
    // Yuvarlama farkı: toplam tam 10000 olsun
    const diff = 10000 - list.reduce((a, s) => a + s.basic_points, 0)
    list[0].basic_points += diff
    p[f.platform === 'pump' ? 'pump_fee_share_list' : 'bags_fee_share_list'] = list
  }
  if (f.autoSell.length) {
    p.sell_configs = f.autoSell.map((s) =>
      s.type === 'delay'
        ? { sell_type: 'delay_sell', delay_sec: Math.round(s.seconds), sell_ratio: String(s.percent / 100), wallet_addresses: [wallet] }
        : { sell_type: 'limit_order', check_price: String(s.mcapUsd), sell_ratio: String(s.percent / 100), wallet_addresses: [wallet] }
    )
  }
  return p
}

/** Kayıt/önizleme için: base64 görseli kısaltır. */
export function redactRequest(p: Record<string, unknown>): Record<string, unknown> {
  if (typeof p.image !== 'string') return p
  return { ...p, image: `<base64 ${Math.round((p.image.length * 3) / 4 / 1024)} KB>` }
}

// Kripto gönderilerinde ad olmayan kısaltmalar (tek başına önerilmez)
const NAME_STOP = new Set(['CA', 'RT', 'DM', 'TG', 'LP', 'CT', 'NFA', 'DYOR', 'SOL', 'ETH', 'BTC'])

/** Gönderiden ad önerileri: $TICKER, tırnak içi, Büyük Harfli kelime grupları.
 *  Bağlantılar ve token adresleri (base58, 32–44 karakter) önce metinden çıkarılır. */
export function nameSuggestions(text: string, max = 8): string[] {
  const clean = text.replace(/https?:\/\/\S+/g, ' ').replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, ' ')
  const out: string[] = []
  const push = (s: string) => {
    const t = s.trim().slice(0, NAME_MAX)
    if (t.length < 2 || NAME_STOP.has(t.toUpperCase())) return
    if (!out.some((x) => x.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr'))) out.push(t)
  }
  extractQuotes(clean).forEach(push)
  extractTickers(clean).forEach(push)
  for (const m of clean.matchAll(/\b(\p{Lu}[\p{L}\p{N}']+(?:\s+\p{Lu}[\p{L}\p{N}']+){0,3})/gu)) push(m[1])
  return out.slice(0, max)
}

/** Addan sembol önerisi: $TICKER ise kendisi, yoksa harf/rakamlar büyük harf (≤13). */
export function symbolFor(name: string): string {
  const t = extractTickers(`$${name.replace(/\s+/g, '')}`)[0]
  const base = t ?? name
  const words = name.trim().split(/\s+/)
  const s = words.length > 2 ? words.map((w) => w[0]).join('') : base
  return s
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toUpperCase()
    .slice(0, SYMBOL_MAX)
}
