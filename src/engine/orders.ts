import type { EngineContext } from './context'
import * as trade from './gmgn/trade'
import { summarizeToken } from '../shared/safety'
import type { Rule } from '../shared/rules'
import { presetFromRow, resolvePreset, type FeePresetRow, type PresetKind, type PresetSlot } from '../shared/settings'
import type { BuyRequest, ExecParams, GmgnResult, SellRequest } from '../shared/types'
import { startOfDay } from './time'

// Emir motoru. Arayüz (ya da otomatik mod) "created" durumunda bir niyet yazar; motor:
//  1) Emri koşullu güncellemeyle üstlenir (created → sending): iki motor/iki yoklama tek emir işler
//  2) Rol, kill switch, mod, tutar, günlük ve açık pozisyon limitlerini TAZE veriyle kontrol eder
//  3) Ücret, slippage ve TP/SL'yi kullanıcının kuralından kendisi hesaplar (arayüzden gelene güvenmez)
//  4) GMGN'e gönderir; "confirmed" görülene kadar pozisyon açmaz
//  5) Başarısız emir otomatik tekrar denenmez. Motor gönderim sırasında durursa emir başarısız işaretlenir.

const LAMPORTS = 1e9
export const OPEN_STATUSES = ['submitted', 'pending', 'processed'] as const
const LIVE_STATUSES = ['created', 'sending', ...OPEN_STATUSES] as const
const TRACK_MAX = 60 // ~3 dakika
const STALE_CREATED_MS = 60_000 // bu kadar bekleyen niyet artık güncel değil (fiyat değişmiş olabilir)

export const ORDER_COLS =
  'id, user_id, idempotency_key, side, mint, wallet, amount_in, status, is_dry_run, gmgn_order_id, position_id, sell_percent, symbol, candidate_id, preset, created_at'

type OrderStatus = 'created' | 'sending' | 'submitted' | 'pending' | 'processed' | 'confirmed' | 'failed' | 'expired'

export interface OrderRow {
  id: string
  user_id: string
  idempotency_key: string
  side: 'buy' | 'sell'
  mint: string
  wallet: string | null
  amount_in: string
  status: OrderStatus
  is_dry_run: boolean
  gmgn_order_id: string | null
  position_id: string | null
  sell_percent: number | null
  symbol: string | null
  candidate_id: string | null
  preset: number | null
  created_at: string
}

type Obj = Record<string, unknown>
const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Obj)[k] : undefined)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)

export function normStatus(s: unknown): OrderStatus | undefined {
  const v = String(s ?? '').toLowerCase()
  if (v === 'confirmed' || v === 'successful' || v === 'success') return 'confirmed'
  if (v === 'failed' || v === 'fail') return 'failed'
  if (v === 'expired') return 'expired'
  if (v === 'processed') return 'processed'
  if (v === 'pending') return 'pending'
  return undefined
}

// Ücretler emrin preset'inden (P1–P3); preset kaydı yoksa kuraldaki eski tek ücret seti
export async function execParams(ctx: EngineContext, userId: string, rule: Rule, kind: PresetKind, slot?: number | null): Promise<ExecParams & { preset: PresetSlot }> {
  const s = (slot && slot >= 1 && slot <= 3 ? slot : rule.limits.activePreset) as PresetSlot
  const { data } = await ctx.db.from('fee_presets').select('slot, kind, priority_sol, tip_sol, slippage, anti_mev').eq('user_id', userId)
  const p = resolvePreset(((data as FeePresetRow[]) ?? []).map(presetFromRow), s, kind, rule.limits)
  return { dryRun: !rule.limits.liveTrading, slippage: p.slippage, priorityFeeSol: p.priorityFeeSol, tipFeeSol: p.tipFeeSol, antiMev: p.antiMev, preset: s }
}

const now = () => new Date().toISOString()

export class OrderEngine {
  private tracking = new Set<string>()
  private busy = new Set<string>()

  constructor(private readonly ctx: EngineContext) {}

