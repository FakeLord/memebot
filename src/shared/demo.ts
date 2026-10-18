import type { DCandidate, DCaller, DOrder, DPosition, DSignal, DSource } from './dashboard'
import type { DashGmgn } from './engine'
import type { FeedItem, FeedSuggestion } from './feed'

// Demo modu için örnek veri: tamamen istemcide üretilir, veritabanına YAZILMAZ ve gerçek hesapla ilgisi yoktur.
// Sabit tohumlu üretim: aynı gün aynı görünüm (tekrarlanabilir, test edilebilir).

export interface DemoPosition extends DPosition {
  entry_mcap: number | null
  proceeds_estimated: boolean
  price_at: string | null
}

export interface DemoPending {
  id: string
  mint: string
  verdict: string
  summary: { symbol?: string; name?: string; mcapUsd?: number } | null
  created_at: string
  expires_at: string
}

export interface DemoData {
  positions: DemoPosition[]
  orders: DOrder[]
  signals: DSignal[]
  signalRows: { id: string; source_id: string | null; mint: string; raw_text: string | null; msg_ts: string | null; received_at: string; sources: { title: string; type: string } | null }[]
  callers: DCaller[]
  candidates: DCandidate[]
  sources: DSource[]
  pending: DemoPending[]
  recentSignals: { id: string; mint: string; received_at: string; source_id: string | null }[]
  dash: DashGmgn
  feed: FeedItem[]
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const DAY = 86_400_000

function rng(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const SYMS = ['WIF2', 'MOONCAT', 'PEPE9', 'BONKER', 'DOGEAI', 'FROGGY', 'GIGA', 'RETARDIO', 'POPCAT', 'MEWTWO', 'SOLPUMP', 'TRUMPY', 'CHILL', 'ZEREBRO', 'NEET', 'FWOG']

const PEOPLE: { id: string; name: string; handle: string | null; win: number; rule: DCaller['rule'] }[] = [
  { id: 'demo-alo', name: 'Alo', handle: 'alo_sol', win: 0.74, rule: 'trusted' },
  { id: 'demo-bora', name: 'Bora', handle: 'bora_x', win: 0.62, rule: 'normal' },
  { id: 'demo-cem', name: 'Cem Çağrı', handle: null, win: 0.5, rule: 'normal' },
  { id: 'demo-deniz', name: 'Deniz', handle: 'dnz_calls', win: 0.36, rule: 'normal' },
  { id: 'demo-ece', name: 'Ece', handle: 'ece_gem', win: 0.68, rule: 'trusted' },
  { id: 'demo-fatih', name: 'Fatih', handle: 'fatihsol', win: 0.28, rule: 'blocked' },
  { id: 'demo-gul', name: 'Gül', handle: 'gulcalls', win: 0.58, rule: 'normal' }
]

export function buildDemo(now = Date.now()): DemoData {
  const r = rng(20261018)
  const mint = () => Array.from({ length: 44 }, () => B58[Math.floor(r() * 58)]).join('')
  const iso = (t: number) => new Date(t).toISOString()
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)

  const sources: DSource[] = [
    { id: 'demo-s-tg1', title: 'Alpha Calls TR', type: 'telegram' },
    { id: 'demo-s-tg2', title: 'Sol Gem Hunters', type: 'telegram' },
    { id: 'demo-s-tg3', title: 'Pump Radar', type: 'telegram' },
    { id: 'demo-s-x1', title: '@cryptokaptan', type: 'x' },
    { id: 'demo-s-x2', title: '@solanaalpha', type: 'x' }
  ]
  const groups = sources.slice(0, 3).map((s) => s.id)

  const positions: DemoPosition[] = []
  const signals: DSignal[] = []
  const signalRows: DemoData['signalRows'] = []
  const orders: DOrder[] = []
  const N = 64
  for (let i = 0; i < N; i++) {
    const p = PEOPLE[i % PEOPLE.length]
    const viaX = i % 4 === 3
    // Her gün birkaç işlem; "bugün" kapananlar da olsun ama kapanış gelecekte kalmasın
    const opened = now - (i * 0.42 + 0.05 + r() * 0.25) * DAY - 3_600_000
    const open = i < 5
    const win = r() < p.win
    const cost = [0.05, 0.1, 0.1, 0.2, 0.25][Math.floor(r() * 5)]
    const mult = win ? 1.25 + r() * 2.2 : 0.3 + r() * 0.45
    const m = mint()
    // İlk birkaç kapanan işlem "bugün" kapansın (Bugün kutusu dolu görünsün)
    const closedAt = i >= 5 && i <= 8 ? Math.min(now - 60_000, midnight.getTime() + (i - 4) * 2.5 * 3_600_000) : Math.min(now - 60_000, opened + (0.08 + r() * 0.7) * DAY)
    const sym = SYMS[i % SYMS.length]
    const dry = i % 3 === 0
    positions.push({
      id: `demo-p-${i}`,
      mint: m,
      symbol: sym,
      status: open ? 'open' : 'closed',
      is_dry_run: dry,
      cost_sol: cost,
      proceeds_sol: open ? 0 : +(cost * mult).toFixed(4),
      amount_raw: open ? '1000000' : '0',
      amount_initial_raw: '1000000',
      entry_price: 0.0001,
      last_price_usd: open ? +(0.0001 * (0.8 + r() * 1.9)).toPrecision(4) as number : null,
      opened_at: iso(opened),
      closed_at: open ? null : iso(closedAt),
      close_reason: open ? null : win ? 'gmgn_tpsl' : 'manual',
      entry_mcap: Math.round(60_000 + r() * 900_000),
      proceeds_estimated: false,
      price_at: open ? iso(now - 12_000) : null
    })
    const sigAt = opened - 60_000
    const sid = `demo-sig-${i}`
    const srcId = viaX ? (i % 8 === 3 ? 'demo-s-x1' : 'demo-s-x2') : groups[i % groups.length]
    const src = sources.find((s) => s.id === srcId)!
    signals.push({ mint: m, source_id: srcId, received_at: iso(sigAt), sender_id: viaX ? null : p.id })
    signalRows.push({ id: sid, source_id: srcId, mint: m, raw_text: `CA ${m}`, msg_ts: iso(sigAt - 800), received_at: iso(sigAt), sources: { title: src.title, type: src.type } })
    orders.push({ side: 'buy', status: 'confirmed', is_dry_run: dry, created_at: iso(opened), amount_in: String(Math.round(cost * 1e9)) })
    if (!open) orders.push({ side: 'sell', status: 'confirmed', is_dry_run: dry, created_at: iso(closedAt), amount_in: '1000000' })
  }

  const callers: DCaller[] = PEOPLE.map((p) => ({ sender_id: p.id, name: p.name, handle: p.handle, rule: p.rule }))

  // Bugünün hunisi için bugüne ait sinyal/aday/emir da olsun
  const todaySignals = 11
  for (let k = 0; k < todaySignals; k++) {
    const t = Math.max(midnight.getTime() + 60_000, now - (k + 1) * 47 * 60_000)
    const m = mint()
    signals.push({ mint: m, source_id: groups[k % groups.length], received_at: iso(t), sender_id: PEOPLE[k % PEOPLE.length].id })
    signalRows.push({ id: `demo-sig-t${k}`, source_id: groups[k % groups.length], mint: m, raw_text: `CA ${m}`, msg_ts: iso(t - 900), received_at: iso(t), sources: { title: sources[k % 3].title, type: 'telegram' } })
  }
  const candidates: DCandidate[] = [
    ...Array.from({ length: 6 }, (_, k) => ({ status: 'approved' as const, created_at: iso(now - (k + 1) * 55 * 60_000) })),
    ...Array.from({ length: 3 }, (_, k) => ({ status: 'rejected' as const, created_at: iso(now - (k + 1) * 71 * 60_000) })),
    { status: 'expired' as const, created_at: iso(now - 5 * 3_600_000) },
    { status: 'pending' as const, created_at: iso(now - 60_000) },
    { status: 'pending' as const, created_at: iso(now - 120_000) }
  ]
  const pending: DemoPending[] = [
    { id: 'demo-c1', mint: mint(), verdict: 'pass', summary: { symbol: 'ZEREBRO', name: 'Zerebro', mcapUsd: 740_000 }, created_at: iso(now - 60_000), expires_at: iso(now + 8 * 60_000) },
    { id: 'demo-c2', mint: mint(), verdict: 'pass', summary: { symbol: 'NEET', name: 'Neet', mcapUsd: 510_000 }, created_at: iso(now - 120_000), expires_at: iso(now + 7 * 60_000) }
  ]
  const recentSignals = signalRows
    .slice()
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, 8)
    .map((s) => ({ id: s.id, mint: s.mint, received_at: s.received_at, source_id: s.source_id }))

