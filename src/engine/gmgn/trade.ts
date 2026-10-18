import type { GmgnApi } from './client'
import { isLikelyMint, SOL_MINT } from '../../shared/extract'
import type { BuyRequest, GmgnResult, HoldingInfo, SellRequest, SwapParams, WalletInfo } from '../../shared/types'

// Alım-satımın son savunma hattı. Emir motoru limitleri zaten uyguladı;
// burada sadece "ne olursa olsun" geçerli kurallar var.

export const HARD_MAX_BUY_SOL = 5 // tek emirde mutlak üst sınır
const LAMPORTS = 1_000_000_000

const fail = (error: string): GmgnResult => ({ ok: false, status: 0, error })

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

export async function buy(client: GmgnApi, wallet: string, r: BuyRequest): Promise<GmgnResult> {
  if (!isLikelyMint(r.mint)) return fail('Geçersiz token adresi')
  if (!(r.amountSol > 0) || r.amountSol > HARD_MAX_BUY_SOL) return fail(`Tutar 0 ile ${HARD_MAX_BUY_SOL} SOL arasında olmalı`)

  if (r.dryRun) {
    const slippage = r.slippage === 'auto' ? 30 : r.slippage
    return client.quote({
      chain: 'sol',
      from_address: wallet,
      input_token: SOL_MINT,
      output_token: r.mint,
      input_amount: lamports(r.amountSol),
      slippage
    })
  }

  const params: SwapParams = {
    chain: 'sol',
    from_address: wallet,
    input_token: SOL_MINT,
    output_token: r.mint,
    input_amount: lamports(r.amountSol),
    ...feeParams(r)
  }
  if (r.conditionOrders.length) {
    params.condition_orders = r.conditionOrders.slice(0, 10)
    params.sell_ratio_type = 'hold_amount'
  }
  return client.swap(params)
}

export async function sell(client: GmgnApi, wallet: string, r: SellRequest): Promise<GmgnResult> {
  if (!isLikelyMint(r.mint)) return fail('Geçersiz token adresi')
  if (!(r.percent > 0 && r.percent <= 100)) return fail('Satış yüzdesi 1–100 olmalı')

  if (r.dryRun) {
    if (!r.amountRaw || !/^\d+$/.test(r.amountRaw)) return fail('Deneme satışı için miktar bilinmiyor')
    const amount = (BigInt(r.amountRaw) * BigInt(Math.round(r.percent * 100))) / 10_000n
    return client.quote({
      chain: 'sol',
      from_address: wallet,
      input_token: r.mint,
      output_token: SOL_MINT,
      input_amount: amount.toString(),
      slippage: r.slippage === 'auto' ? 30 : r.slippage
    })
  }

  // Yüzdeyle satış: input_amount "0" + input_amount_bps (5000 = %50) — resmi CLI ile aynı
  return client.swap({
    chain: 'sol',
    from_address: wallet,
    input_token: r.mint,
    output_token: SOL_MINT,
    input_amount: '0',
    input_amount_bps: String(Math.round(r.percent * 100)),
    ...feeParams(r)
  })
}

export async function queryOrder(client: GmgnApi, orderId: string): Promise<GmgnResult> {
  if (!/^[\w-]{1,128}$/.test(orderId)) return fail('Geçersiz emir kimliği')
  return client.queryOrder(orderId)
}

// Cüzdandaki token'lar: { list: [{ token: { token_address, price }, balance }], next }
// (bazı sürümlerde gövde { data: … } ile sarılı). complete=false ise liste eksik olabilir.
export async function holdings(
  client: GmgnApi,
  wallet: string
): Promise<{ ok: true; items: HoldingInfo[]; complete: boolean } | { ok: false; error: string }> {
  const items: HoldingInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 3; page++) {
    const res = await client.walletHoldings(wallet, cursor)
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
      // Aynı adres yanıtta birden çok kez geçebilir: bulunan bakiye, bakiyesiz bir tekrarla silinmesin
      const balance = solBalance(o) ?? out.get(addr)?.balance
      out.set(addr, { address: addr, balance })
    }
    Object.values(o).forEach((x) => walk(x, depth + 1))
  }
  walk(data, 0)
  return [...out.values()]
}

const num = (v: unknown): number | undefined => {
  if (typeof v !== 'number' && typeof v !== 'string') return undefined
  if (typeof v === 'string' && !/^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(v)) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const BALANCE_KEYS = ['sol_balance', 'native_balance', 'main_balance', 'main_currency_balance', 'balance', 'amount']
const SOL_SYMBOLS = new Set(['SOL', 'WSOL'])

/** Cüzdan nesnesindeki SOL bakiyesi. Alan adı belgelenmediği için bilinen adlar, "...balance" ile biten alanlar ve
 *  { symbol: 'SOL', balance/amount } biçimli iç içe kayıtlar sırayla denenir. */
function solBalance(o: Record<string, unknown>, depth = 0): number | undefined {
  for (const k of BALANCE_KEYS) {
    const n = num(o[k])
    if (n !== undefined) return n
  }
  for (const [k, v] of Object.entries(o)) {
    if (/balance$/i.test(k) && !/usd/i.test(k)) {
      const n = num(v)
      if (n !== undefined) return n
    }
  }
  if (depth >= 3) return undefined
  for (const v of Object.values(o)) {
    const items = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const r = it as Record<string, unknown>
      const sym = [r.symbol, r.currency, r.token_symbol, (r.token as Record<string, unknown> | undefined)?.symbol].find((x) => typeof x === 'string')
      if (typeof sym === 'string' && SOL_SYMBOLS.has(sym.toUpperCase())) {
        const n = solBalance(r, depth + 1)
        if (n !== undefined) return n
      }
      // "balance": { "sol": 1.2 } ya da "balances": { "SOL": "1.2" } gibi
      for (const [k, x] of Object.entries(r)) if (SOL_SYMBOLS.has(k.toUpperCase()) && num(x) !== undefined) return num(x)
    }
  }
  return undefined
}

/** Tanı için yanıtın iskeleti: alan adları kalır, değerler türüyle değiştirilir (adres/bakiye/kimlik loglanmaz). */
export function describeShape(v: unknown, depth = 0): unknown {
  if (depth > 5) return '…'
  if (Array.isArray(v)) return v.length ? [describeShape(v[0], depth + 1), `(${v.length} öğe)`] : []
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, describeShape(x, depth + 1)]))
  }
  if (typeof v === 'string') return num(v) !== undefined ? 'sayı-metin' : isLikelyMint(v) ? 'adres' : `metin(${v.length})`
  return v === null ? null : typeof v
}

// Okunabilir bakiye → en küçük birim. Üstel gösterim olmadan yazdırıp fazla basamağı KESER (yukarı yuvarlamaz)
export function toRaw(balance: number, decimals: number): bigint {
  const text = balance.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  const [int, frac = ''] = text.split('.')
  return BigInt(int + frac.padEnd(decimals, '0').slice(0, decimals))
}
