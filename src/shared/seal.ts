// Mühürlü zarf: arayüz bir sırrı (API anahtarı, Telegram kodu…) motorun açık anahtarıyla şifreler,
// Supabase'e sadece şifreli metin gider; yalnızca motor açabilir.
// Şema: rastgele AES-256-GCM anahtarı veriyi şifreler, o anahtar RSA-OAEP (SHA-256) ile sarılır.
// "aad" zarfı bir kullanıcıya ve amaca bağlar: başka bir komuta kopyalanırsa açılmaz.
// WebCrypto kullanır: tarayıcıda ve Node'da (globalThis.crypto) aynı kod çalışır.

export interface Sealed {
  v: 1
  key: string // base64, RSA-OAEP ile sarılmış AES anahtarı
  iv: string // base64, 12 bayt
  data: string // base64, AES-GCM şifreli metin + etiket
}

const subtle = () => globalThis.crypto.subtle
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export const sealAad = (userId: string, purpose: string) => new TextEncoder().encode(`memebot:${userId}:${purpose}`)

export async function sealJson(publicJwk: JsonWebKey, aad: Uint8Array<ArrayBuffer>, value: unknown): Promise<Sealed> {
  const pub = await subtle().importKey('jwk', publicJwk, RSA, false, ['encrypt'])
  const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, aes, plain))
  const raw = new Uint8Array(await subtle().exportKey('raw', aes))
  const key = new Uint8Array(await subtle().encrypt(RSA, pub, raw))
  return { v: 1, key: toB64(key), iv: toB64(iv), data: toB64(data) }
}

export async function openSealed<T = unknown>(privateKey: CryptoKey, aad: Uint8Array<ArrayBuffer>, s: Sealed): Promise<T> {
  if (!s || s.v !== 1 || typeof s.key !== 'string' || typeof s.iv !== 'string' || typeof s.data !== 'string') {
    throw new Error('Geçersiz şifreli veri')
  }
  const raw = await subtle().decrypt(RSA, privateKey, fromB64(s.key))
  const aes = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(s.iv), additionalData: aad }, aes, fromB64(s.data))
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

export async function generateSealKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await subtle().generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    'encrypt',
    'decrypt'
  ])
  return {
    publicJwk: await subtle().exportKey('jwk', pair.publicKey),
    privateJwk: await subtle().exportKey('jwk', pair.privateKey)
  }
}

export function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle().importKey('jwk', jwk, RSA, false, ['decrypt'])
}
