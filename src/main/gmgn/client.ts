import { request } from 'node:https'
import { authQuery, signMessage, signatureMessage, type Query } from './signer'
import type { GmgnResult, SwapParams } from '../../shared/types'

const HOST = 'openapi.gmgn.ai'

export interface GmgnCredentials {
  apiKey: string
  privateKeyPem: string
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
  constructor(private readonly creds: GmgnCredentials) {}

  private async call<T>(method: Method, path: string, extra: Query, body: unknown, signed: boolean): Promise<GmgnResult<T>> {
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
    return this.call('GET', '/v1/user/info', {}, null, false)
  }
  tokenInfo(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/info', { chain, address: mint }, null, false)
  }
  tokenSecurity(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/security', { chain, address: mint }, null, false)
  }
  poolInfo(mint: string, chain = 'sol') {
    return this.call('GET', '/v1/token/pool_info', { chain, address: mint }, null, false)
  }
  gasPrice(chain = 'sol') {
    return this.call('GET', '/v1/trade/gas_price', { chain }, null, false)
  }

  // --- işlem (API key + imza)
  quote(p: { chain: string; from_address: string; input_token: string; output_token: string; input_amount: string; slippage: number }) {
    return this.call('GET', '/v1/trade/quote', p, null, true)
  }
  swap(params: SwapParams) {
    return this.call('POST', '/v1/trade/swap', {}, params, true)
  }
  queryOrder(orderId: string, chain = 'sol') {
    return this.call('GET', '/v1/trade/query_order', { order_id: orderId, chain }, null, true)
  }
  walletHoldings(walletAddress: string, chain = 'sol') {
    return this.call('GET', '/v1/user/wallet_holdings', { chain, wallet_address: walletAddress }, null, true)
  }
}
