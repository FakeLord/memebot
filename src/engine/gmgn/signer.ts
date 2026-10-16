import { createPrivateKey, randomUUID, sign } from 'node:crypto'

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

export function signMessage(message: string, pem: string): string {
  const key = createPrivateKey(pem)
  const data = Buffer.from(message, 'utf-8')
  if (key.asymmetricKeyType === 'ed25519') return sign(null, data, key).toString('base64')
  // RSA-PSS + SHA256, salt 32 — sunucu tarafı rsa.VerifyPSS ile uyumlu
  return sign('sha256', data, { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 }).toString('base64')
}