  const trend = [
    ['WIF2', 4.2e6, 9.8e5, 14.2], ['GIGA', 2.9e6, 7.1e5, -6.1], ['POPCAT', 2.1e6, 5.5e5, 22.7], ['MEWTWO', 1.3e6, 3.2e5, 8.4],
    ['MOONCAT', 8.6e5, 2.9e5, -11.3], ['ZEREBRO', 7.4e5, 2.2e5, 31.5], ['NEET', 5.1e5, 1.7e5, 4.9], ['FWOG', 4.4e5, 1.1e5, -2.2]
  ] as const
  const stat = (realized: number, n: number) => ({ realizedProfit: realized, unrealizedProfit: Math.round(realized / 5), winrate: 0.61, totalCost: Math.round(realized * 3.4), buyCount: n, sellCount: n - 6, pnl: 0.29 })
  const dash: DashGmgn = {
    at: now,
    wallet: 'DemoWallet',
    balance: 4.2731,
    stats: { '7d': stat(312, 58), '30d': stat(1184, 214) },
    profits: { '1d': { realizedProfit: 64, unrealizedProfit: 12, totalProfit: 76, totalCost: 410 }, all: { realizedProfit: 5290, unrealizedProfit: 210, totalProfit: 5500, totalCost: 18000 } },
    trending: {
      interval: '5m',
      at: now,
      items: trend.map(([symbol, marketCap, volume, change], i) => ({
        rank: i + 1, address: `Demo${symbol}${'1'.repeat(30)}`, symbol, name: `${symbol} coin`, price: 0.0004 * (9 - i), marketCap, liquidity: Math.round(marketCap / 9), volume,
        swaps: 5200 - i * 400, holders: 9000 - i * 700, change, launchpad: 'pump'
      }))
    },
    error: null
  }

