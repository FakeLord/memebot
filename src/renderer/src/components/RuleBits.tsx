import { useState } from 'react'
import { ChevronDown, ChevronUp, Coins, Pencil, Percent, Shield, ShieldCheck, ShieldOff, Trash2, Zap } from 'lucide-react'
import { usePrefs } from '../lib/prefs'
import { canTrade, useAuth } from '../lib/auth'
import { UnitInput, Toggle } from './ui'
import type { RuleDraft } from '../lib/ruleDraft'
import type { FeePreset, PresetKind, PresetSlot } from '../../../shared/settings'
import type { ConditionOrder } from '../../../shared/types'
import type { SafetyThresholds } from '../../../shared/safety'

// GMGN emir panosu dilinde kural parçaları: hızlı tutar ızgarası, ücret preset tablosu, TP/SL listesi, güvenlik filtresi.

const num = (v: string) => Number(v.replace(',', '.'))

/** Hızlı tutar ızgarası: görüntüleme modunda düğmeler, kalemle düzenleme moduna geçer. */
export function QuickGrid({
  values,
  slots = 4,
  suffix,
  onChange,
  editable
}: {
  values: number[]
  slots?: number
  suffix?: string
  onChange: (v: number[]) => void
  editable: boolean
}) {
  const [edit, setEdit] = useState(false)
  const cells = Array.from({ length: slots }, (_, i) => values[i])
  const set = (i: number, raw: string) => {
    const n = num(raw)
    const next = [...cells]
    next[i] = Number.isFinite(n) && n > 0 ? n : 0
    onChange(next.map((x) => x ?? 0))
  }
  return (
    <div className="gm-grid">
      {cells.map((v, i) =>
        edit ? (
          <span key={i} className="gm-cell edit">
            <input
              inputMode="decimal"
              defaultValue={v ? String(v) : ''}
              placeholder="—"
              onBlur={(e) => set(i, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </span>
        ) : (
          <span key={i} className="gm-cell">
            {v ? `${v}${suffix ?? ''}` : <span className="faint">—</span>}
          </span>
        )
      )}
      {editable && (
        <button className={`gm-cell icon ${edit ? 'on' : ''}`} title={edit ? 'Düzenlemeyi bitir' : 'Tutarları düzenle'} onClick={() => setEdit((x) => !x)}>
          <Pencil size={13} />
        </button>
      )}
    </div>
  )
}

/** Kurallar sayfası: 8 yuvalı tutar düzenleyici (GMGN "Buttons Presets"). */
export function SlotGrid({ values, unit, onChange, max }: { values: number[]; unit: string; onChange: (v: number[]) => void; max?: number }) {
  const cells = Array.from({ length: 8 }, (_, i) => values[i] ?? 0)
  return (
    <div className="slot-grid">
      {cells.map((v, i) => (
        <UnitInput
          key={i}
          value={v || ''}
          unit={unit}
          max={max}
          placeholder="—"
          onChange={(n) => onChange(cells.map((x, j) => (j === i ? n : x)))}
        />
      ))}
    </div>
  )
}

/** Alt satır: etkin preset'in ücret özeti; tıklanınca alt çubuktaki Ücret paneli açılır. */
export function FeeSummary({ kind, slot }: { kind: PresetKind; slot: PresetSlot }) {
  const { preset } = usePrefs()
  const f = preset(slot, kind)
  return (
    <button className="gm-foot" title="Ücretleri düzenle" onClick={() => window.dispatchEvent(new CustomEvent('memebot:panel', { detail: 'fees' }))}>
      <span>
        <Percent size={11} /> {f.slippage === 'auto' ? 'Oto' : `${f.slippage}`}
      </span>
      <span>
        <Zap size={11} /> {f.priorityFeeSol}
      </span>
      <span>
        <Coins size={11} /> {f.tipFeeSol}
      </span>
      <span>
        {f.antiMev ? <ShieldCheck size={11} /> : <ShieldOff size={11} />} {f.antiMev ? 'MEV' : 'MEV yok'}
      </span>
      <span style={{ marginLeft: 'auto' }}>P{slot}</span>
    </button>
  )
}

/** Ücret preset tablosu (P1–P3 × alım ya da satış): slippage, öncelik, bribe, anti-MEV. Alandan çıkınca kaydedilir. */
export function FeeTable({ kind }: { kind: PresetKind }) {
  const { profile } = useAuth()
  const { preset, savePreset, activePreset } = usePrefs()
  const [error, setError] = useState<string | null>(null)
  const editable = canTrade(profile?.role)

  const save = async (p: FeePreset) => {
    if (p.priorityFeeSol > 0.1 || p.tipFeeSol > 0.1) return setError('Öncelik ve bribe en fazla 0.1 SOL olabilir.')
    setError(null)
    const e = await savePreset(p)
    if (e) setError(e)
  }

  return (
    <div>
      <div className="fee-table">
        <div className="fee-tr fee-th">
          <div />
          <div>Slippage</div>
          <div>
            Öncelik / Bribe <span className="faint">maks. 0.1 SOL</span>
          </div>
          <div>MEV</div>
        </div>
        {([1, 2, 3] as PresetSlot[]).map((s) => {
          const p = preset(s, kind)
          const auto = p.slippage === 'auto'
          return (
            <div key={s} className="fee-tr">
              <div className={`fee-p ${activePreset === s ? 'on' : ''}`} title={activePreset === s ? 'Etkin preset' : undefined}>
                P{s}
              </div>
              <div>
                <UnitInput value={auto ? '' : p.slippage} unit="%" min={1} max={100} disabled={!editable || auto} placeholder="oto" onChange={(n) => save({ ...p, slippage: n })} />
                <label className="check" title="Otomatik slippage">
                  <input type="checkbox" disabled={!editable} checked={auto} onChange={(e) => save({ ...p, slippage: e.target.checked ? 'auto' : 30 })} />
                  Oto
                </label>
              </div>
              <div>
                <UnitInput value={p.priorityFeeSol} unit="SOL" disabled={!editable} onChange={(n) => save({ ...p, priorityFeeSol: n })} />
                <UnitInput value={p.tipFeeSol} unit="SOL" disabled={!editable} onChange={(n) => save({ ...p, tipFeeSol: n })} />
              </div>
              <div>
                <span className="mev">
                  <button className={!p.antiMev ? 'on' : ''} title="Anti-MEV kapalı" disabled={!editable} onClick={() => save({ ...p, antiMev: false })}>
                    <ShieldOff size={13} />
                  </button>
                  <button className={p.antiMev ? 'on' : ''} title="Anti-MEV açık" disabled={!editable} onClick={() => save({ ...p, antiMev: true })}>
                    <Shield size={13} />
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className="notice error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  )
}

const TPSL_TYPES: { value: ConditionOrder['order_type']; label: string; scale: string }[] = [
  { value: 'profit_stop', label: 'Kâr al', scale: 'Artış' },
  { value: 'loss_stop', label: 'Zarar durdur', scale: 'Düşüş' },
  { value: 'profit_stop_trace', label: 'İz süren kâr al', scale: 'Devreye girme' },
  { value: 'loss_stop_trace', label: 'İz süren zarar durdur', scale: 'Düşüş' }
]

/** TP/SL koşulları (alımla birlikte GMGN'de kurulur). compact = mini pano. */
export function TpSlList({ d, compact }: { d: RuleDraft; compact?: boolean }) {
  const rows = d.draft.tpSl
  const setRow = (i: number, patch: Partial<ConditionOrder>) => d.setTpSl((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className={compact ? 'gm-scroll' : 'stack'} style={compact ? undefined : { gap: 4 }}>
      {rows.map((row, i) => {
        const t = TPSL_TYPES.find((x) => x.value === row.order_type) ?? TPSL_TYPES[0]
        const trace = row.order_type.endsWith('_trace')
        return (
          <div key={i} className={compact ? 'gm-tpsl' : 'tpsl-row'}>
            <select className={compact ? undefined : 'input-sm'} value={row.order_type} onChange={(e) => setRow(i, { order_type: e.target.value as ConditionOrder['order_type'] })}>
              {TPSL_TYPES.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            {!compact && <span className="tpsl-field">{t.scale}</span>}
            <UnitInput value={row.price_scale ?? ''} unit="%" onChange={(v) => setRow(i, { price_scale: v ? String(v) : undefined })} />
            {trace && (
              <>
                {!compact && <span className="tpsl-field">Geri çekilme</span>}
                <UnitInput value={row.drawdown_rate ?? ''} unit="%" max={100} onChange={(v) => setRow(i, { drawdown_rate: v ? String(v) : undefined })} />
              </>
            )}
            <span className="tpsl-field">sat</span>
            <UnitInput value={row.sell_ratio} unit="%" min={1} max={100} onChange={(v) => setRow(i, { sell_ratio: String(v) })} />
            <span className="spacer" />
            <button className="icon-btn sm danger" title="Koşulu sil" onClick={() => d.setTpSl((r) => r.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
      {rows.length === 0 && (
        <p className="faint" style={{ fontSize: 11.5 }}>
          Koşul yok. Hepsini silip kaydederseniz varsayılan iki koşul (kâr al %100 → %50 sat, zarar durdur %40 → hepsini sat) geri gelir.
        </p>
      )}
    </div>
  )
}

type NumKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends number ? K : never }[keyof SafetyThresholds]
type BoolKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends boolean ? K : never }[keyof SafetyThresholds]

export const SAFETY_NUM: { key: NumKey; label: string; percent?: boolean; unit?: string }[] = [
  { key: 'maxRugRatio', label: 'Maks. rug riski', unit: '0–1' },
  { key: 'maxTop10Rate', label: 'Maks. top 10 holder', percent: true },
  { key: 'maxDevTeamRate', label: 'Maks. dev ekip payı', percent: true },
  { key: 'maxInsiderRate', label: 'Maks. insider payı', percent: true },
  { key: 'maxBundlerRate', label: 'Maks. bundler hacmi', percent: true },
  { key: 'maxTax', label: 'Maks. vergi', percent: true },
  { key: 'maxCreatorLaunches', label: 'Dev önceki token', unit: 'adet' },
  { key: 'minLiquidityUsd', label: 'Min. likidite', unit: '$' },
  { key: 'minMcapUsd', label: 'Min. piyasa değeri', unit: '$' },
  { key: 'maxMcapUsd', label: 'Maks. piyasa değeri', unit: '$' }
]

export const SAFETY_BOOL: { key: BoolKey; label: string }[] = [
  { key: 'requireMintRenounced', label: 'Mint yetkisi bırakılmış' },
  { key: 'requireFreezeRenounced', label: 'Freeze yetkisi bırakılmış' },
  { key: 'rejectWashTrading', label: 'Wash trading reddet' }
]

/** Mini pano için sıkışık güvenlik filtresi. */
export function SafetyCompact({ d }: { d: RuleDraft }) {
  const t = d.draft.thresholds
  return (
    <div className="gm-scroll">
      {SAFETY_BOOL.map((f) => (
        <div key={f.key} className="gm-line">
          {f.label}
          <Toggle checked={t[f.key]} onChange={(v) => d.setT(f.key, v)} />
        </div>
      ))}
      <div className="gm-line">
        UYARI'lılar da onaya düşsün
        <Toggle checked={d.draft.limits.allowWarn} onChange={(v) => d.setL('allowWarn', v)} />
      </div>
      {SAFETY_NUM.map((f) => (
        <div key={f.key} className="gm-line">
          {f.label}
          <UnitInput
            value={f.percent ? +(t[f.key] * 100).toFixed(2) : t[f.key]}
            unit={f.percent ? '%' : f.unit}
            max={f.percent ? 100 : undefined}
            onChange={(n) => d.setT(f.key, f.percent ? n / 100 : n)}
          />
        </div>
      ))}
    </div>
  )
}

/** Açılır kapanır alt bölüm (GMGN "Advanced Trading Strategy" satırı gibi). */
export function Expander({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button className="gm-toggle-line" onClick={onToggle}>
      {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      {label}
    </button>
  )
}
