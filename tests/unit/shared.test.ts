import { describe, expect, it } from 'vitest'
import { extractMints, isLikelyMint, SOL_MINT } from '../../src/shared/extract'
import { evaluateSafety, summarizeToken, usd, withDefaults } from '../../src/shared/safety'
import { generateSealKeys, importPrivateKey, openSealed, sealAad, sealJson } from '../../src/shared/seal'
import { ruleFromRow, DEFAULT_LIMITS } from '../../src/shared/rules'
import { engineOnline } from '../../src/shared/engine'

const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'
const MINT2 = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'

describe('extractMints', () => {
  it('metinden ve linkten adresleri ayıklar, tekrarları ve SOL/USDC/USDT adreslerini atar', () => {
    const text = `Yeni coin! CA: ${MINT}\nhttps://pump.fun/coin/${MINT2}\n${MINT} tekrar ${SOL_MINT}`
    expect(extractMints(text)).toEqual([MINT, MINT2])
  })

  it('daha uzun bir base58 dizisinin parçasını adres saymaz', () => {
    expect(extractMints(`x${MINT}abc`.replace('x', '1') + 'zzzzzzzzzzzzzzzzzzzzzzzz')).toEqual([])
  })

  it('base58 dışı karakterli (0, O, I, l) dizileri reddeder', () => {
    expect(isLikelyMint('0' + MINT.slice(1))).toBe(false)
    expect(isLikelyMint(MINT)).toBe(true)
    expect(isLikelyMint(SOL_MINT)).toBe(false)
  })
})

describe('evaluateSafety', () => {
  const security = {
    renounced_mint: true,
    renounced_freeze_account: true,
    is_wash_trading: false,
    rug_ratio: 0.1,
    top_10_holder_rate: 0.2,
    dev_team_hold_rate: 0.01,
    suspected_insider_hold_rate: 0.05,
    bundler_trader_amount_rate: 0.1,
    buy_tax: 0,
    sell_tax: 0
  }
  const info = { price: { price: 0.0001 }, circulating_supply: 1_000_000_000, liquidity: 20_000, dev: { creator_open_count: 2 } }

  it('tüm eşiklerin altında: GEÇTİ', () => {
    expect(evaluateSafety(security, info, null).result).toBe('pass')
  })

  it('tek bir kırmızı bayrak: RED', () => {
    const r = evaluateSafety({ ...security, renounced_mint: false }, info, null)
    expect(r.result).toBe('fail')
    expect(r.items.find((i) => i.label.startsWith('Mint'))?.verdict).toBe('fail')
  })

  it('eksik veri: UYARI', () => {
    const { rug_ratio: _drop, ...rest } = security
    expect(evaluateSafety(rest, info, null).result).toBe('warn')
  })

  it('kullanıcı eşiği kararı değiştirir', () => {
    expect(evaluateSafety(security, info, { minLiquidityUsd: 50_000 }).result).toBe('fail')
    expect(evaluateSafety(security, info, { maxTop10Rate: 0.1 }).result).toBe('fail')
  })

  it('özet: fiyat nesnesi, mcap = fiyat × dolaşım', () => {
    const s = summarizeToken({ ...info, symbol: 'DOG', name: 'Dog' })
    expect(s.priceUsd).toBe(0.0001)
    expect(s.mcapUsd).toBeCloseTo(100_000)
    expect(s.symbol).toBe('DOG')
    expect(usd(1_500_000)).toBe('$1.50M')
  })

  it('withDefaults eksik alanları doldurur', () => {
    expect(withDefaults({ maxTax: 0.05 }).maxTax).toBe(0.05)
    expect(withDefaults(undefined).requireMintRenounced).toBe(true)
  })
})

describe('seal (mühürlü zarf)', () => {
  it('açık anahtarla şifrelenen veri özel anahtarla açılır', async () => {
    const keys = await generateSealKeys()
    const priv = await importPrivateKey(keys.privateJwk)
    const aad = sealAad('u1', 'gmgn')
    const s = await sealJson(keys.publicJwk, aad, { apiKey: 'gizli' })
    expect(JSON.stringify(s)).not.toContain('gizli')
    expect(await openSealed(priv, aad, s)).toEqual({ apiKey: 'gizli' })
  })

  it('başka kullanıcıya/amaca kopyalanan zarf açılmaz', async () => {
    const keys = await generateSealKeys()
    const priv = await importPrivateKey(keys.privateJwk)
    const s = await sealJson(keys.publicJwk, sealAad('u1', 'gmgn'), { apiKey: 'gizli' })
    await expect(openSealed(priv, sealAad('u2', 'gmgn'), s)).rejects.toThrow()
    await expect(openSealed(priv, sealAad('u1', 'xflux'), s)).rejects.toThrow()
  })
})

describe('rules', () => {
  it('satırdan kural: eksik limitler varsayılanla tamamlanır, geçersiz mod manuel olur', () => {
    const r = ruleFromRow({ mode: 'xx', thresholds: {}, limits: { maxBuySol: 2 }, tp_sl_template: [] })
    expect(r.mode).toBe('manual')
    expect(r.limits.maxBuySol).toBe(2)
    expect(r.limits.liveTrading).toBe(DEFAULT_LIMITS.liveTrading)
    expect(r.tpSl.length).toBeGreaterThan(0)
  })
})

describe('engineOnline', () => {
  it('30 sn içinde kalp atışı = çevrimiçi', () => {
    const now = Date.now()
    expect(engineOnline({ heartbeat_at: new Date(now - 5_000).toISOString() }, now)).toBe(true)
    expect(engineOnline({ heartbeat_at: new Date(now - 60_000).toISOString() }, now)).toBe(false)
    expect(engineOnline(null, now)).toBe(false)
  })
})