  const sug = (term: string, names: [string, string][]): FeedSuggestion[] =>
    names.map(([name, symbol], i) => ({ address: mint(), name, symbol, logo: undefined, priceUsd: 0.0002 * (i + 1), mcapUsd: 25_000 * (i + 1), holders: 400 + i * 120, term }))
  const card = (n: number, platform: 'x' | 'telegram', sourceId: string, name: string, handle: string, text: string, tickers: string[], ago: number, extra: Partial<FeedItem> = {}): FeedItem => ({
    id: `demo-f-${n}`, user_id: 'demo', source_id: sourceId, platform, external_id: `demo-${n}`,
    author: { name, handle, verified: platform === 'x' && n % 2 === 0, followers: platform === 'x' ? 12_400 * (n + 1) : undefined },
    text, media: [], kind: 'post', ref: null, url: null, mints: [], tickers, suggestions: tickers[0] ? sug(tickers[0], [[`${tickers[0]} Coin`, tickers[0]], [`${tickers[0]} 2.0`, `${tickers[0]}2`], [`Baby ${tickers[0]}`, `B${tickers[0]}`]]) : null,
    hidden: false, pinned: false, posted_at: iso(now - ago - 800), received_at: iso(now - ago), ...extra
  })
  const feed: FeedItem[] = [
    card(1, 'telegram', 'demo-s-tg1', 'Alo · Alpha Calls TR', 'alo_sol', 'Yeni gem: $ZEREBRO akıllı cüzdanlar topluyor, hacim artıyor 🔥', ['ZEREBRO'], 40_000),
    card(2, 'x', 'demo-s-x1', 'Kripto Kaptan', 'cryptokaptan', 'Bugün radarımda: $NEET. Topluluk güçlü, likidite kilitli. NFA.', ['NEET'], 3 * 60_000),
    card(3, 'telegram', 'demo-s-tg2', 'Ece · Sol Gem Hunters', 'ece_gem', '$FWOG için erken giriş fırsatı, likidite kilitli ✅', ['FWOG'], 8 * 60_000),
    card(4, 'x', 'demo-s-x2', 'Solana Alpha', 'solanaalpha', 'Yeni bir şey geliyor $CHILL "chill guy 2.0"', ['CHILL'], 15 * 60_000),
    card(5, 'telegram', 'demo-s-tg3', 'Bora · Pump Radar', 'bora_x', 'CA geldi, ilk 10 dakikada 3x yaptı: $GIGA', ['GIGA'], 27 * 60_000),
    card(6, 'x', 'demo-s-x1', 'Kripto Kaptan', 'cryptokaptan', 'Akşam analizi: BTC ve SOL güçlü. Meme sezonu açılıyor mu? $POPCAT', ['POPCAT'], 52 * 60_000)
  ]

  return { positions, orders, signals, signalRows, callers, candidates, sources, pending, recentSignals, dash, feed }
}
