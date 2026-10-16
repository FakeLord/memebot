import { describe, expect, it } from 'vitest'
import { extractQuotes, extractTickers, highlight, keywordRegex, searchTerms } from '../../src/shared/feed'
import { parseSearchCoins } from '../../src/engine/feed'
import { parseHit } from '../../src/engine/xflux/client'

describe('akış metin yardımcıları', () => {
  it('$TICKER ayıklar, fiyatları ($100) saymaz', () => {
    expect(extractTickers('Yeni $DOG ve $dog, $PEPE2 geldi; fiyat $100')).toEqual(['DOG', 'PEPE2'])
  })

  it('tırnak içi metni ayıklar', () => {
    expect(extractQuotes('Başkan "Justice For All" dedi ve “Moon”')).toEqual(['Justice For All', 'Moon'])
  })

  it('anahtar kelime eşleşmesi: kısmi, tam kelime, regex', () => {
    expect('baby doge'.match(keywordRegex({ pattern: 'dog', match: 'partial' })!)?.[0]).toBe('dog')
    expect('baby doge'.match(keywordRegex({ pattern: 'dog', match: 'word' })!)).toBeNull()
    expect('inu çıktı'.match(keywordRegex({ pattern: 'in[uü]', match: 'regex' })!)?.[0]).toBe('inu')
    expect(keywordRegex({ pattern: '([', match: 'regex' })).toBeNull()
  })

  it('arama terimleri: önce ticker, sonra tırnak, sonra kelime; tekrarsız ve en fazla 3', () => {
    expect(searchTerms('$DOG "Big Dog" dog coin $DOG', [{ pattern: 'coin', match: 'word' }])).toEqual(['DOG', 'Big Dog', 'coin'])
  })

  it('vurgu parçaları metni bozmadan böler', () => {
    const text = 'Al $DOG şimdi "Moon" https://x.com/a'
    const segs = highlight(text, { keywords: [{ pattern: 'şimdi', match: 'word' }] })
    expect(segs.map((s) => s.text).join('')).toBe(text)
    expect(segs.filter((s) => s.mark).map((s) => s.mark)).toEqual(['ticker', 'keyword', 'quote', 'link'])
  })
})

describe('GMGN arama yanıtı', () => {
  it('sadece SOL token\'ları, mcp alanından piyasa değeri', () => {
    const r = parseSearchCoins(
      { coins: [{ chain: 'sol', address: 'A1', symbol: 'DOG', price: '0.01', mcp: '12000' }, { chain: 'eth', address: '0x1' }] },
      'DOG'
    )
    expect(r).toEqual([{ address: 'A1', name: undefined, symbol: 'DOG', logo: undefined, priceUsd: 0.01, mcapUsd: 12000, holders: undefined, term: 'DOG' }])
  })
})

describe('X gönderisi ayrıştırma (zengin)', () => {
  it('yazar, medya, alıntı', () => {
    const h = parseHit({
      tweet: {
        id_str: '1900000000000000001',
        full_text: 'Bakın $DOG',
        user: { name: 'Elon', screen_name: 'elonmusk', profile_image_url_https: 'https://pbs.twimg.com/a_normal.jpg', verified: true, followers_count: 100 },
        extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/m.jpg' }] },
        quoted_status: { text: 'eski gönderi', user: { name: 'Biri', screen_name: 'biri' } }
      }
    })!
    expect(h.body).toBe('Bakın $DOG')
    expect(h.author).toEqual({ name: 'Elon', handle: 'elonmusk', avatar: 'https://pbs.twimg.com/a_bigger.jpg', verified: true, followers: 100 })
    expect(h.media).toEqual([{ type: 'photo', url: 'https://pbs.twimg.com/m.jpg' }])
    expect(h.kind).toBe('quote')
    expect(h.ref?.text).toBe('eski gönderi')
  })
})
