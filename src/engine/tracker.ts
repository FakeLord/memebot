import type { EngineContext } from './context'
import * as trade from './gmgn/trade'
import { summarizeToken } from '../shared/safety'
import type { HoldingInfo } from '../shared/types'

// Açık pozisyonların canlı fiyatı + GMGN cüzdanıyla eşitleme (tüm kullanıcılar, 15 sn'de bir).
//  - Gerçek pozisyonlar: tek "wallet_holdings" çağrısı hem fiyatı hem bakiyeyi verir.
//  - Deneme pozisyonları: token başına fiyat sorgusu (düşük öncelikli kuyruk).
//  - GMGN'de TP/SL tetiklenip satış yaptıysa bakiye düşer → pozisyon güncellenir/kapanır.
//    Satıştan gelen SOL bilinmediği için o anki fiyattan TAHMİN edilir ve işaretlenir.

const SYNC_GRACE_MS = 2 * 60_000 // alımdan sonra GMGN'in bakiyeyi görmesi için süre

interface OpenPos {
  id: string
  user_id: string
  mint: string
  amount_raw: string | null
  amount_initial_raw: string | null
  decimals: number | null
  cost_sol: number | null
  entry_price: number | null
  proceeds_sol: number
  is_dry_run: boolean
  opened_at: string
  last_price_usd: number | null
}

export class Tracker {
  private running = false

  constructor(private readonly ctx: EngineContext) {}

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const { data } = await this.ctx.db
        .from('positions')
        .select('id, user_id, mint, amount_raw, amount_initial_raw, decimals, cost_sol, entry_price, proceeds_sol, is_dry_run, opened_at, last_price_usd')
        .eq('status', 'open')
      const byUser = new Map<string, OpenPos[]>()
      for (const p of (data as OpenPos[]) ?? []) byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p])
      for (const [userId, list] of byUser) await this.tickUser(userId, list)
    } catch (e) {
      this.ctx.log.warn('takip turu hatası', { error: (e as Error).message })
    } finally {
      this.running = false
    }
  }

  private async tickUser(userId: string, open: OpenPos[]): Promise<void> {
    const prices: Record<string, number> = {}

    // --- gerçek pozisyonlar: cüzdan bakiyesi + fiyat
    const live = open.filter((p) => !p.is_dry_run)
    const g = this.ctx.gmgn(userId)
    if (live.length && g?.secret.wallet) {
      const h = await trade.holdings(g.client, g.secret.wallet)
      if (!h.ok) this.ctx.state.patch(userId, { pipeline: { lastError: `Bakiye alınamadı: ${h.error}` } })
      else {
        const byMint = new Map<string, HoldingInfo>(h.items.map((i) => [i.mint, i]))
        for (const i of h.items) if (i.priceUsd !== undefined) prices[i.mint] = i.priceUsd
        if (this.ctx.users.canTrade(userId)) await this.syncLive(userId, live, byMint, h.complete, prices)
      }
    }

    // --- fiyatı hâlâ bilinmeyenler (deneme pozisyonları vb.)
    const client = this.ctx.gmgnRead(userId)
    if (client) {
      const missing = [...new Set(open.map((p) => p.mint))].filter((m) => prices[m] === undefined).slice(0, 10)
      for (const mint of missing) {
        const r = await client.tokenPrice(mint)
        if (!r.ok) continue
        const price = summarizeToken(r.data).priceUsd
        if (price !== undefined) prices[mint] = price
      }
    }

    const at = new Date().toISOString()
    for (const p of open) {
      const price = prices[p.mint]
      if (price === undefined || price === Number(p.last_price_usd)) continue
      await this.ctx.db.from('positions').update({ last_price_usd: price, price_at: at }).eq('id', p.id).eq('status', 'open')
    }
  }

  private async syncLive(userId: string, live: OpenPos[], byMint: Map<string, HoldingInfo>, complete: boolean, prices: Record<string, number>) {
    const db = this.ctx.db
    // Kendi satış emrimiz yoldaysa o pozisyona dokunma (çift sayım olmasın)
    const { data: selling } = await db
      .from('orders')
      .select('position_id')
      .eq('user_id', userId)
      .eq('side', 'sell')
      .in('status', ['created', 'sending', 'submitted', 'pending', 'processed'])
    const busy = new Set(((selling as { position_id: string | null }[]) ?? []).map((o) => o.position_id))

    for (const p of live) {
      if (busy.has(p.id) || p.decimals == null || !p.amount_raw || !/^\d+$/.test(p.amount_raw)) continue
      if (Date.now() - new Date(p.opened_at).getTime() < SYNC_GRACE_MS) continue
      const hold = byMint.get(p.mint)
      // Listede yoksa: liste tamsa bakiye 0 kabul edilir, eksikse karar verilmez
      if (!hold && !complete) continue
      let heldRaw: bigint
      try {
        heldRaw = hold ? trade.toRaw(hold.balance, p.decimals) : 0n
      } catch {
        continue // beklenmeyen bakiye biçimi (ör. üstel gösterim) — bu turda atla
      }
      const cur = BigInt(p.amount_raw)
      if (heldRaw >= (cur * 99n) / 100n) continue // değişiklik yok (ya da dışarıdan ekleme)

      const initial = p.amount_initial_raw && /^\d+$/.test(p.amount_initial_raw) ? BigInt(p.amount_initial_raw) : cur
      const sold = cur - heldRaw
      const price = hold?.priceUsd ?? prices[p.mint] ?? (p.last_price_usd ? Number(p.last_price_usd) : undefined)
      const est =
        price && p.entry_price && p.cost_sol && initial > 0n
          ? Number(p.cost_sol) * (Number(sold) / Number(initial)) * (price / Number(p.entry_price))
          : 0
      const closed = heldRaw <= initial / 100n
      // Koşullu güncelleme: aynı değişiklik iki kez işlenmesin
      const { data: won } = await db
        .from('positions')
        .update({
          amount_raw: closed ? '0' : heldRaw.toString(),
          proceeds_sol: (Number(p.proceeds_sol) || 0) + est,
          proceeds_estimated: true,
          ...(closed ? { status: 'closed', closed_at: new Date().toISOString(), close_reason: 'gmgn_tpsl' } : {})
        })
        .eq('id', p.id)
        .eq('amount_raw', p.amount_raw)
        .select('id')
      if (!won?.length) continue
      await this.ctx.audit(userId, closed ? 'position.closed_by_gmgn' : 'position.reduced_by_gmgn', {
        mint: p.mint,
        sold: sold.toString(),
        estimated_sol: est
      })
    }
  }
}
