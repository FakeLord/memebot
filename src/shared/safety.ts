// GMGN token/security + token/info yanıtlarından GEÇTİ / UYARI / RED kararı üretir.
// Eşikler kullanıcının kuralından (rules.thresholds) gelir; eksik alanlarda varsayılan kullanılır.
// Alan adları: github.com/GMGNAI/gmgn-skills → skills/gmgn-token/SKILL.md

export interface SafetyThresholds {
  requireMintRenounced: boolean
  requireFreezeRenounced: boolean
  maxRugRatio: number
  maxTop10Rate: number
  maxDevTeamRate: number
  maxInsiderRate: number
  maxBundlerRate: number
  maxCreatorLaunches: number
  maxTax: number
  rejectWashTrading: boolean
  minLiquidityUsd: number // 0 = kapalı
  minMcapUsd: number // 0 = kapalı
  maxMcapUsd: number // 0 = kapalı
}

export const DEFAULT_THRESHOLDS: SafetyThresholds = {
  requireMintRenounced: true,
  requireFreezeRenounced: true,
  maxRugRatio: 0.3,
  maxTop10Rate: 0.35,
  maxDevTeamRate: 0.1,
  maxInsiderRate: 0.2,
  maxBundlerRate: 0.5,
  maxCreatorLaunches: 20,
  maxTax: 0,
  rejectWashTrading: true,
  minLiquidityUsd: 5_000,
  minMcapUsd: 0,
  maxMcapUsd: 0
}

export function withDefaults(t: Partial<SafetyThresholds> | null | undefined): SafetyThresholds {
  return { ...DEFAULT_THRESHOLDS, ...(t ?? {}) }
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

export interface TokenSummary {
  name?: string
  symbol?: string
  priceUsd?: number
  mcapUsd?: number
  liquidityUsd?: number
  holders?: number
  launchpad?: string
  createdAt?: number // Unix saniye
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

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
export const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : `$${n.toFixed(0)}`

export function summarizeToken(info: unknown): TokenSummary {
  const priceUsd = num(pick(info, 'price.price')) ?? num(pick(info, 'price'))
  const supply = num(pick(info, 'circulating_supply')) ?? num(pick(info, 'total_supply'))
  return {
    name: str(pick(info, 'name')),
    symbol: str(pick(info, 'symbol')),
    priceUsd,
    mcapUsd: priceUsd !== undefined && supply !== undefined ? priceUsd * supply : undefined,
    liquidityUsd: num(pick(info, 'liquidity')) ?? num(pick(info, 'pool.liquidity')),
    holders: num(pick(info, 'holder_count')),
    launchpad: str(pick(info, 'launchpad_platform')) ?? str(pick(info, 'launchpad')),
    createdAt: num(pick(info, 'creation_timestamp'))
  }
}

export function evaluateSafety(security: unknown, info: unknown, thresholds?: Partial<SafetyThresholds> | null): SafetyReport {
  const t = withDefaults(thresholds)
  const items: SafetyCheckItem[] = []

  const flag = (label: string, value: boolean | undefined, required: boolean, good = true) => {
    if (!required) return
    if (value === undefined) items.push({ label, value: 'bilinmiyor', verdict: 'warn' })
    else items.push({ label, value: value ? 'evet' : 'hayır', verdict: value === good ? 'pass' : 'fail' })
  }

  const max = (label: string, value: number | undefined, limit: number, fmt: (n: number) => string) => {
    if (value === undefined) items.push({ label, value: 'bilinmiyor', verdict: 'warn' })
    else items.push({ label, value: fmt(value), verdict: value <= limit ? 'pass' : 'fail' })
  }

  const min = (label: string, value: number | undefined, limit: number, fmt: (n: number) => string) => {
    if (limit <= 0) return
    if (value === undefined) items.push({ label, value: 'bilinmiyor', verdict: 'warn' })
    else items.push({ label, value: fmt(value), verdict: value >= limit ? 'pass' : 'fail' })
  }

  const firstNum = (...paths: [unknown, string][]) => {
    for (const [o, p] of paths) {
      const v = num(pick(o, p))
      if (v !== undefined) return v
    }
    return undefined
  }

  flag('Mint yetkisi bırakılmış', bool(pick(security, 'renounced_mint')), t.requireMintRenounced)
  flag('Freeze yetkisi bırakılmış', bool(pick(security, 'renounced_freeze_account')), t.requireFreezeRenounced)
  flag('Wash trading', bool(pick(security, 'is_wash_trading')), t.rejectWashTrading, false)

  max('Rug riski', firstNum([security, 'rug_ratio'], [info, 'rug_ratio']), t.maxRugRatio, (n) => n.toFixed(2))
  max('Top 10 holder', firstNum([security, 'top_10_holder_rate'], [info, 'stat.top_10_holder_rate']), t.maxTop10Rate, pct)
  max('Dev ekip payı', firstNum([security, 'dev_team_hold_rate'], [info, 'stat.dev_team_hold_rate']), t.maxDevTeamRate, pct)
  max('Insider payı', firstNum([security, 'suspected_insider_hold_rate']), t.maxInsiderRate, pct)
  max(
    'Bundler hacmi',
    firstNum([security, 'bundler_trader_amount_rate'], [info, 'stat.top_bundler_trader_percentage']),
    t.maxBundlerRate,
    pct
  )
  max('Dev önceki token sayısı', firstNum([info, 'dev.creator_open_count']), t.maxCreatorLaunches, (n) => String(n))

  const tax = Math.max(num(pick(security, 'buy_tax')) ?? 0, num(pick(security, 'sell_tax')) ?? 0)
  max('Alım/satım vergisi', tax, t.maxTax, pct)

  const s = summarizeToken(info)
  min('Likidite', s.liquidityUsd, t.minLiquidityUsd, usd)
  min('Min. piyasa değeri', s.mcapUsd, t.minMcapUsd, usd)
  if (t.maxMcapUsd > 0) max('Maks. piyasa değeri', s.mcapUsd, t.maxMcapUsd, usd)

  const result: Verdict = items.some((i) => i.verdict === 'fail')
    ? 'fail'
    : items.some((i) => i.verdict === 'warn')
      ? 'warn'
      : 'pass'
  return { result, items }
}

export const VERDICT_LABEL: Record<Verdict, string> = { pass: 'GEÇTİ', warn: 'UYARI', fail: 'RED' }
