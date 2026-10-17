import type { DashProfit, DashTrend, DashWalletStats } from '../../shared/engine'

// GMGN dashboard yanıtlarının savunmacı ayrıştırıcıları. Yanıtlar bazen {"data": …} ile sarılır, tutarlar
// metin olarak gelir; eksik alan 0 sayılmaz, tanımsız kalır (0 "hiç kazanmadı" gibi okunmasın).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** {"data": X} → X */
function unwrap(d: unknown): unknown {
  return isObj(d) && 'data' in d && d.data !== undefined && Object.keys(d).length <= 3 ? d.data : d
}

/** wallet_stats: tek nesne ya da (toplu istekte) dizi → ilk nesne */
export function parseWalletStats(d: unknown): DashWalletStats | null {
  const u = unwrap(d)
  const o = Array.isArray(u) ? u[0] : u
  if (!isObj(o)) return null
  // Bazı dağıtımlar {"stats": {...}} ya da {"list":[...]} ile sarar
  const s = isObj(o.stats) ? o.stats : Array.isArray(o.list) && isObj(o.list[0]) ? (o.list[0] as Obj) : o
  const realized = num(s.realized_profit)
  const cost = num(s.total_cost)
  if (realized === undefined && cost === undefined && num(s.winrate) === undefined) return null
  return {
    realizedProfit: realized ?? 0,
    unrealizedProfit: num(s.unrealized_profit) ?? 0,
    winrate: Math.min(1, Math.max(0, num(s.winrate) ?? 0)),
    totalCost: cost ?? 0,
    buyCount: num(s.buy_count) ?? num(s.buy) ?? 0,
    sellCount: num(s.sell_count) ?? num(s.sell) ?? 0,
    pnl: num(s.pnl) ?? (cost ? (realized ?? 0) / cost : 0)
  }
}

/** wallet_profits: { list: [{ … }] } */
export function parseWalletProfit(d: unknown): DashProfit | null {
  const u = unwrap(d)
  const list = isObj(u) && Array.isArray(u.list) ? u.list : Array.isArray(u) ? u : []
  const o = list[0]
  if (!isObj(o)) return null
  const realized = num(o.realized_profit) ?? 0
  const unrealized = num(o.unrealized_profit) ?? 0
  return {
    realizedProfit: realized,
    unrealizedProfit: unrealized,
    totalProfit: num(o.total_profit) ?? realized + unrealized,
    totalCost: num(o.total_cost) ?? num(o.realized_profit_cost) ?? 0,
    buy: num(o.buy),
    sell: num(o.sell)
  }
}

/** market/rank: { rank: [...] } */
export function parseTrending(d: unknown, max = 15): DashTrend[] {
  const u = unwrap(d)
  const list = isObj(u) && Array.isArray(u.rank) ? u.rank : Array.isArray(u) ? u : []
  const out: DashTrend[] = []
  for (const r of list) {
    if (!isObj(r)) continue
    const address = str(r.address)
    const symbol = str(r.symbol)
    if (!address || !symbol) continue
    // price_change_percent bazen oran (0.12), bazen yüzde (12) gelir; belgelerde "%": olduğu gibi alınır
    out.push({
      rank: num(r.rank) ?? out.length + 1,
      address,
      symbol,
      name: str(r.name),
      logo: str(r.logo),
      price: num(r.price),
      marketCap: num(r.market_cap),
      liquidity: num(r.liquidity),
      volume: num(r.volume),
      swaps: num(r.swaps),
      holders: num(r.holder_count),
      change: num(r.price_change_percent),
      launchpad: str(r.launchpad_platform)
    })
    if (out.length >= max) break
  }
  return out
}
