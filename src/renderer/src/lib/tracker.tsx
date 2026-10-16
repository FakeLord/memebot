import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { canTrade, useAuth } from './auth'
import { summarizeToken } from '../../../shared/safety'
import type { HoldingInfo } from '../../../shared/types'

// Açık pozisyonların canlı fiyatı + GMGN cüzdanıyla eşitleme.
//  - Gerçek pozisyonlar: tek "wallet_holdings" çağrısı hem fiyatı hem bakiyeyi verir.
//  - Deneme pozisyonları: token başına fiyat sorgusu (düşük öncelikli kuyruk).
//  - GMGN'de TP/SL tetiklenip satış yaptıysa bakiye düşer → pozisyon güncellenir/kapanır.
//    Satıştan gelen SOL bilinmediği için o anki fiyattan TAHMİN edilir ve işaretlenir.

const TICK_MS = 15_000
const SYNC_GRACE_MS = 2 * 60_000 // alımdan sonra GMGN'in bakiyeyi görmesi için süre

export interface LivePrice {
  priceUsd: number
  at: number
}

interface OpenPos {
  id: string
  mint: string
  amount_raw: string | null
  amount_initial_raw: string | null
  decimals: number | null
  cost_sol: number | null
  entry_price: number | null
  proceeds_sol: number
  is_dry_run: boolean
  opened_at: string
}

interface TrackerCtx {
  prices: Record<string, LivePrice>
  lastError: string | null
}

const Ctx = createContext<TrackerCtx>({ prices: {}, lastError: null })

function toRaw(balance: number, decimals: number): bigint {
  // Okunabilir bakiye → en küçük birim. Üstel gösterim olmadan yazdırıp fazla basamağı KESER (yukarı yuvarlamaz)
  const text = balance.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  const [int, frac = ''] = text.split('.')
  return BigInt(int + frac.padEnd(decimals, '0').slice(0, decimals))
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})
  const [lastError, setLastError] = useState<string | null>(null)
  const running = useRef(false)

  useEffect(() => {
    if (!profile) return
    const tick = async () => {
      if (running.current) return
      running.current = true
      try {
        const { data } = await supabase
          .from('positions')
          .select('id, mint, amount_raw, amount_initial_raw, decimals, cost_sol, entry_price, proceeds_sol, is_dry_run, opened_at')
          .eq('user_id', profile.id)
          .eq('status', 'open')
        const open = (data as OpenPos[]) ?? []
        if (!open.length) return
        const next: Record<string, LivePrice> = {}
        const now = Date.now()

        // --- gerçek pozisyonlar: cüzdan bakiyesi + fiyat
        const live = open.filter((p) => !p.is_dry_run)
        if (live.length) {
          const h = await window.api.trade.holdings(profile.id)
          if (!h.ok) setLastError(`Bakiye alınamadı: ${h.error}`)
          else {
            setLastError(null)
            const byMint = new Map<string, HoldingInfo>(h.items.map((i) => [i.mint, i]))
            for (const i of h.items) if (i.priceUsd !== undefined) next[i.mint] = { priceUsd: i.priceUsd, at: now }
            if (canTrade(profile.role)) await syncLive(live, byMint, h.complete)
          }
        }

        // --- fiyatı hâlâ bilinmeyenler (deneme pozisyonları vb.)
        const missing = [...new Set(open.map((p) => p.mint))].filter((m) => !next[m]).slice(0, 10)
        for (const mint of missing) {
          const r = await window.api.trade.tokenPrice(profile.id, mint)
          if (!r.ok) continue
          const price = summarizeToken(r.data).priceUsd
          if (price !== undefined) next[mint] = { priceUsd: price, at: Date.now() }
        }
        setPrices((prev) => ({ ...prev, ...next }))
      } finally {
        running.current = false
      }
    }

    const syncLive = async (live: OpenPos[], byMint: Map<string, HoldingInfo>, complete: boolean) => {
      // Kendi satış emrimiz yoldaysa o pozisyona dokunma (çift sayım olmasın)
      const { data: selling } = await supabase
        .from('orders')
        .select('position_id')
        .eq('user_id', profile.id)
        .eq('side', 'sell')
        .in('status', ['created', 'submitted', 'pending', 'processed'])
      const busy = new Set(((selling as { position_id: string | null }[]) ?? []).map((o) => o.position_id))

      for (const p of live) {
        if (busy.has(p.id) || p.decimals == null || !p.amount_raw || !/^\d+$/.test(p.amount_raw)) continue
        if (Date.now() - new Date(p.opened_at).getTime() < SYNC_GRACE_MS) continue
        const hold = byMint.get(p.mint)
        // Listede yoksa: liste tamsa bakiye 0 kabul edilir, eksikse karar verilmez
        if (!hold && !complete) continue
        let heldRaw: bigint
        try {
          heldRaw = hold ? toRaw(hold.balance, p.decimals) : 0n
        } catch {
          continue // beklenmeyen bakiye biçimi (ör. üstel gösterim) — bu turda atla
        }
        const cur = BigInt(p.amount_raw)
        if (heldRaw >= (cur * 99n) / 100n) continue // değişiklik yok (ya da dışarıdan ekleme)

        const initial = p.amount_initial_raw && /^\d+$/.test(p.amount_initial_raw) ? BigInt(p.amount_initial_raw) : cur
        const sold = cur - heldRaw
        const price = hold?.priceUsd ?? prices[p.mint]?.priceUsd
        const est =
          price && p.entry_price && p.cost_sol && initial > 0n
            ? Number(p.cost_sol) * (Number(sold) / Number(initial)) * (price / Number(p.entry_price))
            : 0
        const closed = heldRaw <= initial / 100n
        // Koşullu güncelleme: iki bilgisayar aynı değişikliği iki kez işlemesin
        await supabase
          .from('positions')
          .update({
            amount_raw: closed ? '0' : heldRaw.toString(),
            proceeds_sol: (Number(p.proceeds_sol) || 0) + est,
            proceeds_estimated: true,
            ...(closed ? { status: 'closed', closed_at: new Date().toISOString(), close_reason: 'gmgn_tpsl' } : {})
          })
          .eq('id', p.id)
          .eq('amount_raw', p.amount_raw)
        await supabase.from('audit_log').insert({
          action: closed ? 'position.closed_by_gmgn' : 'position.reduced_by_gmgn',
          detail: { mint: p.mint, sold: sold.toString(), estimated_sol: est }
        })
      }
    }

    tick()
    const t = setInterval(tick, TICK_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  return <Ctx.Provider value={{ prices, lastError }}>{children}</Ctx.Provider>
}

export const useTracker = () => useContext(Ctx)