  /** Bekleyen "created" emirleri işler (gerçek zamanlı bildirim ve yedek yoklama buraya gelir). */
  async processCreated(): Promise<void> {
    const { data, error } = await this.ctx.db.from('orders').select(ORDER_COLS).eq('status', 'created').order('created_at').limit(20)
    if (error) return this.ctx.log.warn('emir listesi alınamadı', { error: error.message })
    for (const o of (data as OrderRow[]) ?? []) await this.execute(o)
  }

  /** Açılışta: yarım kalan emirler. 'sending' → başarısız (tekrar yok), açık olanlar takibe. */
  async recover(): Promise<void> {
    const db = this.ctx.db
    const { data: stuck } = await db
      .from('orders')
      .update({ status: 'failed', error_code: 'Motor gönderim sırasında durdu — GMGN/Solscan üzerinden kontrol edin', updated_at: now() })
      .eq('status', 'sending')
      .select('id, user_id, mint')
    for (const o of (stuck as { id: string; user_id: string; mint: string }[]) ?? []) {
      await this.ctx.audit(o.user_id, 'order.interrupted', { order: o.id, mint: o.mint })
    }
    const { data: open } = await db
      .from('orders')
      .select(ORDER_COLS)
      .eq('is_dry_run', false)
      .in('status', [...OPEN_STATUSES])
      .not('gmgn_order_id', 'is', null)
    for (const o of (open as OrderRow[]) ?? []) void this.track(o)
  }

  async execute(order: OrderRow): Promise<void> {
    if (this.busy.has(order.id)) return
    this.busy.add(order.id)
    try {
      const { data: won } = await this.ctx.db
        .from('orders')
        .update({ status: 'sending', updated_at: now() })
        .eq('id', order.id)
        .eq('status', 'created')
        .select(ORDER_COLS)
      const row = (won as OrderRow[] | null)?.[0]
      if (!row) return // başka bir yoklama ya da motor üstlendi
      if (Date.now() - new Date(row.created_at).getTime() > STALE_CREATED_MS) {
        return void (await this.fail(row, 'Emir zamanında işlenemedi (motor kapalıydı) — yeniden deneyin'))
      }
      const err = row.side === 'buy' ? await this.runBuy(row) : await this.runSell(row)
      if (err) await this.fail(row, err)
    } catch (e) {
      this.ctx.log.error('emir hatası', { order: order.id, error: (e as Error).message })
      await this.fail(order, `Motor hatası: ${(e as Error).message}`)
    } finally {
      this.busy.delete(order.id)
    }
  }

  private async fail(order: Pick<OrderRow, 'id'>, error: string) {
    await this.ctx.db
      .from('orders')
      .update({ status: 'failed', error_code: error, updated_at: now() })
      .eq('id', order.id)
      .in('status', ['created', 'sending'])
  }

