import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { GmgnApi } from '../../src/engine/gmgn/client'
import type { GmgnResult } from '../../src/shared/types'

// Yerel Supabase (Docker) üzerinde entegrasyon testi yardımcıları.
// Anahtarlar yerel geliştirme anahtarlarıdır (supabase status); gerçek projeye dokunulmaz.

export interface LocalEnv {
  url: string
  anonKey: string
  serviceKey: string
}

export function localSupabase(): LocalEnv | null {
  try {
    const out = execSync('npx supabase status -o env', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }).toString()
    const env = Object.fromEntries(
      out
        .split('\n')
        .map((l) => /^([A-Z_]+)="?(.*?)"?\s*$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1], m[2]])
    )
    if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) return null
    // Güvenlik: yalnızca yerel adres
    if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.API_URL)) return null
    return { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY }
  } catch {
    return null
  }
}

export const service = (e: LocalEnv) => createClient(e.url, e.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

export async function makeUser(e: LocalEnv, role: 'founder' | 'developer' | 'assistant', tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const admin = service(e)
  const email = `${role}-${tag}@test.local`
  const password = `Test-${tag}-${role}-123456`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: `${role}-${tag}` } })
  if (error) throw error
  await admin.from('profiles').update({ role, is_active: true }).eq('id', data.user.id)
  const client = createClient(e.url, e.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: se } = await client.auth.signInWithPassword({ email, password })
  if (se) throw se
  return { id: data.user.id, client }
}

export const tmpDir = (p: string) => mkdtempSync(join(tmpdir(), p))

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000, step = 150): Promise<T> {
  const end = Date.now() + ms
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v as T
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error(`zaman aşımı${last ? `: ${(last as Error).message}` : ''}`)
}

// --- sahte GMGN: güvenli token, teklif ve emir akışı
export interface FakeToken {
  price: number
  supply?: number
  liquidity?: number
  symbol?: string
  safe?: boolean
}

export class FakeGmgn implements GmgnApi {
  tokens = new Map<string, FakeToken>()
  calls: { fn: string; args: unknown }[] = []
  swapStatus: 'pending' | 'confirmed' = 'pending'
  queryResults: string[] = ['pending', 'confirmed']
  holdingsList: { token: { token_address: string; price: number }; balance: number }[] = []
  wallets = [{ chain: 'sol', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', balance: 3 }]

  private ok<T>(data: T): GmgnResult<T> {
    return { ok: true, status: 200, data }
  }

  async userInfo() {
    this.calls.push({ fn: 'userInfo', args: null })
    return this.ok({ wallets: this.wallets })
  }
  async tokenInfo(mint: string) {
    this.calls.push({ fn: 'tokenInfo', args: mint })
    const t = this.tokens.get(mint) ?? { price: 0.0001 }
    return this.ok({
      symbol: t.symbol ?? 'TST',
      name: 'Test',
      price: { price: t.price },
      circulating_supply: t.supply ?? 1_000_000_000,
      liquidity: t.liquidity ?? 50_000,
      decimals: 6,
      holder_count: 500,
      dev: { creator_open_count: 1 }
    })
  }
  async tokenSecurity(mint: string) {
    this.calls.push({ fn: 'tokenSecurity', args: mint })
    const safe = this.tokens.get(mint)?.safe ?? true
    return this.ok({
      renounced_mint: safe,
      renounced_freeze_account: true,
      is_wash_trading: false,
      rug_ratio: 0.05,
      top_10_holder_rate: 0.2,
      dev_team_hold_rate: 0.01,
      suspected_insider_hold_rate: 0.02,
      bundler_trader_amount_rate: 0.1,
      buy_tax: 0,
      sell_tax: 0
    })
  }
  async tokenPrice(mint: string) {
    return this.tokenInfo(mint)
  }
  async quote(p: { input_token: string; output_token: string; input_amount: string }) {
    this.calls.push({ fn: 'quote', args: p })
    const sol = p.input_token === 'So11111111111111111111111111111111111111112'
    const mint = sol ? p.output_token : p.input_token
    const price = this.tokens.get(mint)?.price ?? 0.0001
    // 1 SOL = 150 $; 6 ondalık
    const out = sol
      ? Math.floor((((Number(p.input_amount) / 1e9) * 150) / price) * 1e6)
      : Math.floor((((Number(p.input_amount) / 1e6) * price) / 150) * 1e9)
    return this.ok({ input_amount: p.input_amount, output_amount: String(out) })
  }
  async swap(p: unknown) {
    this.calls.push({ fn: 'swap', args: p })
    return this.ok({ order_id: `ord-${this.calls.length}`, status: this.swapStatus, hash: 'TxHash111' })
  }
  async queryOrder(orderId: string) {
    this.calls.push({ fn: 'queryOrder', args: orderId })
    const st = this.queryResults.shift() ?? 'confirmed'
    return this.ok({
      status: st,
      hash: 'TxHash111',
      report: { input_amount: '50000000', output_amount: '75000000000', price_usd: 0.0001, output_token_decimals: 6 }
    })
  }
  searchResults = new Map<string, { address: string; name: string; symbol: string; price: string; mcp: string }[]>()
  async marketSearch(q: string) {
    this.calls.push({ fn: 'marketSearch', args: q })
    return this.ok({ coins: this.searchResults.get(q.toLowerCase()) ?? [], wallets: [] })
  }
  async walletHoldings() {
    return this.ok({ list: this.holdingsList, next: null })
  }
}
