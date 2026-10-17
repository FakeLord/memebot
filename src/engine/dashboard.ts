import type { EngineContext } from './context'
import { extractWallets } from './gmgn/trade'
import { parseTrending, parseWalletProfit, parseWalletStats } from './gmgn/dash'
import type { DashGmgn } from '../shared/engine'
import type { GmgnResult } from '../shared/types'

// Dashboard için GMGN verisi: trend token'lar (dakikada bir), cüzdan bakiyesi ve istatistikleri (5 dakikada bir).
// Hepsi en düşük öncelikli kuyruktan geçer (emir/güvenlik/fiyat işlerini geciktirmez), 429'da tekrar denenmez.
// Sonuç engine_user_state.gmgn.dash alanına yazılır; arayüz gerçek zamanlı okur (migration gerekmez).

const TREND_EVERY_MS = 60_000
const STATS_EVERY_MS = 5 * 60_000
const TREND_INTERVAL = '5m' as const

interface Slot {
  dash: DashGmgn
  trendAt: number
  statsAt: number
}

export class DashboardFeed {
  private slots = new Map<string, Slot>()
  private running = false

  constructor(private readonly ctx: EngineContext) {}

  /** Her 15–20 sn'de çağrılır; kullanıcı başına süresi gelen işleri yapar. */
  async tick(now = Date.now()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const userId of this.ctx.vault.userIds()) {
        if (!this.ctx.users.active(userId)) continue
        const g = this.ctx.gmgn(userId)
        if (!g) {
          this.slots.delete(userId)
          continue
        }
        await this.tickUser(userId, g, now)
      }
    } finally {
      this.running = false
    }
  }

  private async tickUser(userId: string, g: NonNullable<ReturnType<EngineContext['gmgn']>>, now: number): Promise<void> {
    const slot = this.slots.get(userId) ?? { dash: { at: 0 }, trendAt: 0, statsAt: 0 }
    this.slots.set(userId, slot)
    const wallet = g.secret.wallet
    const errors: string[] = []
    let changed = false
    const note = <T>(what: string, r: GmgnResult<T>): T | null => {
      if (r.ok) return r.data
      errors.push(`${what}: ${r.status === 403 ? 'planınızda yok' : r.error}`)
      return null
    }

    if (now - slot.trendAt >= TREND_EVERY_MS) {
      slot.trendAt = now
      const d = note('Trend', await g.client.trending(TREND_INTERVAL, 12))
      if (d !== null) {
        slot.dash.trending = { interval: TREND_INTERVAL, at: now, items: parseTrending(d, 12) }
        changed = true
      }
    }

    if (wallet && now - slot.statsAt >= STATS_EVERY_MS) {
      slot.statsAt = now
      slot.dash.wallet = wallet
      const info = note('Bakiye', await g.client.userInfo())
      if (info !== null) {
        const w = extractWallets(info).find((x) => x.address === wallet)
        if (w?.balance !== undefined) slot.dash.balance = w.balance
        changed = true
      }
      const stats: NonNullable<DashGmgn['stats']> = { ...slot.dash.stats }
      for (const p of ['7d', '30d'] as const) {
        const d = note(`İstatistik ${p}`, await g.client.walletStats(wallet, p))
        const s = d !== null ? parseWalletStats(d) : null
        if (s) {
          stats[p] = s
          changed = true
        }
      }
      slot.dash.stats = stats
      const profits: NonNullable<DashGmgn['profits']> = { ...slot.dash.profits }
      for (const p of ['1d', 'all'] as const) {
        const d = note(`Kâr ${p}`, await g.client.walletProfits(wallet, p))
        const s = d !== null ? parseWalletProfit(d) : null
        if (s) {
          profits[p] = s
          changed = true
        }
      }
      slot.dash.profits = profits
    }

    if (changed || errors.length) {
      if (changed) slot.dash.at = now
      slot.dash.error = errors.length ? errors.join(' · ').slice(0, 300) : null
      this.ctx.state.patch(userId, { gmgn: { dash: slot.dash } })
    }
  }

  /** Anahtar silindi ya da değişti: eski veri gösterilmesin. */
  reset(userId: string): void {
    this.slots.delete(userId)
    this.ctx.state.patch(userId, { gmgn: { dash: undefined } })
  }
}