  // ------------------------------------------------------------------ alım
  private async runBuy(order: OrderRow): Promise<string | null> {
    const ctx = this.ctx
    const { rule, canTrade } = await ctx.users.fresh(order.user_id)
    if (!canTrade) return 'Bu rol işlem yapamaz'
    if (await ctx.killSwitch()) return 'İşlemler founder tarafından durduruldu'
    const live = rule.limits.liveTrading
    if (order.is_dry_run === live) return live ? 'Gerçek moddasınız; deneme emri reddedildi' : 'Deneme modundasınız; gerçek emir reddedildi'

    const amountSol = Number(order.amount_in) / LAMPORTS
    if (!/^\d+$/.test(order.amount_in) || !(amountSol > 0)) return 'Geçersiz tutar'
    if (amountSol > rule.limits.maxBuySol + 1e-9) return `Tutar en fazla ${rule.limits.maxBuySol} SOL olabilir`
    if (amountSol > trade.HARD_MAX_BUY_SOL) return `Tek emirde en fazla ${trade.HARD_MAX_BUY_SOL} SOL`

    const g = ctx.gmgn(order.user_id)
    if (!g) return 'GMGN anahtarı girilmemiş (Ayarlar)'
    if (!g.secret.wallet) return 'İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)'

    // Açık pozisyon limiti ve aynı token için tek pozisyon (aynı mod içinde)
    const { data: open } = await ctx.db
      .from('positions')
      .select('mint')
      .eq('user_id', order.user_id)
      .eq('status', 'open')
      .eq('is_dry_run', !live)
    if ((open ?? []).some((p) => p.mint === order.mint)) return 'Bu token için zaten açık pozisyon var'
    if ((open ?? []).length >= rule.limits.maxOpenPositions) return `Açık pozisyon sınırı (${rule.limits.maxOpenPositions}) dolu`

    // Günlük harcama limiti (bugün yoldaki ve gerçekleşen alımlar, bu emir hariç)
    const { data: spent } = await ctx.db
      .from('orders')
      .select('id, amount_in')
      .eq('user_id', order.user_id)
      .eq('side', 'buy')
      .eq('is_dry_run', !live)
      .in('status', [...LIVE_STATUSES, 'confirmed'])
      .gte('created_at', startOfDay(ctx.timeZone).toISOString())
    const spentSol = ((spent as { id: string; amount_in: string }[]) ?? [])
      .filter((o) => o.id !== order.id)
      .reduce((a, o) => a + Number(o.amount_in) / LAMPORTS, 0)
    if (spentSol + amountSol > rule.limits.dailyMaxSol + 1e-9) {
      return `Günlük limit: bugün ${spentSol.toFixed(3)} SOL harcandı, sınır ${rule.limits.dailyMaxSol} SOL`
    }

    const { preset, ...fees } = await execParams(ctx, order.user_id, rule, 'buy', order.preset)
    const params: BuyRequest = { ...fees, mint: order.mint, amountSol, conditionOrders: live ? rule.tpSl : [] }
    await ctx.db.from('orders').update({ wallet: g.secret.wallet, request: params, preset }).eq('id', order.id)
    await ctx.audit(order.user_id, live ? 'order.buy' : 'order.buy_dry', { mint: order.mint, amountSol, preset })
    const res = await trade.buy(g.client, g.secret.wallet, params)
    return this.afterSend({ ...order, wallet: g.secret.wallet }, res)
  }

  // ------------------------------------------------------------------ satım (kill switch açıkken de serbest)
  private async runSell(order: OrderRow): Promise<string | null> {
    const ctx = this.ctx
    const { rule, canTrade } = await ctx.users.fresh(order.user_id)
    if (!canTrade) return 'Bu rol işlem yapamaz'
    if (!order.position_id) return 'Pozisyon belirtilmemiş'
    const percent = Number(order.sell_percent)
    if (!(percent > 0 && percent <= 100)) return 'Satış yüzdesi 1–100 olmalı'

    const { data: pos } = await ctx.db
      .from('positions')
      .select('id, user_id, mint, amount_raw, is_dry_run, status')
      .eq('id', order.position_id)
      .maybeSingle()
    const p = pos as { id: string; user_id: string; mint: string; amount_raw: string | null; is_dry_run: boolean; status: string } | null
    if (!p || p.user_id !== order.user_id) return 'Pozisyon bulunamadı'
    if (p.status !== 'open') return 'Pozisyon zaten kapalı'
    if (p.mint !== order.mint || p.is_dry_run !== order.is_dry_run) return 'Emir pozisyonla uyuşmuyor'

    const { data: other } = await ctx.db
      .from('orders')
      .select('id')
      .eq('position_id', p.id)
      .eq('side', 'sell')
      .in('status', [...LIVE_STATUSES])
      .neq('id', order.id)
    if (other?.length) return 'Bu pozisyon için satış zaten yolda'

    const g = ctx.gmgn(order.user_id)
    if (!g) return 'GMGN anahtarı girilmemiş (Ayarlar)'
    if (!g.secret.wallet) return 'İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)'

    const { preset, ...fees } = await execParams(ctx, order.user_id, rule, 'sell', order.preset)
    const params: SellRequest = { ...fees, dryRun: p.is_dry_run, mint: p.mint, percent, amountRaw: p.amount_raw ?? undefined }
    await ctx.db.from('orders').update({ wallet: g.secret.wallet, request: params, amount_in: p.amount_raw ?? '0', preset }).eq('id', order.id)
    await ctx.audit(order.user_id, p.is_dry_run ? 'order.sell_dry' : 'order.sell', { mint: p.mint, percent })
    const res = await trade.sell(g.client, g.secret.wallet, params)
    return this.afterSend({ ...order, wallet: g.secret.wallet }, res)
  }

