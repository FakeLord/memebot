import { createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeSigningKey, signMessage } from '../../src/engine/gmgn/signer'

// Kullanıcının yapıştırabileceği farklı imza anahtarı biçimleri → hepsi aynı geçerli PEM'e dönmeli

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const der = privateKey.export({ type: 'pkcs8', format: 'der' })
const seed = der.subarray(der.length - 32)
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function signsWithSameKey(normalized: string) {
  const sig = signMessage('deneme', normalized)
  expect(verify(null, Buffer.from('deneme'), createPublicKey(pubPem), Buffer.from(sig, 'base64'))).toBe(true)
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(buf: Buffer): string {
  let n = BigInt('0x' + buf.toString('hex'))
  let s = ''
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s
    n /= 58n
  }
  for (const b of buf) {
    if (b !== 0) break
    s = '1' + s
  }
  return s
}

describe('imza anahtarı biçimleri', () => {
  it('normal çok satırlı PEM', () => signsWithSameKey(normalizeSigningKey(pem)))

  it('"\\n" kaçışlı tek satır ve tırnaklı', () => {
    signsWithSameKey(normalizeSigningKey(pem.trim().replace(/\n/g, '\\n')))
    signsWithSameKey(normalizeSigningKey(`"${pem.trim()}"`))
  })

  it('satır sonları kaybolmuş (tek satıra yapışmış) PEM', () => signsWithSameKey(normalizeSigningKey(pem.replace(/\n/g, ' '))))

  it('başlıksız PEM gövdesi', () => signsWithSameKey(normalizeSigningKey(der.toString('base64'))))

  it('ham 32 baytlık tohum: base64 ve hex', () => {
    signsWithSameKey(normalizeSigningKey(seed.toString('base64')))
    signsWithSameKey(normalizeSigningKey(seed.toString('hex')))
  })

  it('64 baytlık tohum + açık anahtar (base64)', () => {
    const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
    signsWithSameKey(normalizeSigningKey(Buffer.concat([seed, pub]).toString('base64')))
  })

  it('açık anahtar yapıştırılınca anlaşılır hata', () => {
    expect(() => normalizeSigningKey(pubPem)).toThrow(/AÇIK anahtar/)
  })

  it('Solana cüzdan özel anahtarı (base58, 64 bayt) reddedilir', () => {
    expect(() => normalizeSigningKey(base58(randomBytes(64)))).toThrow(/CÜZDAN/)
  })

  it('boş ve anlamsız girdi', () => {
    expect(() => normalizeSigningKey('   ')).toThrow(/boş/)
    expect(() => normalizeSigningKey('merhaba dünya!')).toThrow(/tanınmadı/)
    expect(() => normalizeSigningKey('-----BEGIN PRIVATE KEY-----\nabc')).toThrow(/END/)
  })
})
