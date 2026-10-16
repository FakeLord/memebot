import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { supabase } from './supabase'
import { canTrade, useAuth } from './auth'
import { usePipeline } from './pipeline'
import { useKillSwitch } from './killswitch'
import { errText, useEngine } from './engine'

// Emir niyeti: arayüz sadece "ne alınacak / ne satılacak" yazar. Limitler, ücretler, TP/SL ve GMGN'e
// gönderim motorda (src/engine/orders.ts). Buradaki kontroller sadece hızlı geri bildirim içindir.

const LAMPORTS = 1e9

export interface PositionRow {
  id: string
  mint: string
  symbol: string | null
  amount_raw: string | null
  cost_sol: number | null
  proceeds_sol: number
  is_dry_run: boolean
  status: 'open' | 'closed'
}

interface OrdersCtx {
  buy: (p: { mint: string; amountSol: number; candidateId?: string; symbol?: string }) => Promise<string | null>
  sell: (position: PositionRow, percent: number) => Promise<string | null>
  sellAll: () => Promise<string[]>
  autoNotice: string | null
}

const Ctx = createContext<OrdersCtx | null>(null)

// Motor emri üstlenip sonuçlandırana kadar bekle (gerçek emirde "gönderildi" de başarıdır)
async function settle(orderId: string, timeoutMs = 25_000): Promise<string | null> {
  const end = Date.now() + timeoutMs
  let wait = 200
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(1_000, wait * 1.4)
    const { data } = await supabase.from('orders').select('status, error_code').eq('id', orderId).single()
    if (!data || data.status === 'created' || data.status === 'sending') continue
    return data.status === 'failed' || data.status === 'expired' ? (data.error_code ?? 'Emir başarısız') : null
  }
  return 'Motor emri zamanında işlemedi — Emirler ekranından durumunu izleyin'
}

export function OrdersProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { rule } = usePipeline()
  const { online, me, run } = useEngine()
  const killSwitch = useKillSwitch()

  const buy = useCallback<OrdersCtx['buy']>(
    async ({ mint, amountSol, candidateId, symbol }) => {
      if (!profile) return 'Oturum yok'
      if (!canTrade(profile.role)) return 'Bu rol işlem yapamaz'
      if (killSwitch) return 'İşlemler founder tarafından durduruldu'
      if (!online) return 'Motor çalışmıyor — işlem yapılamaz'
      if (!(amountSol > 0) || amountSol > rule.limits.maxBuySol) return `Tutar en fazla ${rule.limits.maxBuySol} SOL olabilir`
      const live = rule.limits.liveTrading
      const key = candidateId ? `buy:${candidateId}` : `buy:${mint}:${Math.floor(Date.now() / 15_000)}`
      const { data: row, error } = await supabase
        .from('orders')
        .insert({
          user_id: profile.id,
          idempotency_key: key,
          side: 'buy',
          mint,
          amount_in: String(Math.round(amountSol * LAMPORTS)),
          is_dry_run: !live,
          candidate_id: candidateId ?? null,
          symbol: symbol ?? null
        })
        .select('id')
        .single()
      if (error) return error.code === '23505' ? 'Bu emir zaten gönderildi' : error.message
      return settle(row.id)
    },
    [profile?.id, profile?.role, killSwitch, online, rule]
  )

  const sell = useCallback<OrdersCtx['sell']>(
    async (position, percent) => {
      if (!profile) return 'Oturum yok'
      if (!canTrade(profile.role)) return 'Bu rol işlem yapamaz'
      if (!online) return 'Motor çalışmıyor — işlem yapılamaz'
      // Satış kill switch açıkken de serbest: risk azaltır
      const key = `sell:${position.id}:${percent}:${Math.floor(Date.now() / 10_000)}`
      const { data: row, error } = await supabase
        .from('orders')
        .insert({
          user_id: profile.id,
          idempotency_key: key,
          side: 'sell',
          mint: position.mint,
          amount_in: position.amount_raw ?? '0',
          is_dry_run: position.is_dry_run,
          position_id: position.id,
          sell_percent: percent,
          symbol: position.symbol
        })
        .select('id')
        .single()
      if (error) return error.code === '23505' ? 'Bu satış zaten gönderildi' : error.message
      return settle(row.id)
    },
    [profile?.id, profile?.role, online]
  )

  const sellAll = useCallback(async () => {
    if (!online) return ['Motor çalışmıyor — işlem yapılamaz']
    try {
      const r = await run('positions.sell_all', {}, 60_000)
      return r.errors
    } catch (e) {
      return [errText(e)]
    }
  }, [online, run])

  return <Ctx.Provider value={{ buy, sell, sellAll, autoNotice: me?.notice ?? null }}>{children}</Ctx.Provider>
}

export function useOrders(): OrdersCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOrders OrdersProvider dışında kullanıldı')
  return c
}
