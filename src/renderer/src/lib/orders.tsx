import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { supabase } from './supabase'
import { canTrade, useAuth } from './auth'
import { usePipeline, type Rule } from './pipeline'
import { useKillSwitch } from './killswitch'
import { summarizeToken } from '../../../shared/safety'
import type { ExecParams, GmgnResult } from '../../../shared/types'

// Emir motoru. Kurallar sırasıyla:
//  1) Kill switch ve rol kontrolü        2) Tutar / günlük / açık pozisyon limitleri
//  3) Emir satırı benzersiz anahtarla yazılır → aynı karar iki emir üretemez
//  4) GMGN'e gönderilir, "confirmed" görülene kadar pozisyon açılmaz
//  5) Uygulama kapanırsa yarım kalan emirler açılışta takip edilmeye devam eder

const LAMPORTS = 1e9
const OPEN = ['submitted', 'pending', 'processed'] as const
const POLL_MS = 3_000
const POLL_MAX = 60 // ~3 dakika
const ORDER_COLS = 'id, side, mint, wallet, amount_in, status, is_dry_run, gmgn_order_id, position_id, sell_percent, symbol, candidate_id'

type OrderStatus = 'created' | 'submitted' | 'pending' | 'processed' | 'confirmed' | 'failed' | 'expired'

interface OrderRow {
  id: string
  side: 'buy' | 'sell'
  mint: string
  wallet: string
  amount_in: string
  status: OrderStatus
  is_dry_run: boolean
  gmgn_order_id: string | null
  position_id: string | null
  sell_percent: number | null
  symbol: string | null
  candidate_id: string | null
}

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

type Obj = Record<string, unknown>
const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Obj)[k] : undefined)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)

function normStatus(s: unknown): OrderStatus | undefined {
  const v = String(s ?? '').toLowerCase()
  if (v === 'confirmed' || v === 'successful' || v === 'success') return 'confirmed'
  if (v === 'failed' || v === 'fail') return 'failed'
  if (v === 'expired') return 'expired'
  if (v === 'processed') return 'processed'
  if (v === 'pending') return 'pending'
  return undefined
}

function exec(rule: Rule): ExecParams {
  const l = rule.limits
  return { dryRun: !l.liveTrading, slippage: l.slippage, priorityFeeSol: l.priorityFeeSol, tipFeeSol: l.tipFeeSol, antiMev: l.antiMev }
}

interface OrdersCtx {
  buy: (p: { mint: string; amountSol: number; candidateId?: string; symbol?: string }) => Promise<string | null>
  sell: (position: PositionRow, percent: number) => Promise<string | null>
}

const Ctx = createContext<OrdersCtx | null>(null)

