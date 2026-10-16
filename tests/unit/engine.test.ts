import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { signatureMessage, signMessage, sortedQueryString } from '../../src/engine/gmgn/signer'
import { RateLimiter, Priority } from '../../src/engine/gmgn/limiter'
import { extractWallets, lamports, toRaw, sell, buy, HARD_MAX_BUY_SOL } from '../../src/engine/gmgn/trade'
import { parseHit, parseMonitors } from '../../src/engine/xflux/client'
import { Vault } from '../../src/engine/vault'
import { startOfDay } from '../../src/engine/time'
import { intervalFor } from '../../src/engine/sources'
import { normStatus } from '../../src/engine/orders'
import type { GmgnApi } from '../../src/engine/gmgn/client'

const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'
const WALLET = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'

describe('GMGN imzası', () => {
  it('query alfabetik sıralanır, dizi değerleri de sıralanır', () => {
    expect(sortedQueryString({ b: 2, a: 'x y', c: ['z', 'a'] })).toBe('a=x%20y&b=2&c=a&c=z')
  })

  it('imzalanan metin {path}:{query}:{body}:{timestamp}', () => {
    expect(signatureMessage('/v1/trade/swap', { timestamp: 1, client_id: 'id' }, '{"a":1}', 1)).toBe(
      '/v1/trade/swap:client_id=id&timestamp=1:{"a":1}:1'
    )
  })

  it('Ed25519 imzası açık anahtarla doğrulanır', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const sig = signMessage('merhaba', pem)
    expect(verify(null, Buffer.from('merhaba'), createPublicKey(pem), Buffer.from(sig, 'base64'))).toBe(true)
  })
})

describe('hız sınırlayıcı', () => {
  it('öncelik sırası: işlem > emir > güvenlik > fiyat', async () => {
    const l = new RateLimiter(1)
    await l.acquire(1, Priority.Price) // kovayı boşalt
    const order: string[] = []
    const ps = [
      l.acquire(1, Priority.Price).then(() => order.push('price')),
      l.acquire(1, Priority.Safety).then(() => order.push('safety')),
      l.acquire(1, Priority.Trade).then(() => order.push('trade'))
    ]
    await Promise.all(ps)
    expect(order).toEqual(['trade', 'safety', 'price'])
  })

  it('kapasiteden ağır istek kova dolunca geçer (borç bırakır)', async () => {
    const l = new RateLimiter(5)
    const t = Date.now()
    await l.acquire(10, Priority.Trade)
    expect(Date.now() - t).toBeLessThan(200)
  })
})

describe('alım-satım yardımcıları', () => {
  it('toRaw yuvarlamaz, keser', () => {
    expect(toRaw(1.23456789, 6)).toBe(1234567n)
    expect(toRaw(1000, 6)).toBe(1000000000n)
    expect(toRaw(0.0000001, 6)).toBe(0n)
  })

  it('lamports', () => {
    expect(lamports(0.05)).toBe('50000000')
  })

  it('extractWallets iç içe yanıttaki SOL cüzdanlarını bulur, EVM zincirini atar', () => {
    const data = { wallets: [{ chain: 'sol', address: WALLET, balance: '1.5' }, { chain: 'eth', address: MINT }] }
    expect(extractWallets(data)).toEqual([{ address: WALLET, balance: 1.5 }])
  })

  it('mutlak üst sınır ve deneme satışı miktarı', async () => {
    const calls: unknown[] = []
    const fake = { quote: async (p: unknown) => (calls.push(p), { ok: true, status: 200, data: {} }) } as unknown as GmgnApi
    const base = { dryRun: true, slippage: 30 as const, priorityFeeSol: 0, tipFeeSol: 0, antiMev: true }
    const r = await buy(fake, WALLET, { ...base, mint: MINT, amountSol: HARD_MAX_BUY_SOL + 1, conditionOrders: [] })
    expect(r.ok).toBe(false)
    await sell(fake, WALLET, { ...base, mint: MINT, percent: 25, amountRaw: '1000' })
    expect((calls[0] as { input_amount: string }).input_amount).toBe('250')
  })
})

describe('XFlux ayrıştırma', () => {
  it('tweet kimliğini sayısal alandan, metni iç içe alanlardan toplar', () => {
    const hit = parseHit({ id: 'uuid-1', tweet: { id_str: '1900000000000000001', text: 'CA:', entities: { urls: [{ expanded_url: `https://pump.fun/${MINT}` }] } } })
    expect(hit?.tweetId).toBe('1900000000000000001')
    expect(hit?.text).toContain(MINT)
  })

  it('izleyici listesi farklı sarmalayıcılarla gelebilir', () => {
    const m = parseMonitors({ data: { monitors: [{ id: 'm1', username: '@elon', hits: [{ tweet_id: '123', text: 'x' }] }] } })
    expect(m).toEqual([{ id: 'm1', username: 'elon', hits: [{ tweetId: '123', text: 'x', createdAt: undefined }] }])
  })

  it('kota azaldıkça yoklama aralığı uzar', () => {
    const now = new Date(2026, 9, 16, 12, 0, 0)
    expect(intervalFor(undefined, now)).toBe(15_000)
    expect(intervalFor(1_000_000, now)).toBe(3_000)
    expect(intervalFor(100, now)).toBe(600_000)
  })
})

describe('kasa', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memebot-vault-'))
  const key = Buffer.alloc(32, 7).toString('base64')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sırları şifreli saklar, yeniden açınca okur; yanlış anahtarla açılmaz', async () => {
    const v = await Vault.open(dir, key)
    const uid = '11111111-1111-1111-1111-111111111111'
    v.set(uid, 'xflux', { apiKey: 'xflux_gizli_anahtar' })
    expect(readFileSync(join(dir, 'vault.bin')).toString('latin1')).not.toContain('xflux_gizli')
    const again = await Vault.open(dir, key)
    expect(again.get(uid).xflux?.apiKey).toBe('xflux_gizli_anahtar')
    expect(again.publicJwk).toEqual(v.publicJwk)
    await expect(Vault.open(dir, Buffer.alloc(32, 8).toString('base64'))).rejects.toThrow(/Kasa açılamadı/)
  })
})

describe('zaman', () => {
  it('İstanbul gece yarısı = 21:00 UTC (önceki gün)', () => {
    const d = startOfDay('Europe/Istanbul', new Date('2026-10-16T10:30:00Z'))
    expect(d.toISOString()).toBe('2026-10-15T21:00:00.000Z')
    expect(startOfDay('Europe/Istanbul', new Date('2026-10-16T22:30:00Z')).toISOString()).toBe('2026-10-16T21:00:00.000Z')
  })
})

describe('emir durumu', () => {
  it('GMGN durumlarını normalize eder', () => {
    expect(normStatus('successful')).toBe('confirmed')
    expect(normStatus('FAILED')).toBe('failed')
    expect(normStatus('weird')).toBeUndefined()
  })
})
