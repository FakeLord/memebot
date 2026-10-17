import { describe, expect, it } from 'vitest'
import {
  dailySeries,
  funnel,
  heldValueSol,
  positionPnl,
  sourcePerformance,
  spentToday,
  summarize,
  type DCandidate,
  type DOrder,
  type DPosition,
  type DSignal,
  type DSource
} from '../../src/shared/dashboard'
import { num, parseTrending, parseWalletProfit, parseWalletStats } from '../../src/engine/gmgn/dash'

const NOW = new Date(2026, 9, 17, 15, 0, 0) // 17 Ekim 2026 15:00 yerel
const at = (daysBack: number, h = 12) => new Date(2026, 9, 17 - daysBack, h, 0, 0).toISOString()

let id = 0
const pos = (o: Partial<DPosition>): DPosition => ({
  id: `p${++id}`, mint: `M${id}`, symbol: 'TST', status: 'closed', is_dry_run: false, cost_sol: 1, proceeds_sol: 1,
  amount_raw: '0', amount_initial_raw: '100', entry_price: 1, last_price_usd: null, opened_at: at(1), closed_at: at(0, 10), ...o
})

describe('pozisyon kâr/zararı', () => {
  it('kapanan: gelen − maliyet', () => {
    expect(positionPnl(pos({ cost_sol: 0.5, proceeds_sol: 0.8 }))).toBeCloseTo(0.3)
    expect(positionPnl(pos({ cost_sol: 1, proceeds_sol: 0.25 }))).toBeCloseTo(-0.75)
  })
  it('açık: kalan oran × maliyet × fiyat oranı + gelen − maliyet', () => {
    // yarısı satılmış (gelen 0.6), kalan yarının fiyatı 3 katına çıkmış → 0.5 × 1 × 3 = 1.5; pnl = 1.5 + 0.6 − 1 = 1.1
    const p = pos({ status: 'open', closed_at: null, amount_raw: '50', amount_initial_raw: '100', proceeds_sol: 0.6, entry_price: 2, last_price_usd: 6 })
    expect(heldValueSol(p)).toBeCloseTo(1.5)
    expect(positionPnl(p)).toBeCloseTo(1.1)
  })
  it('açık ve fiyatı yok: null (zarar sayılmaz)', () => {
    expect(positionPnl(pos({ status: 'open', closed_at: null, last_price_usd: null }))).toBeNull()
  })
})

describe('özet', () => {
  const list = [
    pos({ cost_sol: 1, proceeds_sol: 1.5, closed_at: at(0, 9) }), // bugün +0.5
    pos({ cost_sol: 1, proceeds_sol: 0.4, closed_at: at(0, 11) }), // bugün −0.6
    pos({ cost_sol: 2, proceeds_sol: 3, closed_at: at(3) }), // 3 gün önce +1
    pos({ cost_sol: 1, proceeds_sol: 0, closed_at: at(10) }), // 10 gün önce −1
    pos({ cost_sol: 1, proceeds_sol: 2, closed_at: at(40) }), // 40 gün önce +1
    pos({ cost_sol: 1, proceeds_sol: 1.2, closed_at: at(0, 8), is_dry_run: true }), // deneme +0.2
    pos({ status: 'open', closed_at: null, cost_sol: 1, entry_price: 1, last_price_usd: 2, amount_raw: '100', amount_initial_raw: '100', proceeds_sol: 0 }), // açık +1
    pos({ status: 'open', closed_at: null, cost_sol: 0.5, last_price_usd: null }) // açık, fiyat yok
  ]
  it('gerçek: günler, kazanma oranı ve ortalamalar', () => {
    const s = summarize(list, 'live', NOW)
    expect(s.today).toBeCloseTo(-0.1)
    expect(s.d7).toBeCloseTo(0.9)
    expect(s.d30).toBeCloseTo(-0.1)
    expect(s.allClosed).toBeCloseTo(0.9)
    expect(s.closedCount).toBe(5)
    expect([s.wins, s.losses]).toEqual([3, 2])
    expect(s.winrate).toBeCloseTo(0.6)
    expect(s.avgWin).toBeCloseTo((0.5 + 1 + 1) / 3)
    expect(s.avgLoss).toBeCloseTo((-0.6 - 1) / 2)
    expect(s.bestPnl).toBeCloseTo(1)
    expect(s.worstPnl).toBeCloseTo(-1)
    expect([s.openCount, s.openUnknown, s.openCost]).toEqual([2, 1, 1.5])
    expect(s.openUnrealized).toBeCloseTo(1)
  })
  it('deneme ve tümü ayrı sayılır', () => {
    expect(summarize(list, 'dry', NOW).allClosed).toBeCloseTo(0.2)
    expect(summarize(list, 'all', NOW).allClosed).toBeCloseTo(1.1)
    expect(summarize([], 'all', NOW).winrate).toBeNull()
  })
})

