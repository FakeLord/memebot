import { describe, expect, it } from 'vitest'
import { buildDemo } from '../../src/shared/demo'
import { callerLeaderboard, dailySeries, funnel, summarize, topEarners } from '../../src/shared/dashboard'

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime()

describe('demo verisi', () => {
  const d = buildDemo(NOW)

  it('aynı zamanda aynı veri üretir (tekrarlanabilir)', () => {
    expect(buildDemo(NOW).positions.map((p) => p.mint)).toEqual(d.positions.map((p) => p.mint))
  })

  it('pozisyonlar tutarlı: açık/kapalı sayısı, kapanış açılıştan sonra ve gelecekte değil', () => {
    expect(d.positions.filter((p) => p.status === 'open')).toHaveLength(5)
    for (const p of d.positions.filter((x) => x.status === 'closed')) {
      expect(new Date(p.closed_at!).getTime()).toBeGreaterThan(new Date(p.opened_at).getTime())
      expect(new Date(p.closed_at!).getTime()).toBeLessThanOrEqual(NOW)
    }
    // Tüm mint'ler benzersiz ve geçerli uzunlukta
    expect(new Set(d.positions.map((p) => p.mint)).size).toBe(d.positions.length)
    expect(d.positions.every((p) => p.mint.length === 44)).toBe(true)
  })

  it('Dashboard hesapları anlamlı sonuç verir: kâr/zarar, seri, huni, çağrıcılar', () => {
    const now = new Date(NOW)
    const s = summarize(d.positions, 'all', now)
    expect(s.closedCount).toBeGreaterThan(30)
    expect(s.winrate).toBeGreaterThan(0.3)
    expect(s.winrate).toBeLessThan(0.9)
    expect(dailySeries(d.positions, 'all', 30, now)).toHaveLength(30)
    const f = funnel(d.signals, d.candidates, d.orders, 'all', now)
    expect(f.signals).toBeGreaterThan(0)
    const rows = callerLeaderboard(d.positions, d.signals, d.callers, d.sources, 'all', 'month', now)
    expect(rows.length).toBeGreaterThan(3)
    expect(topEarners(rows).length).toBeGreaterThan(0)
    // Engelli kişi (Fatih) için örnek çağrı akışı da var; X sinyalleri kişisiz kalır
    expect(d.signals.some((x) => x.sender_id === null)).toBe(true)
  })

  it('akış kartları ve GMGN verisi dolu', () => {
    expect(d.feed.length).toBeGreaterThanOrEqual(5)
    expect(d.feed.every((c) => c.text && c.tickers.length === 1)).toBe(true)
    expect(d.dash.trending?.items.length).toBe(8)
    expect(d.dash.balance).toBeGreaterThan(0)
    expect(d.pending).toHaveLength(2)
  })
})