  private async afterSend(order: OrderRow, res: GmgnResult): Promise<string | null> {
    if (!res.ok) return res.error
    if (order.is_dry_run) {
      // Deneme: GMGN teklifi gerçekleşmiş sayılır
      await this.finalize(order, 'confirmed', { report: res.data, dry_run: true }, ['sending'])
      return null
    }
    const gmgnId = get(res.data, 'order_id')
    const st = normStatus(get(res.data, 'status')) ?? 'pending'
    const submitted: OrderRow = { ...order, gmgn_order_id: gmgnId ? String(gmgnId) : null, status: 'submitted' }
    await this.ctx.db
      .from('orders')
      .update({
        status: 'submitted',
        gmgn_order_id: submitted.gmgn_order_id,
        tx_hash: (get(res.data, 'hash') as string) || null,
        updated_at: now()
      })
      .eq('id', order.id)
      .eq('status', 'sending')
    if (st === 'confirmed' || st === 'failed' || st === 'expired') await this.finalize(submitted, st, res.data)
    else if (!submitted.gmgn_order_id) {
      // Takip edilemez: kullanıcı GMGN/Solscan'den kontrol etmeli, otomatik tekrar YOK
      await this.ctx.db.from('orders').update({ error_code: 'GMGN emir kimliği dönmedi — GMGN üzerinden kontrol edin' }).eq('id', order.id)
    } else void this.track(submitted)
    return null
  }

  // GMGN'de emir durumunu "kesin" olana kadar izle
  private async track(order: OrderRow): Promise<void> {
    if (!order.gmgn_order_id || this.tracking.has(order.id)) return
    this.tracking.add(order.id)
    try {
      for (let i = 0; i < TRACK_MAX; i++) {
        await new Promise((r) => setTimeout(r, this.ctx.trackOrderMs))
        const g = this.ctx.gmgn(order.user_id)
        if (!g) return
        const res = await trade.queryOrder(g.client, order.gmgn_order_id)
        if (!res.ok) continue
        const st = normStatus(get(res.data, 'status'))
        if (st === 'confirmed' || st === 'failed' || st === 'expired') return void (await this.finalize(order, st, res.data))
        if (st && st !== order.status) {
          await this.ctx.db.from('orders').update({ status: st, updated_at: now() }).eq('id', order.id).in('status', [...OPEN_STATUSES])
        }
      }
    } finally {
      this.tracking.delete(order.id)
    }
  }

