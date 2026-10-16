import { request } from 'node:https'
import { authQuery, signMessage, signatureMessage, type Query } from './signer'
import { limiterFor, Priority, type GmgnPlan, type RateLimiter } from './limiter'
import type { GmgnResult, SwapParams } from '../../shared/types'

const HOST = 'openapi.gmgn.ai'

export interface GmgnCredentials {
  apiKey: string
  privateKeyPem: string
  plan?: GmgnPlan
  wallet?: string // API anahtarına bağlı, işlem yapılacak SOL cüzdanı
}

type Method = 'GET' | 'POST'

// GMGN sadece IPv4 kabul eder; family: 4 ile zorlanır.
function send(method: Method, path: string, query: Query, headers: Record<string, string>, body: string | null) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item))
    else qs.append(k, String(v))
  }
  return new Promise<{ status: number; text: string; resetAt?: string }>((resolve, reject) => {
    const req = request(
      {
        host: HOST,
        family: 4,
        method,
        path: `${path}?${qs.toString()}`,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
        timeout: 15_000
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf-8'),
            resetAt: res.headers['x-ratelimit-reset'] as string | undefined
          })
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error('GMGN isteği zaman aşımına uğradı')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export class GmgnClient {
  private readonly limiter: RateLimiter

  constructor(private readonly creds: GmgnCredentials) {
    this.limiter = limiterFor(creds.apiKey, creds.plan ?? 'free')
  }

  // weight: GMGN'in belgelediği rate-limit ağırlığı. retries: 429 sonrası tekrar sayısı
  // (alım-satımda 0 — tekrar denemeyi Faz 4'teki emir motoru idempotency ile yönetir).
  private async call<T>(
    method: Method,
    path: string,
    extra: Query,
    body: unknown,
    signed: boolean,
    weight: number,
    priority: Priority,
    retries = 2
  ): Promise<GmgnResult<T>> {
    await this.limiter.acquire(weight, priority)
    // Kuyrukta beklerken zaman geçmiş olabilir: imza ve timestamp bekleme SONRASI üretilir (±5 sn kuralı)
    const auth = authQuery()
    const query: Query = { ...extra, ...auth }
    const bodyStr = body == null ? '' : JSON.stringify(body)
    const headers: Record<string, string> = { 'X-APIKEY': this.creds.apiKey, 'User-Agent': 'memebot' }
    if (signed) {
      headers['X-Signature'] = signMessage(signatureMessage(path, query, bodyStr, auth.timestamp), this.creds.privateKeyPem)
    }
    try {
      const res = await send(method, path, query, headers, bodyStr || null)
      let parsed: { code?: number | string; data?: T; message?: string; error?: string } = {}
      try {
        parsed = JSON.parse(res.text)
      } catch {
        return { ok: false, status: res.status, error: `Geçersiz yanıt (${res.status})` }
      }
      if (res.status === 429) {
        const reset = Number(res.resetAt)
        this.limiter.pause(Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 5_000)
        if (retries > 0) return this.call(method, path, extra, body, signed, weight, priority, retries - 1)
      }
      const ok = res.status >= 200 && res.status < 300 && (parsed.code === 0 || parsed.code === '0' || parsed.code === undefined)
      if (!ok) {
        return {
          ok: false,
          status: res.status,
          code: parsed.code,
          error: parsed.error || parsed.message || `HTTP ${res.status}`,
          resetAt: res.resetAt
        }
      }
      return { ok: true, status: res.status, data: parsed.data as T }
    } catch (e) {
      return { ok: false, status: 0, error: (e as Error).message }
    }
  }

  // --- okuma (sadece API key)
  userInfo() {
    return this.call('GET', '/v1/user/info', {}, null, false, 2, Priority.Order)
  }
  tokenInfo(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/info', { chain, address: mint }, null, false, 1, Priority.Safety)
  }
  tokenSecurity(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/security', { chain, address: mint }, null, false, 1, Priority.Safety)
  }
  poolInfo(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/pool_info', { chain, address: mint }, null, false, 1, Priority.Safety)
  }
  tokenPrice(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/info', { chain, address: mint }, null, false, 1, Priority.Price, 0)
  }
  gasPrice(chain = 'sol') {
    return this.call('GET', '/v1/trade/gas_price', { chain }, null, false, 1, Priority.Order)
  }

  // --- işlem (API key + imza)
  quote(p: { chain: string; from_address: string; input_token: string; output_token: string; input_amount: string; slippage: number }) {
    // Resmi istemcide teklif imzasız (authExistRequest) gönderiliyor
    return this.call('GET', '/v1/trade/quote', p, null, false, 10, Priority.Trade)
  }
  swap(params: SwapParams) {
    return this.call('POST', '/v1/trade/swap', {}, params, true, 10, Priority.Trade, 0)
  }
  queryOrder(orderId: string, chain = 'sol') {
    return this.call('GET', '/v1/trade/query_order', { order_id: orderId, chain }, null, true, 5, Priority.Order)
  }
  walletHoldings(walletAddress: string, cursor?: string, chain = 'sol') {
    const q: Query = { chain, wallet_address: walletAddress, limit: 50 }
    if (cursor) q.cursor = cursor
    return this.call('GET', '/v1/user/wallet_holdings', q, null, true, 2, Priority.Price, 0)
  }
}
