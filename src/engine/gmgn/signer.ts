import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'

// GMGN OpenAPI istek imzası — resmi gmgn-cli (src/client/signer.ts) ile aynı şema.
// timestamp: Unix saniye, sunucu ±5 sn tolerans gösterir.
// client_id: UUID, 7 sn içinde tekrar kullanılırsa istek reddedilir.

export type QueryValue = string | number | string[]
export type Query = Record<string, QueryValue>

export function authQuery(): { timestamp: number; client_id: string } {
  return { timestamp: Math.floor(Date.now() / 1000), client_id: randomUUID() }
}

export function sortedQueryString(query: Query): string {
  return Object.keys(query)
    .sort()
    .flatMap((k) => {
      const ek = encodeURIComponent(k)
      const v = query[k]
      if (Array.isArray(v)) return [...v].sort().map((item) => `${ek}=${encodeURIComponent(item)}`)
      return [`${ek}=${encodeURIComponent(String(v))}`]
    })
    .join('&')
}

// İmzalanan metin: {path}:{sıralı_query}:{body}:{timestamp}
export function signatureMessage(path: string, query: Query, body: string, timestamp: number): string {
  return `${path}:${sortedQueryString(query)}:${body}:${timestamp}`
}

export function assertSigningKey(pem: string): void {
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519' && key.asymmetricKeyType !== 'rsa') {
    throw new Error(`Desteklenmeyen anahtar türü: ${key.asymmetricKeyType}. Ed25519 kullanın.`)
  }
}

// Ed25519 PKCS#8 DER ön eki: bunun arkasına 32 baytlık tohum (seed) eklenince geçerli özel anahtar olur
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Bytes(s: string): number | null {
  let n = 0n
  for (const ch of s) {
    const i = B58.indexOf(ch)
    if (i < 0) return null
    n = n * 58n + BigInt(i)
  }
  let len = 0
  while (n > 0n) {
    n >>= 8n
    len++
  }
  return len + (s.match(/^1*/)?.[0].length ?? 0)
}

const toPem = (der: Buffer) => `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`

/**
 * Kullanıcının yapıştırdığı imza anahtarını PEM'e çevirir ve doğrular. Kabul edilenler:
 *  - PEM (çok satırlı, "\n" kaçışlı tek satır, tırnaklı)
 *  - başlıksız PEM gövdesi (base64 PKCS#8)
 *  - ham Ed25519 tohumu: 32 bayt (base64 ya da 64 hane hex); 64 baytlık "tohum+açık anahtar" biçimi de
 * Açık anahtar ve Solana CÜZDAN özel anahtarı (base58) anlaşılır bir hatayla reddedilir.
 */
export function normalizeSigningKey(input: string): string {
  const raw = input
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim()
  if (!raw) throw new Error('İmza anahtarı boş')
  if (/BEGIN [A-Z ]*PUBLIC KEY/.test(raw)) {
    throw new Error('Bu bir AÇIK anahtar (PUBLIC KEY). GMGN\'e açık anahtarı yüklersiniz; buraya ÖZEL anahtar (PRIVATE KEY) girilir.')
  }
  const tryPem = (pem: string) => {
    assertSigningKey(pem)
    return pem.endsWith('\n') ? pem : pem + '\n'
  }
  if (raw.includes('-----BEGIN')) {
    // Satır sonları kaybolmuş olabilir: başlık/gövde/son satırı yeniden kur
    const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(raw)
    if (!m) throw new Error('PEM bloğu eksik: "-----END ... -----" satırı bulunamadı')
    const body = m[2].replace(/\s+/g, '')
    return tryPem(`-----BEGIN ${m[1]}-----\n${body.replace(/(.{64})/g, '$1\n').trim()}\n-----END ${m[1]}-----\n`)
  }

  const compact = raw.replace(/\s+/g, '')
  // Solana cüzdan özel anahtarı: base58, 64 bayt (≈87–88 karakter). Bu bir imza anahtarı DEĞİL.
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(compact) && base58Bytes(compact) === 64) {
    throw new Error(
      'Bu bir Solana CÜZDAN özel anahtarına benziyor. Cüzdan anahtarını asla girmeyin! Buraya GMGN\'in API imza anahtarı (Ed25519, "-----BEGIN PRIVATE KEY-----" ile başlar) girilir.'
    )
  }
  let bytes: Buffer | null = null
  if (/^[0-9a-fA-F]{64}$/.test(compact) || /^[0-9a-fA-F]{128}$/.test(compact)) bytes = Buffer.from(compact, 'hex')
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) bytes = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (!bytes || !bytes.length) {
    throw new Error('Anahtar biçimi tanınmadı. GMGN\'den aldığınız "-----BEGIN PRIVATE KEY-----" ile başlayan metnin tamamını yapıştırın.')
  }
  if (bytes.length === 32 || bytes.length === 64) return tryPem(toPem(Buffer.concat([ED25519_PKCS8_PREFIX, bytes.subarray(0, 32)])))
  // Başlıksız PEM gövdesi (PKCS#8 DER)
  try {
    return tryPem(toPem(bytes))
  } catch {
    throw new Error('Anahtar okunamadı. GMGN\'den aldığınız "-----BEGIN PRIVATE KEY-----" ile başlayan metnin tamamını (başlık ve son satır dahil) yapıştırın.')
  }
}

/** Yeni Ed25519 imza anahtarı çifti: açık anahtar GMGN'e yüklenir, özel anahtar motorda kalır. */
export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

export function signMessage(message: string, pem: string): string {
  const key = createPrivateKey(pem)
  const data = Buffer.from(message, 'utf-8')
  if (key.asymmetricKeyType === 'ed25519') return sign(null, data, key).toString('base64')
  // RSA-PSS + SHA256, salt 32 — sunucu tarafı rsa.VerifyPSS ile uyumlu
  return sign('sha256', data, { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 }).toString('base64')
}