describe('günlük seri', () => {
  it('boş günler 0, birikimli doğru, dönem dışı atlanır', () => {
    const s = dailySeries(
      [pos({ closed_at: at(0), cost_sol: 1, proceeds_sol: 2 }), pos({ closed_at: at(2), cost_sol: 1, proceeds_sol: 0.5 }), pos({ closed_at: at(9) })],
      'live', 3, NOW
    )
    expect(s.map((x) => x.day)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17'])
    expect(s.map((x) => +x.pnl.toFixed(2))).toEqual([-0.5, 0, 1])
    expect(s.map((x) => +x.cum.toFixed(2))).toEqual([-0.5, -0.5, 0.5])
    expect(s.map((x) => x.trades)).toEqual([1, 0, 1])
  })
})

describe('huni ve harcama', () => {
  const signals: DSignal[] = [
    { mint: 'a', source_id: 's1', received_at: at(0, 9) }, { mint: 'b', source_id: 's1', received_at: at(0, 10) }, { mint: 'c', source_id: 's2', received_at: at(1) }
  ]
  const cands: DCandidate[] = [
    { status: 'approved', created_at: at(0, 9) }, { status: 'rejected', created_at: at(0, 10) }, { status: 'expired', created_at: at(0, 11) }, { status: 'approved', created_at: at(1) }
  ]
  const orders: DOrder[] = [
    { side: 'buy', status: 'confirmed', is_dry_run: false, created_at: at(0, 9), amount_in: '500000000' },
    { side: 'buy', status: 'failed', is_dry_run: false, created_at: at(0, 9), amount_in: '700000000' },
    { side: 'buy', status: 'confirmed', is_dry_run: true, created_at: at(0, 9), amount_in: '100000000' },
    { side: 'sell', status: 'confirmed', is_dry_run: false, created_at: at(0, 9), amount_in: '900000000' },
    { side: 'buy', status: 'confirmed', is_dry_run: false, created_at: at(1), amount_in: '300000000' }
  ]
  it('bugünkü huni', () => {
    expect(funnel(signals, cands, orders, 'live', NOW)).toEqual({ signals: 2, candidates: 3, approved: 1, rejected: 1, expired: 1, bought: 1 })
    expect(funnel(signals, cands, orders, 'all', NOW).bought).toBe(2)
  })
  it('harcanan: başarısız ve satış sayılmaz', () => {
    expect(spentToday(orders, 'live', NOW)).toBeCloseTo(0.5)
    expect(spentToday(orders, 'all', NOW)).toBeCloseTo(0.6)
  })
})

describe('kaynak performansı', () => {
  const sources: DSource[] = [
    { id: 's1', title: '@alfa', type: 'x' },
    { id: 's2', title: 'Beta kanalı', type: 'telegram' }
  ]
  const signals: DSignal[] = [
    { mint: 'A', source_id: 's2', received_at: at(5) }, // A'yı önce s2 gördü
    { mint: 'A', source_id: 's1', received_at: at(3, 9) }, // sonra s1 (pozisyondan önce) → s1 sayılır
    { mint: 'B', source_id: 's2', received_at: at(2) },
    { mint: 'C', source_id: 's1', received_at: at(0, 13) } // pozisyondan SONRA geldi → eski sinyal yoksa en erken
  ]
  const positions = [
    pos({ mint: 'A', opened_at: at(3, 10), cost_sol: 1, proceeds_sol: 3 }), // s1 +2
    pos({ mint: 'B', opened_at: at(2, 10), cost_sol: 1, proceeds_sol: 0.5 }), // s2 −0.5
    pos({ mint: 'C', opened_at: at(0, 12), cost_sol: 2, proceeds_sol: 2 }), // s1 (tek sinyal) 0
    pos({ mint: 'X', opened_at: at(1), cost_sol: 1, proceeds_sol: 1.4 }), // sinyal yok → elle +0.4
    pos({ mint: 'A', opened_at: at(60), cost_sol: 1, proceeds_sol: 5 }) // dönem dışı
  ]
  it('en son önceki sinyalin kaynağına yazar; sıralama kâra göre', () => {
    const rows = sourcePerformance(positions, signals, sources, 'live', new Date(2026, 9, 17 - 30).getTime())
    expect(rows.map((r) => r.title)).toEqual(['@alfa', 'Elle / bilinmeyen', 'Beta kanalı'])
    const alfa = rows[0]
    expect([alfa.trades, alfa.closed, alfa.wins]).toEqual([2, 2, 1])
    expect(alfa.pnl).toBeCloseTo(2)
    expect(alfa.roi).toBeCloseTo(2 / 3)
    expect(alfa.winrate).toBeCloseTo(0.5)
    expect(alfa.signals).toBe(2)
    const beta = rows[2]
    expect([beta.trades, beta.signals]).toEqual([1, 2])
    expect(beta.pnl).toBeCloseTo(-0.5)
    expect(rows[1].pnl).toBeCloseTo(0.4)
  })
})

describe('GMGN ayrıştırıcıları', () => {
  it('sayılar metin gelebilir; bozuk değerler tanımsız kalır', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('')).toBeUndefined()
    expect(num('abc')).toBeUndefined()
    expect(num(NaN)).toBeUndefined()
  })
  it('wallet_stats: çıplak nesne, {data} sarmalı ve dizi', () => {
    const raw = { realized_profit: '100.5', unrealized_profit: '5', winrate: 0.62, total_cost: '400', buy_count: 20, sell_count: 15 }
    const want = { realizedProfit: 100.5, unrealizedProfit: 5, winrate: 0.62, totalCost: 400, buyCount: 20, sellCount: 15, pnl: 100.5 / 400 }
    expect(parseWalletStats(raw)).toEqual(want)
    expect(parseWalletStats({ data: raw })).toEqual(want)
    expect(parseWalletStats([raw])).toEqual(want)
    expect(parseWalletStats({})).toBeNull()
    expect(parseWalletStats('x')).toBeNull()
  })
  it('wallet_profits: list[0]', () => {
    expect(parseWalletProfit({ list: [{ realized_profit: '10', unrealized_profit: '2', total_cost: '50', buy: 3, sell: 1 }] })).toEqual({
      realizedProfit: 10, unrealizedProfit: 2, totalProfit: 12, totalCost: 50, buy: 3, sell: 1
    })
    expect(parseWalletProfit({ list: [] })).toBeNull()
  })
  it('market/rank: data.rank; adres ya da sembolü olmayan satır atlanır; üst sınır', () => {
    const items = parseTrending({ rank: [{ rank: 1, address: 'AAA', symbol: 'A', price: '0.1', market_cap: '5000', volume: '99', swaps: 7, holder_count: 3, price_change_percent: '-4.5', launchpad_platform: 'Pump.fun' }, { address: 'B' }, { address: 'CCC', symbol: 'C' }] }, 2)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ rank: 1, address: 'AAA', symbol: 'A', price: 0.1, marketCap: 5000, volume: 99, swaps: 7, holders: 3, change: -4.5, launchpad: 'Pump.fun' })
    expect(items[1].rank).toBe(2)
    expect(parseTrending(null)).toEqual([])
  })
})
