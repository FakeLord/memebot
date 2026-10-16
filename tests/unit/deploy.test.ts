import { describe, expect, it } from 'vitest'
import { buildCreateToken, nameSuggestions, symbolFor, validateDeploy, type DeployForm } from '../../src/shared/deploy'

const base: DeployForm = {
  platform: 'pump',
  name: 'Dog Coin',
  symbol: 'DOG',
  image: { kind: 'url', url: 'https://a.b/c.png' },
  buySol: 0.1,
  feeShares: [],
  autoSell: [],
  preset: 1
}
const fees = { priorityFeeSol: 0.0005, tipFeeSol: 0.001, slippage: 30 as const, antiMev: true }

describe('deploy formu', () => {
  it('geçerli form hatasız', () => {
    expect(validateDeploy(base)).toEqual([])
  })

  it('sınırlar: ad 32, sembol 13 ve harf/rakam, görsel zorunlu, alım 0–5', () => {
    const e = validateDeploy({ ...base, name: 'x'.repeat(33), symbol: 'A-B', image: null, buySol: 6 })
    expect(e.join(' ')).toMatch(/32/)
    expect(e.join(' ')).toMatch(/harf ve rakam/)
    expect(e.join(' ')).toMatch(/Görsel/)
    expect(e.join(' ')).toMatch(/0–5/)
  })

  it('ücret paylaşımı toplamı %100 olmalı; Bonk desteklemez', () => {
    expect(validateDeploy({ ...base, feeShares: [{ provider: 'twitter', username: 'a', percent: 60 }] }).join()).toMatch(/%100/)
    expect(validateDeploy({ ...base, platform: 'bonk', feeShares: [{ provider: 'twitter', username: 'a', percent: 100 }] }).join()).toMatch(/Bonk/)
  })

  it('istek gövdesi: resmi alan adları, bps toplamı tam 10000, otomatik satış oranı', () => {
    const p = buildCreateToken(
      {
        ...base,
        feeShares: [
          { provider: 'twitter', username: '@a', percent: 33.33 },
          { provider: 'solana', username: 'b', percent: 66.67 }
        ],
        autoSell: [{ type: 'mcap', mcapUsd: 50000, percent: 100 }]
      },
      'WALLET',
      fees
    )
    expect(p).toMatchObject({ chain: 'sol', dex: 'pump', from_address: 'WALLET', buy_amt: '0.1', image_url: 'https://a.b/c.png', slippage: 30, is_anti_mev: true })
    const list = p.pump_fee_share_list as { basic_points: number; username: string }[]
    expect(list.reduce((a, s) => a + s.basic_points, 0)).toBe(10000)
    expect(list[0].username).toBe('a')
    expect(p.sell_configs).toEqual([{ sell_type: 'limit_order', check_price: '50000', sell_ratio: '1', wallet_addresses: ['WALLET'] }])
  })

  it('ad ve sembol önerileri', () => {
    expect(nameSuggestions('Başkan "Justice For All" dedi, $DOG uçuyor. Elon Musk paylaştı')).toEqual(['Justice For All', 'DOG', 'Başkan', 'Elon Musk'])
    expect(symbolFor('Justice For All')).toBe('JFA')
    expect(symbolFor('Doge')).toBe('DOGE')
    expect(symbolFor('Köpek Coin')).toBe('KOPEKCOIN')
  })

  it('ad önerilerine token adresi, bağlantı ve CA girmez', () => {
    const text = 'Yeni bir şey geliyor $FROG "FROG to the moon" CA: LSmcXmkaCLxtSDyL1aB3VzXuCFAGzNWFqnBY7MTa https://Pump.Fun/Abc'
    expect(nameSuggestions(text)).toEqual(['FROG to the moon', 'FROG', 'Yeni'])
  })
})
