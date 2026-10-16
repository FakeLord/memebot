// GMGN token/security + token/info yanıtlarından GEÇTİ / UYARI / RED kararı üretir.
// Eşikler kullanıcı kurallarından gelir; burada varsayılanlar var.

export interface SafetyThresholds {
  requireMintRenounced: boolean
  requireFreezeRenounced: boolean
  maxRugRatio: number
  maxTop10Rate: number
  maxDevTeamRate: number
  maxCreatorLaunches: number
  maxTax: number
}

export const DEFAULT_THRESHOLDS: SafetyThresholds = {
  requireMintRenounced: true,
  requireFreezeRenounced: true,
  maxRugRatio: 0.3,
  maxTop10Rate: 0.35,
  maxDevTeamRate: 0.1,
  maxCreatorLaunches: 20,
  maxTax: 0
}

export type Verdict = 'pass' | 'warn' | 'fail'

export interface SafetyCheckItem {
  label: string
  value: string
  verdict: Verdict
}

export interface SafetyReport {
  result: Verdict
  items: SafetyCheckItem[]
}

type Obj = Record<string, unknown>

function pick(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Obj)[k] : undefined), o)
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function bool(v: unknown): boolean | undefined {
  if (v === true || v === 'true' || v === 1 || v === 'yes') return true
  if (v === false || v === 'false' || v === 0 || v === 'no') return false
  return undefined
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function evaluateSafety(security: unknown, info: unknown, t: SafetyThresholds = DEFAULT_THRESHOLDS): SafetyReport {
  const items: SafetyCheckItem[] = []

  const flag = (label: string, value: boolean | undefined, required: boolean) => {
    if (value === undefined) items.push({ label, value: 'bilinmiyor', verdict: 'warn' })
    else items.push({ label, value: value ? 'evet' : 'hayır', verdict: value || !required ? 'pass' : 'fail' })
  }

  const max = (label: string, value: number | undefined, limit: number, fmt: (n: number) => string) => {
    if (value === undefined) items.push({ label, value: 'bilinmiyor', verdict: 'warn' })
    else items.push({ label, value: fmt(value), verdict: value <= limit ? 'pass' : 'fail' })
  }

  flag('Mint yetkisi bırakılmış', bool(pick(security, 'renounced_mint')), t.requireMintRenounced)
  flag('Freeze yetkisi bırakılmış', bool(pick(security, 'renounced_freeze_account')), t.requireFreezeRenounced)

  const rug = num(pick(security, 'rug_ratio')) ?? num(pick(info, 'rug_ratio')) ?? num(pick(info, 'stat.rug_ratio'))
  max('Rug riski', rug, t.maxRugRatio, (n) => n.toFixed(2))

  const top10 = num(pick(info, 'stat.top_10_holder_rate')) ?? num(pick(info, 'dev.top_10_holder_rate'))
  max('Top 10 holder', top10, t.maxTop10Rate, pct)

  max('Dev ekip payı', num(pick(info, 'stat.dev_team_hold_rate')), t.maxDevTeamRate, pct)
  max('Dev önceki token sayısı', num(pick(info, 'dev.creator_open_count')), t.maxCreatorLaunches, (n) => String(n))

  const tax = Math.max(num(pick(security, 'buy_tax')) ?? 0, num(pick(security, 'sell_tax')) ?? 0)
  max('Alım/satım vergisi', tax, t.maxTax, pct)

  const result: Verdict = items.some((i) => i.verdict === 'fail')
    ? 'fail'
    : items.some((i) => i.verdict === 'warn')
      ? 'warn'
      : 'pass'
  return { result, items }
}
