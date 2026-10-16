// Ayarlar v2: ücret preset'leri, tema, kısayollar, CSV (motor ve arayüz ortak).

import type { RuleLimits } from './rules'

export type PresetSlot = 1 | 2 | 3
export type PresetKind = 'buy' | 'sell' | 'deploy'

export interface FeePreset {
  slot: PresetSlot
  kind: PresetKind
  priorityFeeSol: number
  tipFeeSol: number
  slippage: number | 'auto'
  antiMev: boolean
}

export interface FeePresetRow {
  slot: number
  kind: string
  priority_sol: number | string
  tip_sol: number | string
  slippage: number | string | null
  anti_mev: boolean
}

export function presetFromRow(r: FeePresetRow): FeePreset {
  return {
    slot: Number(r.slot) as PresetSlot,
    kind: r.kind as PresetKind,
    priorityFeeSol: Number(r.priority_sol),
    tipFeeSol: Number(r.tip_sol),
    slippage: r.slippage == null ? 'auto' : Number(r.slippage),
    antiMev: r.anti_mev
  }
}

export function presetToRow(p: FeePreset) {
  return {
    slot: p.slot,
    kind: p.kind,
    priority_sol: p.priorityFeeSol,
    tip_sol: p.tipFeeSol,
    slippage: p.slippage === 'auto' ? null : p.slippage,
    anti_mev: p.antiMev
  }
}

// Kayıtlı preset yoksa: P1 = kuraldaki eski tek ücret seti, P2/P3 daha hızlı (daha yüksek ücret)
export function defaultPreset(slot: PresetSlot, kind: PresetKind, limits: Pick<RuleLimits, 'priorityFeeSol' | 'tipFeeSol' | 'slippage' | 'antiMev'>): FeePreset {
  const k = slot === 1 ? 1 : slot === 2 ? 3 : 10
  return {
    slot,
    kind,
    priorityFeeSol: +(limits.priorityFeeSol * k).toFixed(6),
    tipFeeSol: +(limits.tipFeeSol * k).toFixed(6),
    slippage: limits.slippage,
    antiMev: limits.antiMev
  }
}

export function resolvePreset(
  presets: FeePreset[],
  slot: PresetSlot,
  kind: PresetKind,
  limits: Pick<RuleLimits, 'priorityFeeSol' | 'tipFeeSol' | 'slippage' | 'antiMev'>
): FeePreset {
  return presets.find((p) => p.slot === slot && p.kind === kind) ?? defaultPreset(slot, kind, limits)
}

// ------------------------------------------------------------------ tema
export interface ThemeColors {
  bg: string
  surface: string // kartlar
  accent: string // birincil buton
  text: string
  muted: string
  border: string
}

export const THEMES: Record<string, { label: string; colors: ThemeColors }> = {
  default: { label: 'Varsayılan', colors: { bg: '#0b0b0c', surface: '#121214', accent: '#f2f2f3', text: '#e6e6e8', muted: '#8b8b92', border: '#26262a' } },
  slate: { label: 'Slate', colors: { bg: '#0d1117', surface: '#151b23', accent: '#e6edf3', text: '#e6edf3', muted: '#8b949e', border: '#262f3a' } },
  midnight: { label: 'Midnight', colors: { bg: '#07070d', surface: '#0f0f19', accent: '#e8e8f0', text: '#e2e2ea', muted: '#83839a', border: '#22222f' } },
  graphite: { label: 'Grafit', colors: { bg: '#161616', surface: '#1e1e1e', accent: '#f0f0f0', text: '#e8e8e8', muted: '#949494', border: '#303030' } },
  light: { label: 'Açık', colors: { bg: '#f6f6f7', surface: '#ffffff', accent: '#18181b', text: '#18181b', muted: '#6b6b73', border: '#e2e2e6' } }
}

export interface ThemeSetting {
  preset: string // THEMES anahtarı ya da 'custom'
  colors?: Partial<ThemeColors>
}

export const HEX = /^#[0-9a-fA-F]{6}$/

export function themeColors(t: ThemeSetting | null | undefined): ThemeColors {
  const base = THEMES[t?.preset ?? 'default']?.colors ?? THEMES.default.colors
  if (t?.preset !== 'custom') return base
  const out = { ...THEMES.default.colors }
  for (const k of Object.keys(out) as (keyof ThemeColors)[]) {
    const v = t.colors?.[k]
    if (v && HEX.test(v)) out[k] = v
  }
  return out
}

/** Açık zemin mi? (renk şeması ve buton metni için) */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150
}

// ------------------------------------------------------------------ kısayollar
export const KEY_ACTIONS = {
  preset1: 'Ücret preset 1',
  preset2: 'Ücret preset 2',
  preset3: 'Ücret preset 3',
  feed: 'Canlı Akış',
  approvals: 'Onay Bekleyenler',
  positions: 'Pozisyonlar',
  deploy: 'Deploy formu'
} as const

export type KeyAction = keyof typeof KEY_ACTIONS

export const DEFAULT_KEYBINDS: Record<KeyAction, string> = {
  preset1: 'F1',
  preset2: 'F2',
  preset3: 'F3',
  feed: 'Alt+1',
  approvals: 'Alt+2',
  positions: 'Alt+3',
  deploy: 'Alt+D'
}

/** Klavye olayını "Ctrl+Shift+K" biçimine çevirir. Sadece değiştirici tuş basıldıysa null. */
export function keyCombo(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+')
}

// ------------------------------------------------------------------ CSV
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n')
}

/** Basit CSV okuyucu: tırnaklı alanlar, virgül ya da noktalı virgül ayırıcı, ilk satır başlık. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = []
  const sep = (text.split('\n')[0] ?? '').includes(';') && !(text.split('\n')[0] ?? '').includes(',') ? ';' : ','
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) lines.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) lines.push(row)
  const [head, ...body] = lines
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
