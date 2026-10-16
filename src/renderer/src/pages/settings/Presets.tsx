import { useEffect, useState } from 'react'
import { canTrade, useAuth } from '../../lib/auth'
import { usePrefs } from '../../lib/prefs'
import { usePipeline } from '../../lib/pipeline'
import type { FeePreset, PresetKind, PresetSlot } from '../../../../shared/settings'

// Ücret preset'leri P1–P3 × Alım / Satım / Deploy. Etkin preset alt çubuktan ya da F1/F2/F3 ile değişir.

const KINDS: { kind: PresetKind; label: string }[] = [
  { kind: 'buy', label: 'Alım' },
  { kind: 'sell', label: 'Satım' },
  { kind: 'deploy', label: 'Deploy' }
]

export function PresetsSection() {
  const { profile } = useAuth()
  const { preset, presets, savePreset, resetPreset, activePreset, setActivePreset } = usePrefs()
  const { rule, saveRule } = usePipeline()
  const [slot, setSlot] = useState<PresetSlot>(activePreset)
  const [kind, setKind] = useState<PresetKind>('buy')
  const [draft, setDraft] = useState<FeePreset>(preset(slot, kind))
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const editable = canTrade(profile?.role)
  const saved = presets.some((p) => p.slot === slot && p.kind === kind)

  useEffect(() => setDraft(preset(slot, kind)), [slot, kind, preset])

  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0)

  const save = async () => {
    if (draft.priorityFeeSol > 0.1 || draft.tipFeeSol > 0.1) return setMsg({ kind: 'error', text: 'Ücretler en fazla 0.1 SOL olabilir.' })
    const err = await savePreset(draft)
    setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: `P${slot} ${KINDS.find((k) => k.kind === kind)!.label} kaydedildi.` })
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Etkin preset</h2>
        <p className="muted">
          Elle yaptığınız alım-satımlar etkin preset'in ücretleriyle gönderilir. Alt çubuktan ya da <span className="mono">F1 / F2 / F3</span> ile
          değiştirebilirsiniz.
        </p>
        <div className="row">
          {([1, 2, 3] as PresetSlot[]).map((s) => (
            <button key={s} className={`btn ${activePreset === s ? 'btn-primary' : ''}`} disabled={!editable} onClick={() => setActivePreset(s)}>
              P{s}
            </button>
          ))}
          <span className="faint" style={{ marginLeft: 12 }}>
            Otomatik mod:
          </span>
          <select
            value={rule.limits.autoPreset}
            disabled={!editable}
            onChange={(e) => saveRule({ ...rule, limits: { ...rule.limits, autoPreset: Number(e.target.value) as PresetSlot } })}
          >
            {[1, 2, 3].map((s) => (
              <option key={s} value={s}>
                P{s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            {([1, 2, 3] as PresetSlot[]).map((s) => (
              <button key={s} className="tab" aria-selected={slot === s} onClick={() => setSlot(s)}>
                Preset {s}
              </button>
            ))}
          </div>
          <div className="tabs" style={{ borderBottom: 0 }}>
            {KINDS.map((k) => (
              <button key={k.kind} className="tab" aria-selected={kind === k.kind} onClick={() => setKind(k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {!saved && <p className="faint">Kayıtlı değil — gösterilen değerler varsayılan (P1 = Kurallar'daki eski ücretler, P2 ×3, P3 ×10).</p>}
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <fieldset disabled={!editable} className="grid-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <label>
            Öncelik ücreti (SOL)
            <input type="number" min={0} step="any" value={draft.priorityFeeSol} onChange={(e) => setDraft({ ...draft, priorityFeeSol: num(e.target.value) })} />
          </label>
          <label>
            Tip / bribe (SOL)
            <input type="number" min={0} step="any" value={draft.tipFeeSol} onChange={(e) => setDraft({ ...draft, tipFeeSol: num(e.target.value) })} />
          </label>
          <label>
            Slippage (%)
            <div className="row">
              <input
                type="number"
                min={1}
                max={100}
                style={{ flex: 1 }}
                disabled={draft.slippage === 'auto'}
                value={draft.slippage === 'auto' ? '' : draft.slippage}
                onChange={(e) => setDraft({ ...draft, slippage: Math.min(100, Math.max(1, num(e.target.value))) })}
              />
              <label className="row check">
                <input type="checkbox" checked={draft.slippage === 'auto'} onChange={(e) => setDraft({ ...draft, slippage: e.target.checked ? 'auto' : 30 })} />
                Otomatik
              </label>
            </div>
          </label>
          <label className="row check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={draft.antiMev} onChange={(e) => setDraft({ ...draft, antiMev: e.target.checked })} />
            Anti-MEV koruması
          </label>
        </fieldset>
        <div className="row">
          <button className="btn btn-primary" disabled={!editable} onClick={save}>
            Kaydet
          </button>
          <button className="btn" disabled={!editable || !saved} onClick={() => resetPreset(slot, kind).then(() => setMsg({ kind: 'ok', text: 'Varsayılana döndü.' }))}>
            Varsayılana dön
          </button>
        </div>
        <p className="faint">GMGN SOL işlemlerinde öncelik ve tip ücreti en az 0.00001 SOL olarak gönderilir. Deploy preset'i token çıkarma formunda kullanılır.</p>
      </div>
    </div>
  )
}
