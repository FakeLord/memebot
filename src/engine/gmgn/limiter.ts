// GMGN OpenAPI hız sınırı: sızdıran kova (leaky bucket), istek başına "ağırlık".
// Plan kapasiteleri (rate/capacity): Free 5/5, Plus 20/20, Pro 50/50 — saniye başına varsayıldı.
// Tüm GMGN çağrıları API anahtarı başına TEK kuyruktan geçer; öncelik: işlem > emir > güvenlik > fiyat.

import type { GmgnPlan } from '../../shared/engine'

export type { GmgnPlan }
export const PLAN_RATE: Record<GmgnPlan, number> = { free: 5, plus: 20, pro: 50 }

export const Priority = { Trade: 0, Order: 1, Safety: 2, Price: 3 } as const
export type Priority = (typeof Priority)[keyof typeof Priority]

interface Waiter {
  weight: number
  priority: Priority
  seq: number
  resolve: () => void
}

export class RateLimiter {
  private tokens: number
  private last = Date.now()
  private queue: Waiter[] = []
  private seq = 0
  private timer: NodeJS.Timeout | null = null
  private pausedUntil = 0

  constructor(private rate: number) {
    this.tokens = rate
  }

  setRate(rate: number) {
    this.rate = rate
  }

  /** 429 alındığında sunucunun verdiği zamana kadar tüm istekleri durdurur. */
  pause(untilMs: number) {
    this.pausedUntil = Math.max(this.pausedUntil, untilMs)
    this.schedule()
  }

  acquire(weight: number, priority: Priority): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ weight, priority, seq: this.seq++, resolve })
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
      this.drain()
    })
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate)
    this.last = now
  }

  private drain() {
    if (this.timer) return
    const now = Date.now()
    if (now < this.pausedUntil) return this.schedule()
    this.refill()
    while (this.queue.length) {
      const next = this.queue[0]
      // Ağırlığı kapasiteden büyük istek (ör. swap=10, Free=5): kova doluysa geçer, borç bırakır
      const need = Math.min(next.weight, this.rate)
      if (this.tokens < need) break
      this.tokens -= next.weight
      this.queue.shift()
      next.resolve()
    }
    if (this.queue.length) this.schedule()
  }

  private schedule() {
    if (this.timer) return
    const now = Date.now()
    const need = this.queue.length ? Math.min(this.queue[0].weight, this.rate) : 0
    const waitTokens = Math.max(0, ((need - this.tokens) / this.rate) * 1000)
    const wait = Math.max(this.pausedUntil - now, waitTokens, 20)
    this.timer = setTimeout(() => {
      this.timer = null
      this.drain()
    }, wait)
  }
}

const limiters = new Map<string, RateLimiter>()

export function limiterFor(apiKey: string, plan: GmgnPlan = 'free'): RateLimiter {
  let l = limiters.get(apiKey)
  if (!l) {
    l = new RateLimiter(PLAN_RATE[plan])
    limiters.set(apiKey, l)
  } else {
    l.setRate(PLAN_RATE[plan])
  }
  return l
}
