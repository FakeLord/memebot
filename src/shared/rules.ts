// Kullanıcı kuralı (rules tablosu): mod, güvenlik eşikleri, limitler, TP/SL.
// Arayüz düzenler, motor uygular. Eksik alanlar varsayılanla tamamlanır.

import { withDefaults, type SafetyThresholds } from './safety'
import type { ConditionOrder } from './types'

export type TradeMode = 'watch' | 'manual' | 'auto'

export interface RuleLimits {
  allowWarn: boolean // UYARI alanları da onaya düşsün mü
  approvalTtlMin: number // onay bekleme süresi
  buyPresetsSol: number[] // hızlı alım düğmeleri (en fazla 8)
  sellPresetsPct: number[] // hızlı satış düğmeleri, yüzde (en fazla 8)
  maxBuySol: number
  // --- işlem
  liveTrading: boolean // false = deneme modu: sadece GMGN teklifi alınır, para harcanmaz
  slippage: number | 'auto'
  priorityFeeSol: number
  tipFeeSol: number
  antiMev: boolean
  dailyMaxSol: number // gün içinde harcanabilecek toplam SOL (deneme ve gerçek ayrı sayılır)
  maxOpenPositions: number
  // --- otomatik mod
  autoBuySol: number // otomatik alım tutarı
  dailyLossLimitSol: number // bugünkü gerçekleşen zarar bunu aşarsa otomatik mod kendini kapatır
  // --- ücret preset'leri (fee_presets): elle işlemde etkin olan ve otomatik modun kullandığı
  activePreset: 1 | 2 | 3
  autoPreset: 1 | 2 | 3
}

export interface Rule {
  mode: TradeMode
  thresholds: SafetyThresholds
  limits: RuleLimits
  tpSl: ConditionOrder[] // alımla birlikte GMGN'de kurulan TP/SL
}

export const DEFAULT_LIMITS: RuleLimits = {
  allowWarn: false,
  approvalTtlMin: 10,
  buyPresetsSol: [0.1, 0.25, 0.5],
  sellPresetsPct: [25, 50, 100],
  maxBuySol: 1,
  liveTrading: false,
  slippage: 30,
  priorityFeeSol: 0.0005,
  tipFeeSol: 0.001,
  antiMev: true,
  dailyMaxSol: 2,
  maxOpenPositions: 5,
  autoBuySol: 0.05,
  dailyLossLimitSol: 0.5,
  activePreset: 1,
  autoPreset: 1
}

export const DEFAULT_TPSL: ConditionOrder[] = [
  { order_type: 'profit_stop', side: 'sell', price_scale: '100', sell_ratio: '50' },
  { order_type: 'loss_stop', side: 'sell', price_scale: '40', sell_ratio: '100' }
]

export const DEFAULT_RULE: Rule = { mode: 'manual', thresholds: withDefaults(null), limits: DEFAULT_LIMITS, tpSl: DEFAULT_TPSL }

export interface RuleRow {
  mode: string
  thresholds: unknown
  limits: unknown
  tp_sl_template: unknown
}

export function ruleFromRow(row: RuleRow | null | undefined): Rule {
  if (!row) return DEFAULT_RULE
  return {
    mode: (['watch', 'manual', 'auto'].includes(row.mode) ? row.mode : 'manual') as TradeMode,
    thresholds: withDefaults(row.thresholds as Partial<SafetyThresholds>),
    limits: { ...DEFAULT_LIMITS, ...((row.limits as Partial<RuleLimits>) ?? {}) },
    tpSl: Array.isArray(row.tp_sl_template) && row.tp_sl_template.length ? (row.tp_sl_template as ConditionOrder[]) : DEFAULT_TPSL
  }
}
