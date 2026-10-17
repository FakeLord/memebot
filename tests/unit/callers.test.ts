import { describe, expect, it } from 'vitest'
import { callerLeaderboard, callerSuggestions, topEarners, type DCaller, type DPosition, type DSignal, type DSource } from '../../src/shared/dashboard'

const NOW = new Date(2026, 9, 17, 15, 0, 0) // 17 Ekim 2026 15:00 yerel
const at = (daysBack: number, h = 12) => new Date(2026, 9, 17 - daysBack, h, 0, 0).toISOString()

let id = 0
const pos = (o: Partial<DPosition>): DPosition => ({
  id: `p${++id}`, mint: `M${id}`, symbol: 'TST', status: 'closed', is_dry_run: false, cost_sol: 1, proceeds_sol: 1,
  amount_raw: '0', amount_initial_raw: '100', entry_price: 1, last_price_usd: null, opened_at: at(2), closed_at: at(0, 10), ...o
})
// pozisyondan 1 dk önce gelen sinyal
const sig = (p: DPosition, sender: string | null, source = 'g1'): DSignal => ({
  mint: p.mint, source_id: source, sender_id: sender, received_at: new Date(new Date(p.opened_at).getTime() - 60_000).toISOString()
})

const sources: DSource[] = [{ id: 'g1', title: 'Grup A', type: 'telegram' }, { id: 'g2', title: 'Grup B', type: 'telegram' }]
const callers: DCaller[] = [
  { sender_id: 'alo', name: 'Alo', handle: 'alo', rule: 'normal' },
  { sender_id: 'bob', name: 'Bob', handle: null, rule: 'normal' }
]

describe('çağrıcı tablosu', () => {
  it('kâr/zararı işlemi açan sinyalin göndericisine yazar; gönderensiz işlemler girmez', () => {
    // Alo: +0.5 ve +0.3 (bugün kapandı), Bob: -0.4, gönderensiz kanal sinyali: +9
    const a1 = pos({ cost_sol: 1, proceeds_sol: 1.5 })
    const a2 = pos({ cost_sol: 1, proceeds_sol: 1.3 })
    const b1 = pos({ cost_sol: 1, proceeds_sol: 0.6 })
    const c1 = pos({ cost_sol: 1, proceeds_sol: 10 })
    const signals = [sig(a1, 'alo'), sig(a2, 'alo', 'g2'), sig(b1, 'bob'), sig(c1, null)]
    const rows = callerLeaderboard([a1, a2, b1, c1], signals, callers, sources, 'live', 'day', NOW)
    expect(rows.map((r) => r.senderId)).toEqual(['alo', 'bob'])
    const alo = rows[0]
    expect(alo.pnl).toBeCloseTo(0.8)
    expect(alo.trades).toBe(2)
    expect(alo.wins).toBe(2)
    expect(alo.winrate).toBe(1)
    expect(alo.roi).toBeCloseTo(0.4) // 0.8 / 2
    expect(alo.groups).toEqual(['Grup A', 'Grup B'])
    expect(rows[1].pnl).toBeCloseTo(-0.4)
    expect(rows[1].losses).toBe(1)
    expect(rows[1].handle).toBeNull()
  })

  it('dönem: günlük yalnız bugün kapananlar, haftalık 7 gün, aylık 30 gün', () => {
    const today = pos({ proceeds_sol: 2, closed_at: at(0, 9) }) //  +1
    const three = pos({ proceeds_sol: 1.5, closed_at: at(3) }) //   +0.5
    const twenty = pos({ proceeds_sol: 1.25, closed_at: at(20) }) // +0.25
    const old = pos({ proceeds_sol: 5, closed_at: at(45) }) //      +4 (ay dışı)
    const all = [today, three, twenty, old]
    const signals = all.map((p) => sig(p, 'alo'))
    const pnl = (period: 'day' | 'week' | 'month') => callerLeaderboard(all, signals, callers, sources, 'live', period, NOW)[0]?.pnl
    expect(pnl('day')).toBeCloseTo(1)
    expect(pnl('week')).toBeCloseTo(1.5)
    expect(pnl('month')).toBeCloseTo(1.75)
  })

  it('mod seçimi: deneme ve gerçek ayrı sayılır', () => {
    const live = pos({ proceeds_sol: 2 })
    const dry = pos({ proceeds_sol: 1.5, is_dry_run: true })
    const signals = [sig(live, 'alo'), sig(dry, 'alo')]
    expect(callerLeaderboard([live, dry], signals, callers, sources, 'live', 'day', NOW)[0].pnl).toBeCloseTo(1)
    expect(callerLeaderboard([live, dry], signals, callers, sources, 'dry', 'day', NOW)[0].pnl).toBeCloseTo(0.5)
    expect(callerLeaderboard([live, dry], signals, callers, sources, 'all', 'day', NOW)[0].pnl).toBeCloseTo(1.5)
  })

  it('açık pozisyonlar sayılmaz; en çok kazandıran listesi yalnız kârlıları, en çok 10 tane alır', () => {
    const open = pos({ status: 'open', closed_at: null, proceeds_sol: 0, last_price_usd: 9 })
    const many = Array.from({ length: 12 }, (_, i) => pos({ proceeds_sol: 1 + (i + 1) / 10 }))
    const loser = pos({ proceeds_sol: 0.1 })
    const all = [open, ...many, loser]
    const signals = [sig(open, 'x0'), ...many.map((p, i) => sig(p, `u${i}`)), sig(loser, 'bad')]
    const rows = callerLeaderboard(all, signals, [], sources, 'live', 'day', NOW)
    expect(rows.find((r) => r.senderId === 'x0')).toBeUndefined()
    expect(rows.find((r) => r.senderId === 'bad')?.pnl).toBeCloseTo(-0.9)
    const top = topEarners(rows)
    expect(top).toHaveLength(10)
    expect(top[0].senderId).toBe('u11') // +1.2 SOL
    expect(top.every((r) => r.pnl > 0)).toBe(true)
  })
})

describe('çağrıcı önerileri', () => {
  const run = (wins: number, losses: number, rule: DCaller['rule'] = 'normal') => {
    const ps = [
      ...Array.from({ length: wins }, () => pos({ proceeds_sol: 1.4, closed_at: at(1) })),
      ...Array.from({ length: losses }, () => pos({ proceeds_sol: 0.5, closed_at: at(1) }))
    ]
    return callerSuggestions(ps, ps.map((p) => sig(p, 'alo')), [{ sender_id: 'alo', name: 'Alo', handle: null, rule }], sources, 'live', NOW)
  }
  it('en az 5 işlem ve %60 kazanma + kârda: güvenilir önerilir', () => {
    expect(run(4, 1)).toEqual([expect.objectContaining({ senderId: 'alo', suggest: 'trusted', trades: 5, winrate: 0.8 })])
  })
  it('en az 5 işlem, %30 ve altı kazanma + zararda: engel önerilir', () => {
    expect(run(1, 5)).toEqual([expect.objectContaining({ suggest: 'blocked', trades: 6 })])
  })
  it('az işlem, ara performans ya da kural zaten seçilmişse öneri yok', () => {
    expect(run(3, 0)).toEqual([])
    expect(run(2, 3)).toEqual([])
    expect(run(5, 0, 'trusted')).toEqual([])
    expect(run(0, 6, 'blocked')).toEqual([])
  })
})