  // Emir sonucu → pozisyon. Sadece durumu "açık"tan "kesin"e çeviren yan etkiyi uygular.
  private async finalize(order: OrderRow, status: OrderStatus, data: unknown, from: string[] = [...OPEN_STATUSES]): Promise<void> {
    const db = this.ctx.db
    const report = get(data, 'report') ?? data
    const patch: Obj = { status, updated_at: now(), report: data ?? null }
    const hash = get(data, 'hash')
    if (typeof hash === 'string' && hash) patch.tx_hash = hash
    if (status === 'failed' || status === 'expired') patch.error_code = String(get(data, 'error_code') ?? get(data, 'error_status') ?? status)

    const { data: won } = await db.from('orders').update(patch).eq('id', order.id).in('status', from).select('id')
    if (!won?.length || status !== 'confirmed') return

    if (order.side === 'buy') {
      const outRaw = String(get(report, 'output_amount') ?? '')
      let price = num(get(report, 'price_usd'))
      let decimals = num(get(report, 'output_token_decimals'))
      let mcap: number | undefined
      if (price === undefined || decimals === undefined || order.is_dry_run) {
        const client = this.ctx.gmgnRead(order.user_id)
        const info = client ? await client.tokenInfo(order.mint) : null
        if (info?.ok) {
          const s = summarizeToken(info.data)
          price = price ?? s.priceUsd
          mcap = s.mcapUsd
          decimals = decimals ?? num(get(info.data, 'decimals'))
        }
      }
      const { error } = await db.from('positions').insert({
        user_id: order.user_id,
        mint: order.mint,
        symbol: order.symbol,
        wallet: order.wallet ?? '',
        entry_price: price ?? null,
        entry_mcap: mcap ?? null,
        amount_raw: /^\d+$/.test(outRaw) ? outRaw : null,
        amount_initial_raw: /^\d+$/.test(outRaw) ? outRaw : null,
        decimals: decimals ?? null,
        cost_sol: Number(order.amount_in) / LAMPORTS,
        is_dry_run: order.is_dry_run,
        buy_order_id: order.id,
        last_price_usd: price ?? null,
        price_at: price !== undefined ? now() : null
      })
      if (error && error.code !== '23505') this.ctx.log.error('pozisyon açılamadı', { order: order.id, error: error.message })
    } else if (order.position_id) {
      const { data: pos } = await db.from('positions').select('amount_raw, proceeds_sol').eq('id', order.position_id).single()
      const soldRaw = String(get(report, 'input_amount') ?? '')
      const outSol = (num(get(report, 'output_amount')) ?? 0) / LAMPORTS
      let remaining: string | null = pos?.amount_raw ?? null
      if (remaining && /^\d+$/.test(remaining) && /^\d+$/.test(soldRaw)) {
        const r = BigInt(remaining) - BigInt(soldRaw)
        remaining = (r > 0n ? r : 0n).toString()
      }
      const closed = (order.sell_percent ?? 0) >= 100 || remaining === '0'
      await db
        .from('positions')
        .update({
          amount_raw: remaining,
          proceeds_sol: (Number(pos?.proceeds_sol) || 0) + outSol,
          ...(closed ? { status: 'closed', closed_at: now(), close_reason: order.idempotency_key.startsWith('panic:') ? 'panic' : 'manual' } : {})
        })
        .eq('id', order.position_id)
    }
  }

  /** Bir kullanıcının açık tüm pozisyonları için %100 satış niyeti (kill switch açıkken de). */
  async sellAll(userId: string): Promise<{ orders: number; errors: string[] }> {
    const { data } = await this.ctx.db
      .from('positions')
      .select('id, mint, symbol, amount_raw, is_dry_run')
      .eq('user_id', userId)
      .eq('status', 'open')
    const errors: string[] = []
    let orders = 0
    const bucket = Math.floor(Date.now() / 10_000)
    for (const p of (data as { id: string; mint: string; symbol: string | null; amount_raw: string | null; is_dry_run: boolean }[]) ?? []) {
      const { data: row, error } = await this.ctx.db
        .from('orders')
        .insert({
          user_id: userId,
          idempotency_key: `panic:${p.id}:${bucket}`,
          side: 'sell',
          mint: p.mint,
          amount_in: p.amount_raw ?? '0',
          is_dry_run: p.is_dry_run,
          position_id: p.id,
          sell_percent: 100,
          symbol: p.symbol
        })
        .select(ORDER_COLS)
        .single()
      if (error) {
        errors.push(`${p.symbol ?? p.mint.slice(0, 6)}: ${error.code === '23505' ? 'satış zaten gönderildi' : error.message}`)
        continue
      }
      orders++
      await this.execute(row as OrderRow)
      const { data: after } = await this.ctx.db.from('orders').select('status, error_code').eq('id', (row as OrderRow).id).single()
      if (after?.status === 'failed') errors.push(`${p.symbol ?? p.mint.slice(0, 6)}: ${after.error_code}`)
    }
    await this.ctx.audit(userId, 'positions.sell_all', { count: data?.length ?? 0, errors })
    return { orders, errors }
  }
}
