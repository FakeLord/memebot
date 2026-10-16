import { GmgnClient } from './client'
import { loadGmgnCredentials } from '../secrets'
import { isLikelyMint, SOL_MINT } from '../../shared/extract'
import type { BuyRequest, GmgnResult, HoldingInfo, SellRequest, SwapParams, WalletInfo } from '../../shared/types'

// Alım-satımın son savunma hattı. Arayüz kuralları (limitler, onay) zaten uyguladı;
// burada sadece "ne olursa olsun" geçerli kurallar var.

export const HARD_MAX_BUY_SOL = 5 // tek emirde mutlak üst sınır
const LAMPORTS = 1_000_000_000

const fail = (error: string): GmgnResult => ({ ok: false, status: 0, error })

function ready(userId: string): { client: GmgnClient; wallet: string } | string {
  const creds = loadGmgnCredentials(userId)
  if (!creds) return 'GMGN anahtarı girilmemiş (Ayarlar)'
  if (!creds.wallet) return 'İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)'
  return { client: new GmgnClient(creds), wallet: creds.wallet }
}

function feeParams(r: { slippage: number | 'auto'; priorityFeeSol: number; tipFeeSol: number; antiMev: boolean }) {
  return {
    ...(r.slippage === 'auto' ? { auto_slippage: true } : { slippage: Math.round(Math.min(100, Math.max(1, r.slippage))) }),
    is_anti_mev: r.antiMev,
    // GMGN SOL'de en az 0.00001 ister; TP/SL koşullu emirlerde ikisi zorunlu
    priority_fee: String(Math.max(0.00001, r.priorityFeeSol)),
    tip_fee: String(Math.max(0.00001, r.tipFeeSol))
  }
}

export function lamports(sol: number): string {
  return String(Math.round(sol * LAMPORTS))
}

export async function buy(userId: string, r: BuyRequest): Promise<GmgnResult> {
  if (!isLikelyMint(r.mint)) return fail('Geçersiz token adresi')
  if (!(r.amountSol > 0) || r.amountSol > HARD_MAX_BUY_SOL) return fail(`Tutar 0 ile ${HARD_MAX_BUY_SOL} SOL arasında olmalı`)
  const ctx = ready(userId)
  if (typeof ctx === 'string') return fail(ctx)

  if (r.dryRun) {
    const slippage = r.slippage === 'auto' ? 30 : r.slippage
    return ctx.client.quote({
      chain: 'sol',
      from_address: ctx.wallet,
      input_token: SOL_MINT,
      output_token: r.mint,
      input_amount: lamports(r.amountSol),
      slippage
    })
  }

  const params: SwapParams = {
    chain: 'sol',
    from_address: ctx.wallet,
    input_token: SOL_MINT,
    output_token: r.mint,
    input_amount: lamports(r.amountSol),
    ...feeParams(r)
  }
  if (r.conditionOrders.length) {
    params.condition_orders = r.conditionOrders.slice(0, 10)
    params.sell_ratio_type = 'hold_amount'
  }
  return ctx.client.swap(params)
}

export async function sell(userId: string, r: SellRequest): Promise<GmgnResult> {
  if (!isLikelyMint(r.mint)) return fail('Geçersiz token adresi')
  if (!(r.percent > 0 && r.percent <= 100)) return fail('Satış yüzdesi 1–100 olmalı')
  const ctx = ready(userId)
  if (typeof ctx === 'string') return fail(ctx)

  if (r.dryRun) {
    if (!r.amountRaw || !/^\d+$/.test(r.amountRaw)) return fail('Deneme satışı için miktar bilinmiyor')
    const amount = (BigInt(r.amountRaw) * BigInt(Math.round(r.percent * 100))) / 10_000n
    return ctx.client.quote({
      chain: 'sol',
      from_address: ctx.wallet,
      input_token: r.mint,
      output_token: SOL_MINT,
      input_amount: amount.toString(),
      slippage: r.slippage === 'auto' ? 30 : r.slippage
    })
  }

  // Yüzdeyle satış: input_amount "0" + input_amount_bps (5000 = %50) — resmi CLI ile aynı
  return ctx.client.swap({
    chain: 'sol',
    from_address: ctx.wallet,
    input_token: r.mint,
    output_token: SOL_MINT,
    input_amount: '0',
    input_amount_bps: String(Math.round(r.percent * 100)),
    ...feeParams(r)
  })
}

export async function queryOrder(userId: string, orderId: string): Promise<GmgnResult> {
  const ctx = ready(userId)
  if (typeof ctx === 'string') return fail(ctx)
  if (!/^[\w-]{1,128}$/.test(orderId)) return fail('Geçersiz emir kimliği')
  return ctx.client.queryOrder(orderId)
}

// Cüzdandaki token'lar: { list: [{ token: { token_address, price }, balance }], next }
// (bazı sürümlerde gövde { data: … } ile sarılı). complete=false ise liste eksik olabilir.
export async function holdings(
  userId: string
): Promise<{ ok: true; items: HoldingInfo[]; complete: boolean } | { ok: false; error: string }> {
  const ctx = ready(userId)
  if (typeof ctx === 'string') return { ok: false, error: ctx }
  const items: HoldingInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 3; page++) {
    const res = await ctx.client.walletHoldings(ctx.wallet, cursor)
    if (!res.ok) return { ok: false, error: res.error }
    const body = (res.data && typeof res.data === 'object' && 'data' in (res.data as object) ? (res.data as { data: unknown }).data : res.data) as {
      list?: unknown[]
      next?: unknown
    }
    for (const row of body?.list ?? []) {
      const r = row as { token?: { token_address?: string; price?: unknown }; balance?: unknown }
      const mint = r.token?.token_address
      if (!mint || !isLikelyMint(mint)) continue
      const balance = Number(r.balance)
      const price = Number(r.token?.price)
      items.push({ mint, balance: Number.isFinite(balance) ? balance : 0, priceUsd: Number.isFinite(price) ? price : undefined })
    }
    cursor = typeof body?.next === 'string' && body.next ? body.next : undefined
    if (!cursor) return { ok: true, items, complete: true }
  }
  return { ok: true, items, complete: false }
}

// /v1/user/info yanıt şeması belgelenmemiş: içindeki Solana adreslerini toplarız.
export function extractWallets(data: unknown): WalletInfo[] {
  const out = new Map<string, WalletInfo>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
    const o = v as Record<string, unknown>
    const addr = [o.address, o.wallet_address, o.wallet].find((x) => typeof x === 'string' && isLikelyMint(x as string)) as
      | string
      | undefined
    const chain = typeof o.chain === 'string' ? o.chain : undefined
    if (addr && (!chain || chain === 'sol')) {
      const bal = Number(o.balance ?? o.sol_balance ?? o.native_balance ?? o.amount)
      out.set(addr, { address: addr, balance: Number.isFinite(bal) ? bal : undefined })
    }
    Object.values(o).forEach((x) => walk(x, depth + 1))
  }
  walk(data, 0)
  return [...out.values()]
}

export async function wallets(userId: string): Promise<{ ok: true; wallets: WalletInfo[]; selected?: string } | { ok: false; error: string }> {
  const creds = loadGmgnCredentials(userId)
  if (!creds) return { ok: false, error: 'GMGN anahtarı girilmemiş' }
  const res = await new GmgnClient(creds).userInfo()
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, wallets: extractWallets(res.data), selected: creds.wallet }
}
