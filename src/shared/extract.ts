// Mesaj metninden Solana token (mint) adreslerini ayıklar.

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

const IGNORED = new Set([SOL_MINT, USDC_MINT, USDT_MINT])

// Base58 alfabesi (0, O, I, l yok), 32–44 karakter, kelime sınırında
const BASE58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g

export function extractMints(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(BASE58)) {
    const addr = m[0]
    if (IGNORED.has(addr) || found.includes(addr)) continue
    found.push(addr)
  }
  return found
}

export function isLikelyMint(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) && !IGNORED.has(addr)
}
