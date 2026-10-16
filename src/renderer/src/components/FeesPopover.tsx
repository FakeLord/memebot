import { useEffect, useState } from 'react'
import { Coins, ShieldCheck, Zap } from 'lucide-react'
import { Popover } from './StatusPanels'
import { canTrade, useAuth } from '../lib/auth'
import { usePrefs } from '../lib/prefs'
import { usePipeline } from '../lib/pipeline'
import { defaultPreset, type FeePreset, type PresetKind, type PresetSlot } from '../../../shared/settings'

// Alt çubuktaki "Ücret" popover'ı: P1–P3 × Deploy / Alım / Satım ücretleri.
// Preset sekmesine tıklamak o preset'i etkin yapar (F1/F2/F3 ile de değişir). Değerler alandan çıkınca kaydedilir.

const KINDS: { kind: PresetKind; label: string }[] = [
  { kind: 'deploy', label: 'Deploy' },
  { kind: 'buy', label: 'Alım' },
  { kind: 'sell', label: 'Satım' }
]

const MAX_FEE = 0.1

type Draft = { priority: string; tip: string; slippage: string; auto: boolean; antiMev: boolean }
const toDraft = (p: FeePreset): Draft => ({
  priority: String(p.priorityFeeSol),
  tip: String(p.tipFeeSol),
  slippage: p.slippage === 'auto' ? '' : String(p.slippage),
  auto: p.slippage === 'auto',
  antiMev: p.antiMev
})
const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0)

export function FeesPopover({ onClose, left }: { onClose: () => void; left: number }) {
  const { profile } = useAuth()
  const { preset, presets, savePreset, resetPreset, activePreset, setActivePreset } = usePrefs()
  const { rule, saveRule } = usePipeline()
  const [slot, setSlot] = useState<PresetSlot>(activePreset)
  const [kind, setKind] = useState<PresetKind>('deploy')
  const current = preset(slot, kind)
  const [draft, setDraft] = useState<Draft>(toDraft(current))
  const [error, setError] = useState<string | null>(null)
  const editable = canTrade(profile?.role)
  const saved = presets.some((p) => p.slot === slot && p.kind === kind)
  const defaults = defaultPreset(slot, kind, rule.limits)

  useEffect(() => setDraft(toDraft(current)), [slot, kind, current.priorityFeeSol, current.tipFeeSol, current.slippage, current.antiMev])

  const commit = async (d: Draft) => {
    if (!editable) return
    const next: FeePreset = {
      slot,
      kind,
      priorityFeeSol: num(d.priority),
      tipFeeSol: num(d.tip),
      slippage: d.auto ? 'auto' : Math.min(100, Math.max(1, num(d.slippage) || 1)),
      antiMev: d.antiMev
    }
    if (
      next.priorityFeeSol === current.priorityFeeSol &&
      next.tipFeeSol === current.tipFeeSol &&
      next.slippage === current.slippage &&
      next.antiMev === current.antiMev
    )
      return
    if (next.priorityFeeSol > MAX_FEE || next.tipFeeSol > MAX_FEE) {
      setError(`Ücretler en fazla ${MAX_FEE} SOL olabilir.`)
      setDraft(toDraft(current))
      return
    }
    setError(null)
    const err = await savePreset(next)
    if (err) setError(err)
  }

  const pickSlot = (s: PresetSlot) => {
    setSlot(s)
    if (editable) setActivePreset(s)
  }

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

  return (
    <Popover title="Ücretler" onClose={onClose} left={left}>

      <div className="seg seg-upper">
        {([1, 2, 3] as PresetSlot[]).map((s) => (
          <button key={s} className={`seg-btn ${slot === s ? 'on' : ''}`} onClick={() => pickSlot(s)} title={activePreset === s ? 'Etkin preset' : 'Etkin yap'}>
            Preset {s}
          </button>
        ))}
      </div>

      <div className="seg">
        {KINDS.map((k) => (
          <button key={k.kind} className={`seg-btn ${kind === k.kind ? 'on' : ''}`} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>

      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        <div className="fee-inputs">
          <label className="fee-field">
            <span className="fee-box">
              <input
                inputMode="decimal"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                onBlur={() => commit(draft)}
                onKeyDown={onEnter}
              />
              <span>SOL</span>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Zap size={11} /> Öncelik
            </span>
          </label>
          <label className="fee-field">
            <span className="fee-box">
              <input
                inputMode="decimal"
                value={draft.tip}
                onChange={(e) => setDraft({ ...draft, tip: e.target.value })}
                onBlur={() => commit(draft)}
                onKeyDown={onEnter}
              />
              <span>SOL</span>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Coins size={11} /> Bribe
            </span>
          </label>
        </div>

        <label className="fee-field">
          <span className="fee-box">
            <input
              inputMode="decimal"
              value={draft.auto ? '' : draft.slippage}
              placeholder={draft.auto ? 'otomatik' : ''}
              disabled={draft.auto}
              onChange={(e) => setDraft({ ...draft, slippage: e.target.value })}
              onBlur={() => commit(draft)}
              onKeyDown={onEnter}
            />
            <span style={{ marginRight: 8 }}>%</span>
            <button
              type="button"
              className={draft.auto ? 'on' : ''}
              onClick={() => {
                const d = { ...draft, auto: !draft.auto, slippage: draft.slippage || '30' }
                setDraft(d)
                commit(d)
              }}
            >
              Otomatik
            </button>
          </span>
          <span>Slippage</span>
        </label>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row muted" style={{ gap: 6, fontSize: 12 }}>
            <ShieldCheck size={13} /> Anti-MEV koruması
          </span>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={draft.antiMev}
            onClick={() => {
              const d = { ...draft, antiMev: !draft.antiMev }
              setDraft(d)
              commit(d)
            }}
          />
        </div>
      </fieldset>

      {error && <div className="notice error">{error}</div>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="faint" style={{ fontSize: 11 }}>
          Otomatik mod preset'i
        </span>
        <div className="seg" style={{ width: 120 }}>
          {([1, 2, 3] as PresetSlot[]).map((s) => (
            <button
              key={s}
              className={`seg-btn ${rule.limits.autoPreset === s ? 'on' : ''}`}
              disabled={!editable}
              onClick={() => saveRule({ ...rule, limits: { ...rule.limits, autoPreset: s } })}
            >
              P{s}
            </button>
          ))}
        </div>
      </div>

      <div className="popover-foot">
        <button className="btn btn-sm" disabled={!editable || !saved} onClick={() => resetPreset(slot, kind)}>
          Preset {slot} sıfırla
        </button>
        <span>
          Varsayılan: {defaults.priorityFeeSol} / {defaults.tipFeeSol} SOL
        </span>
      </div>
    </Popover>
  )
}
