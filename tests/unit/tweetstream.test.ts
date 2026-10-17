import { describe, expect, it } from 'vitest'
import { normalizeHandle, tweetToHit } from '../../src/engine/tweetstream/client'

describe('TweetStream', () => {
  it('kullanıcı adı: @, bağlantı ve büyük harf normalleşir; geçersizler reddedilir', () => {
    expect(normalizeHandle('@ElonMusk')).toBe('elonmusk')
    expect(normalizeHandle('https://x.com/Pump_Fun/status/1')).toBe('pump_fun')
    expect(normalizeHandle('x.com/memeking')).toBe('memeking')
    expect(normalizeHandle('twitter.com/abc?s=20')).toBe('abc')
    expect(normalizeHandle('olmaz!!')).toBeNull()
    expect(normalizeHandle('cokuzunbirkullaniciadi')).toBeNull()
    expect(normalizeHandle('')).toBeNull()
  })

  it('tweet/content → X gönderisi: metin + bağlantılar + alıntı taranır, yazar ve tür eşlenir', () => {
    const hit = tweetToHit({
      tweetId: '1900000000000000001',
      kind: 'quote',
      text: 'bakın şuna',
      createdAt: 1_700_000_000_000,
      author: { handle: '@Dev', name: 'Dev', followersCount: 50_000, verifiedType: 'blue', profileImage: 'https://pbs.twimg.com/a.jpg', platform: 'twitter' },
      urls: [{ url: 'https://pump.fun/coin/AbC' }],
      media: [{ type: 'video', url: 'https://video.twimg.com/v.mp4', thumbnail: 'https://pbs.twimg.com/t.jpg' }],
      ref: { type: 'quote', tweetId: '2', text: 'CA: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', author: { handle: '@ref', name: 'Ref' } }
    })!
    expect(hit.tweetId).toBe('1900000000000000001')
    expect(hit.kind).toBe('quote')
    expect(hit.body).toBe('bakın şuna')
    expect(hit.text).toContain('https://pump.fun/coin/AbC')
    expect(hit.text).toContain('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')
    expect(hit.author).toEqual({ name: 'Dev', handle: 'Dev', avatar: 'https://pbs.twimg.com/a.jpg', verified: true, followers: 50_000 })
    expect(hit.media).toEqual([{ type: 'video', url: 'https://pbs.twimg.com/t.jpg' }])
    expect(hit.ref).toEqual({ author: { name: 'Ref', handle: 'ref', avatar: undefined, verified: undefined, followers: undefined }, text: 'CA: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' })
    expect(tweetToHit({ tweetId: '3', kind: 'retweet', text: '', author: { handle: '@a' } })!.kind).toBe('repost')
  })

  it('başka platformların gönderileri ve kimliksiz çerçeveler atlanır', () => {
    expect(tweetToHit({ tweetId: '1', text: 'x', author: { handle: '@a', platform: 'truth_social' } })).toBeNull()
    expect(tweetToHit({ text: 'kimlik yok' })).toBeNull()
    expect(tweetToHit(null)).toBeNull()
  })
})