export function OrdersProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { rule } = usePipeline()
  const killSwitch = useKillSwitch()
  const ruleRef = useRef(rule)
  ruleRef.current = rule
  const tracking = useRef(new Set<string>())

  // --- emir sonucu → pozisyon (sadece durumu "açık"tan "kesin"e çeviren bilgisayar uygular)
  const finalize = useCallback(
    async (order: OrderRow, status: OrderStatus, data: unknown) => {
      const report = get(data, 'report') ?? data
      const patch: Obj = { status, updated_at: new Date().toISOString(), report: data ?? null }
      const hash = get(data, 'hash')
      if (typeof hash === 'string' && hash) patch.tx_hash = hash
      if (status === 'failed' || status === 'expired') patch.error_code = String(get(data, 'error_code') ?? get(data, 'error_status') ?? status)

      const { data: won } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', order.id)
        .in('status', ['created', ...OPEN])
        .select('id')
      if (!won?.length || status !== 'confirmed') return

      if (order.side === 'buy') {
        const outRaw = String(get(report, 'output_amount') ?? '')
        let price = num(get(report, 'price_usd'))
        let mcap: number | undefined
        if (price === undefined || order.is_dry_run) {
          const info = await window.api.gmgn.tokenInfo(profile!.id, order.mint)
          if (info.ok) {
            const s = summarizeToken(info.data)
            price = price ?? s.priceUsd
            mcap = s.mcapUsd
          }
        }
        const { error } = await supabase.from('positions').insert({
          user_id: profile!.id,
          mint: order.mint,
          symbol: order.symbol,
          wallet: order.wallet,
          entry_price: price ?? null,
          entry_mcap: mcap ?? null,
          amount_raw: /^\d+$/.test(outRaw) ? outRaw : null,
          cost_sol: Number(order.amount_in) / LAMPORTS,
          is_dry_run: order.is_dry_run,
          buy_order_id: order.id
        })
        if (error && error.code !== '23505') console.error('position insert', error.message)
      } else if (order.position_id) {
        const { data: pos } = await supabase.from('positions').select('amount_raw, proceeds_sol').eq('id', order.position_id).single()
        const soldRaw = String(get(report, 'input_amount') ?? '')
        const outSol = (num(get(report, 'output_amount')) ?? 0) / LAMPORTS
        let remaining: string | null = pos?.amount_raw ?? null
        if (remaining && /^\d+$/.test(remaining) && /^\d+$/.test(soldRaw)) {
          const r = BigInt(remaining) - BigInt(soldRaw)
          remaining = (r > 0n ? r : 0n).toString()
        }
        const closed = (order.sell_percent ?? 0) >= 100 || remaining === '0'
        await supabase
          .from('positions')
          .update({
            amount_raw: remaining,
            proceeds_sol: (Number(pos?.proceeds_sol) || 0) + outSol,
            ...(closed ? { status: 'closed', closed_at: new Date().toISOString() } : {})
          })
          .eq('id', order.position_id)
      }
    },
    [profile?.id]
  )

  // --- GMGN'de emir durumunu "kesin" olana kadar izle
  const track = useCallback(
    async (order: OrderRow) => {
      if (!profile || !order.gmgn_order_id || tracking.current.has(order.id)) return
      tracking.current.add(order.id)
      try {
        for (let i = 0; i < POLL_MAX; i++) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          const res = await window.api.trade.queryOrder(profile.id, order.gmgn_order_id)
          if (!res.ok) continue
          const st = normStatus(get(res.data, 'status'))
          if (st === 'confirmed' || st === 'failed' || st === 'expired') return finalize(order, st, res.data)
          if (st && st !== order.status) {
            await supabase.from('orders').update({ status: st, updated_at: new Date().toISOString() }).eq('id', order.id).in('status', OPEN)
          }
        }
      } finally {
        tracking.current.delete(order.id)
      }
    },
    [profile?.id, finalize]
  )

  // --- emri gönder (alım ve satım ortak)
  const submit = useCallback(
    async (order: OrderRow, send: () => Promise<GmgnResult>) => {
      const res = await send()
      if (!res.ok) {
        await supabase
          .from('orders')
          .update({ status: 'failed', error_code: res.error, updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .eq('status', 'created')
        return res.error
      }
      if (order.is_dry_run) {
        // Deneme: GMGN teklifi gerçekleşmiş say
        await finalize(order, 'confirmed', { report: res.data, dry_run: true })
        return null
      }
      const gmgnId = get(res.data, 'order_id')
      const st = normStatus(get(res.data, 'status')) ?? 'pending'
      const submitted: OrderRow = { ...order, gmgn_order_id: gmgnId ? String(gmgnId) : null, status: 'submitted' }
      await supabase
        .from('orders')
        .update({
          status: 'submitted',
          gmgn_order_id: submitted.gmgn_order_id,
          tx_hash: (get(res.data, 'hash') as string) || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id)
      if (st === 'confirmed' || st === 'failed' || st === 'expired') await finalize(submitted, st, res.data)
      else if (!submitted.gmgn_order_id) {
        // Takip edilemez: kullanıcı GMGN/Solscan'den kontrol etmeli, otomatik tekrar YOK
        await supabase.from('orders').update({ error_code: 'GMGN emir kimliği dönmedi — GMGN üzerinden kontrol edin' }).eq('id', order.id)
      } else track(submitted)
      return null
    },
    [finalize, track]
  )

  const buy = useCallback<OrdersCtx['buy']>(
    async ({ mint, amountSol, candidateId, symbol }) => {
      if (!profile) return 'Oturum yok'
      if (!canTrade(profile.role)) return 'Bu rol işlem yapamaz'
      if (killSwitch) return 'İşlemler founder tarafından durduruldu'
      const r = ruleRef.current
      const live = r.limits.liveTrading
      if (!(amountSol > 0) || amountSol > r.limits.maxBuySol) return `Tutar en fazla ${r.limits.maxBuySol} SOL olabilir`

      const wallet = await window.api.trade.selectedWallet(profile.id)
      if (!wallet) return 'İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)'

      // Açık pozisyon limiti ve aynı token için tek pozisyon (aynı mod içinde)
      const { data: open } = await supabase
        .from('positions')
        .select('mint')
        .eq('user_id', profile.id)
        .eq('status', 'open')
        .eq('is_dry_run', !live)
      if ((open ?? []).some((p) => p.mint === mint)) return 'Bu token için zaten açık pozisyon var'
      if ((open ?? []).length >= r.limits.maxOpenPositions) return `Açık pozisyon sınırı (${r.limits.maxOpenPositions}) dolu`

      // Günlük harcama limiti (bugün gönderilen/gerçekleşen alımlar)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { data: spent } = await supabase
        .from('orders')
        .select('amount_in')
        .eq('user_id', profile.id)
        .eq('side', 'buy')
        .eq('is_dry_run', !live)
        .in('status', ['created', ...OPEN, 'confirmed'])
        .gte('created_at', today.toISOString())
      const spentSol = (spent ?? []).reduce((a, o) => a + Number(o.amount_in) / LAMPORTS, 0)
      if (spentSol + amountSol > r.limits.dailyMaxSol + 1e-9) {
        return `Günlük limit: bugün ${spentSol.toFixed(3)} SOL harcandı, sınır ${r.limits.dailyMaxSol} SOL`
      }

      const amount_in = String(Math.round(amountSol * LAMPORTS))
      const key = candidateId ? `buy:${candidateId}` : `buy:${mint}:${Math.floor(Date.now() / 15_000)}`
      const params = { ...exec(r), mint, amountSol, conditionOrders: live ? r.tpSl : [] }
      const { data: row, error } = await supabase
        .from('orders')
        .insert({
          user_id: profile.id,
          idempotency_key: key,
          side: 'buy',
          mint,
          wallet,
          amount_in,
          is_dry_run: !live,
          candidate_id: candidateId ?? null,
          symbol: symbol ?? null,
          request: params
        })
        .select(ORDER_COLS)
        .single()
      if (error) return error.code === '23505' ? 'Bu emir zaten gönderildi' : error.message
      await supabase.from('audit_log').insert({ action: live ? 'order.buy' : 'order.buy_dry', detail: { mint, amountSol } })
      return submit(row as OrderRow, () => window.api.trade.buy(profile.id, params))
    },
    [profile?.id, profile?.role, killSwitch, submit]
  )

  const sell = useCallback<OrdersCtx['sell']>(
    async (position, percent) => {
      if (!profile) return 'Oturum yok'
      if (!canTrade(profile.role)) return 'Bu rol işlem yapamaz'
      // Satış kill switch açıkken de serbest: risk azaltır
      const wallet = await window.api.trade.selectedWallet(profile.id)
      if (!wallet) return 'İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)'
      const r = ruleRef.current
      const params = { ...exec(r), dryRun: position.is_dry_run, mint: position.mint, percent, amountRaw: position.amount_raw ?? undefined }
      const key = `sell:${position.id}:${percent}:${Math.floor(Date.now() / 10_000)}`
      const { data: row, error } = await supabase
        .from('orders')
        .insert({
          user_id: profile.id,
          idempotency_key: key,
          side: 'sell',
          mint: position.mint,
          wallet,
          amount_in: position.amount_raw ?? '0',
          is_dry_run: position.is_dry_run,
          position_id: position.id,
          sell_percent: percent,
          symbol: position.symbol,
          request: params
        })
        .select(ORDER_COLS)
        .single()
      if (error) return error.code === '23505' ? 'Bu satış zaten gönderildi' : error.message
      await supabase.from('audit_log').insert({ action: position.is_dry_run ? 'order.sell_dry' : 'order.sell', detail: { mint: position.mint, percent } })
      return submit(row as OrderRow, () => window.api.trade.sell(profile.id, params))
    },
    [profile?.id, profile?.role, submit]
  )

  // --- kurtarma: uygulama kapanırken yarım kalan gerçek emirleri izlemeye devam et
  useEffect(() => {
    if (!profile || !canTrade(profile.role)) return
    supabase
      .from('orders')
      .select(ORDER_COLS)
      .eq('user_id', profile.id)
      .eq('is_dry_run', false)
      .in('status', [...OPEN])
      .not('gmgn_order_id', 'is', null)
      .then(({ data }) => ((data as OrderRow[]) ?? []).forEach((o) => track(o)))
  }, [profile?.id, track])

  return <Ctx.Provider value={{ buy, sell }}>{children}</Ctx.Provider>
}

export function useOrders(): OrdersCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOrders OrdersProvider dışında kullanıldı')
  return c
}
