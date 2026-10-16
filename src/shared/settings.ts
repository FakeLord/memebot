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

// Anahtarlar kullanıcı ayarında saklanır: var olanları (default, slate, midnight, graphite, light) silmeyin.
export const THEMES: Record<string, { label: string; colors: ThemeColors }> = {
  discord: { label: 'Discord', colors: { bg: '#313338', surface: '#2b2d31', accent: '#5865f2', text: '#f2f3f5', muted: '#949ba4', border: '#3f4147' } },
  default: { label: 'Koyu', colors: { bg: '#111113', surface: '#1a1a1d', accent: '#5865f2', text: '#ececf1', muted: '#8e8e99', border: '#2a2a2f' } },
  slate: { label: 'Slate', colors: { bg: '#0f1318', surface: '#171c23', accent: '#8b9bb4', text: '#e6edf3', muted: '#8b949e', border: '#262f3a' } },
  monkeytype: { label: 'MonkeyType', colors: { bg: '#323437', surface: '#2c2e31', accent: '#e2b714', text: '#d1d0c5', muted: '#7e8084', border: '#3d3f43' } },
  graphite: { label: 'Modern Koyu', colors: { bg: '#0a0a0a', surface: '#151515', accent: '#3b82f6', text: '#ededed', muted: '#8f8f8f', border: '#262626' } },
  midnight: { label: 'Gece Mavisi', colors: { bg: '#0a0f1f', surface: '#111a33', accent: '#4f6bff', text: '#e3e8ff', muted: '#8590b8', border: '#1f2a4a' } },
  dusk: { label: 'Alacakaranlık', colors: { bg: '#1c1a22', surface: '#26232d', accent: '#e0727f', text: '#ece8f0', muted: '#958fa0', border: '#35313e' } },
  sunset: { label: 'Gün batımı', colors: { bg: '#221b33', surface: '#2d2443', accent: '#7c6cf0', text: '#f0ecff', muted: '#a399c4', border: '#3d3359' } },
  purple: { label: 'Mor', colors: { bg: '#18121f', surface: '#22192c', accent: '#a855f7', text: '#f0e9fa', muted: '#9d8fae', border: '#33263f' } },
  forest: { label: 'Orman', colors: { bg: '#0e1712', surface: '#14211a', accent: '#22c55e', text: '#e6f2ea', muted: '#86a090', border: '#213428' } },
  crimson: { label: 'Kızıl', colors: { bg: '#180e10', surface: '#231416', accent: '#ef4444', text: '#f5e8e9', muted: '#a88d90', border: '#3a2226' } },
  cyan: { label: 'Camgöbeği', colors: { bg: '#0c171a', surface: '#112126', accent: '#06b6d4', text: '#e4f4f7', muted: '#83a3aa', border: '#1d343a' } },
  gold: { label: 'Altın', colors: { bg: '#17140b', surface: '#221d10', accent: '#eab308', text: '#f5efdc', muted: '#a89c7c', border: '#382f19' } },
  orange: { label: 'Turuncu', colors: { bg: '#18110b', surface: '#241910', accent: '#f97316', text: '#f7ece2', muted: '#a8907c', border: '#3a2819' } },
  pink: { label: 'Pembe', colors: { bg: '#190e15', surface: '#24141e', accent: '#ec4899', text: '#f7e6f0', muted: '#a88b9b', border: '#3a2231' } },
  mint: { label: 'Nane', colors: { bg: '#0d1714', surface: '#13221d', accent: '#34d399', text: '#e3f5ee', muted: '#82a598', border: '#1f362e' } },
  lavender: { label: 'Lavanta', colors: { bg: '#16141d', surface: '#1f1c29', accent: '#a78bfa', text: '#eeeaf8', muted: '#9a93b0', border: '#302b40' } },
  light: { label: 'Açık', colors: { bg: '#f4f4f6', surface: '#ffffff', accent: '#5865f2', text: '#18181b', muted: '#6b6b73', border: '#e2e2e6' } }
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
