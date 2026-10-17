import { useEffect, useState } from 'react'

// Canlı piyasa fiyatları (Binance'in herkese açık market verisi WebSocket'i; anahtar gerekmez, GMGN kotası harcanmaz).
// Tek bağlantı bütün bileşenlerce paylaşılır; kimse dinlemiyorsa kapanır. Bağlantı koparsa sessizce yeniden dener.

export const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'] as const
export type Coin = (typeof COINS)[number]
export const DEFAULT_TICKER: Coin[] = ['BTC', 'ETH', 'SOL', 'BNB']

export interface Quote {
  price: number
  /** 24 saatlik değişim, oran (0.02 = %2) */
  change: number
  /** Son güncellemede fiyat yönü, kısa süreli renk vurgusu için */
  dir: 'up' | 'down' | null
}

const HOSTS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443']
let quotes: Partial<Record<Coin, Quote>> = {}
const listeners = new Set<() => void>()
let ws: WebSocket | null = null
let hostIdx = 0
let retry: ReturnType<typeof setTimeout> | null = null
let fails = 0

const emit = () => listeners.forEach((l) => l())

function connect() {
  if (ws || typeof WebSocket === 'undefined') return
  const streams = COINS.map((c) => `${c.toLowerCase()}usdt@miniTicker`).join('/')
  let sock: WebSocket
  try {
    sock = new WebSocket(`${HOSTS[hostIdx % HOSTS.length]}/stream?streams=${streams}`)
  } catch {
    return schedule()
  }
  ws = sock
  sock.onopen = () => {
    fails = 0
  }
  sock.onmessage = (ev) => {
    try {
      const d = JSON.parse(String(ev.data)).data as { s: string; c: string; o: string }
      const coin = d.s.replace(/USDT$/, '') as Coin
      if (!COINS.includes(coin)) return
      const price = Number(d.c)
      const open = Number(d.o)
      if (!Number.isFinite(price) || !open) return
      const prev = quotes[coin]?.price
      quotes = { ...quotes, [coin]: { price, change: price / open - 1, dir: prev === undefined || prev === price ? (quotes[coin]?.dir ?? null) : price > prev ? 'up' : 'down' } }
      emit()
    } catch {
      /* bozuk mesaj yok sayılır */
    }
  }
  sock.onclose = () => {
    ws = null
    fails++
    if (fails % 2 === 0) hostIdx++ // iki başarısız denemede diğer adrese geç
    if (listeners.size) schedule()
  }
  sock.onerror = () => sock.close()
}

function schedule() {
  if (retry) return
  retry = setTimeout(() => {
    retry = null
    if (listeners.size) connect()
  }, Math.min(30_000, 2000 * 2 ** Math.min(fails, 4)))
}

function subscribe(l: () => void) {
  listeners.add(l)
  connect()
  return () => {
    listeners.delete(l)
    if (!listeners.size) {
      ws?.close()
      ws = null
      if (retry) clearTimeout(retry)
      retry = null
    }
  }
}

/** Seçili coinlerin canlı fiyatları (henüz gelmeyenler yok). */
export function usePrices(): Partial<Record<Coin, Quote>> {
  const [, force] = useState(0)
  useEffect(() => subscribe(() => force((n) => n + 1)), [])
  return quotes
}

export function fmtPrice(n: number): string {
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toPrecision(3)}`
}
