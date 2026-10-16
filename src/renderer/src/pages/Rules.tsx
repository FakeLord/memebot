import { useEffect, useState } from 'react'
import { canTrade, useAuth } from '../lib/auth'
import { DEFAULT_RULE, usePipeline, type Rule, type TradeMode } from '../lib/pipeline'
import type { SafetyThresholds } from '../../../shared/safety'

type NumKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends number ? K : never }[keyof SafetyThresholds]
type BoolKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends boolean ? K : never }[keyof SafetyThresholds]

// Oranlar arayüzde yüzde olarak gösterilir, veritabanında 0–1 olarak saklanır.
const NUM_FIELDS: { key: NumKey; label: string; percent?: boolean; hint?: string }[] = [
  { key: 'maxRugRatio', label: 'Maks. rug riski (0–1)' },
  { key: 'maxTop10Rate', label: 'Maks. top 10 holder', percent: true },
  { key: 'maxDevTeamRate', label: 'Maks. dev ekip payı', percent: true },
  { key: 'maxInsiderRate', label: 'Maks. insider payı', percent: true },
  { key: 'maxBundlerRate', label: 'Maks. bundler hacmi', percent: true },
  { key: 'maxTax', label: 'Maks. alım/satım vergisi', percent: true },
  { key: 'maxCreatorLaunches', label: 'Dev en fazla kaç token çıkarmış olabilir' },
  { key: 'minLiquidityUsd', label: 'Min. likidite ($)', hint: '0 = kapalı' },
  { key: 'minMcapUsd', label: 'Min. piyasa değeri ($)', hint: '0 = kapalı' },
  { key: 'maxMcapUsd', label: 'Maks. piyasa değeri ($)', hint: '0 = kapalı' }
]

const BOOL_FIELDS: { key: BoolKey; label: string }[] = [
  { key: 'requireMintRenounced', label: 'Mint yetkisi bırakılmış olmalı' },
  { key: 'requireFreezeRenounced', label: 'Freeze yetkisi bırakılmış olmalı' },
  { key: 'rejectWashTrading', label: 'Wash trading varsa reddet' }
]

const MODES: { value: TradeMode; label: string; hint: string; disabled?: boolean }[] = [
  { value: 'watch', label: 'Sadece izle', hint: 'Sinyaller kontrol edilir, onaya düşmez.' },
  { value: 'manual', label: 'Manuel onay', hint: 'Güvenlikten geçenler Onay Bekleyenler ekranına düşer.' },
  { value: 'auto', label: 'Otomatik', hint: 'Faz 5 ile gelecek.', disabled: true }
]

export function RulesPage() {
  const { profile } = useAuth()
  const { rule, saveRule } = usePipeline()
  const [draft, setDraft] = useState<Rule>(rule)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const editable = canTrade(profile?.role)

  useEffect(() => setDraft(rule), [rule])

  const setT = <K extends keyof SafetyThresholds>(k: K, v: SafetyThresholds[K]) =>
    setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [k]: v } }))

  const save = async () => {
    const presets = draft.limits.buyPresetsSol.filter((n) => n > 0)
    if (!presets.length) return setMsg({ kind: 'error', text: 'En az bir alım tutarı girin.' })
    const err = await saveRule({ ...draft, limits: { ...draft.limits, buyPresetsSol: presets } })
    setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: 'Kurallar kaydedildi; yeni sinyallere hemen uygulanır.' })
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {!editable && <div className="notice">Asistan rolü kuralları görüntüleyebilir, değiştiremez.</div>}
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card stack">
          <h2>Mod</h2>
          {MODES.map((m) => (
            <label key={m.value} className="row" style={{ color: m.disabled ? 'var(--faint)' : 'var(--text)', fontSize: 13 }}>
              <input
                type="radio"
                name="mode"
                disabled={m.disabled}
                checked={draft.mode === m.value}
                onChange={() => setDraft((d) => ({ ...d, mode: m.value }))}
              />
              <span>{m.label}</span>
              <span className="faint">— {m.hint}</span>
            </label>
          ))}
        </div>

        <div className="card stack">
          <h2>Güvenlik eşikleri</h2>
          {BOOL_FIELDS.map((f) => (
            <label key={f.key} className="row" style={{ color: 'var(--text)', fontSize: 13 }}>
              <input type="checkbox" checked={draft.thresholds[f.key]} onChange={(e) => setT(f.key, e.target.checked)} />
              {f.label}
            </label>
          ))}
          <div className="grid-2">
            {NUM_FIELDS.map((f) => {
              const v = draft.thresholds[f.key]
              return (
                <label key={f.key}>
                  {f.label}
                  {f.percent ? ' (%)' : ''}
                  {f.hint && <span className="faint"> · {f.hint}</span>}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={f.percent ? +(v * 100).toFixed(2) : v}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n) && n >= 0) setT(f.key, f.percent ? n / 100 : n)
                    }}
                  />
                </label>
              )
            })}
          </div>
          <label className="row" style={{ color: 'var(--text)', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={draft.limits.allowWarn}
              onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, allowWarn: e.target.checked } }))}
            />
            Verisi eksik olan (UYARI) token'lar da onaya düşsün
          </label>
        </div>

        <div className="card stack">
          <h2>Onay ve tutarlar</h2>
          <div className="grid-2">
            <label>
              Onay bekleme süresi (dk)
              <input
                type="number"
                min={1}
                max={120}
                value={draft.limits.approvalTtlMin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, limits: { ...d.limits, approvalTtlMin: Math.min(120, Math.max(1, Number(e.target.value) || 1)) } }))
                }
              />
            </label>
            <label>
              İşlem başı maks. tutar (SOL)
              <input
                type="number"
                min={0}
                step="any"
                value={draft.limits.maxBuySol}
                onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, maxBuySol: Math.max(0, Number(e.target.value) || 0) } }))}
              />
            </label>
            <label>
              Hızlı alım tutarları (SOL, virgülle)
              <input
                defaultValue={draft.limits.buyPresetsSol.join(', ')}
                key={draft.limits.buyPresetsSol.join(',')}
                onBlur={(e) =>
                  setDraft((d) => ({
                    ...d,
                    limits: {
                      ...d.limits,
                      buyPresetsSol: e.target.value
                        .split(',')
                        .map((s) => Number(s.trim().replace(',', '.')))
                        .filter((n) => Number.isFinite(n) && n > 0)
                        .slice(0, 5)
                    }
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={save}>
            Kaydet
          </button>
          <button className="btn" onClick={() => setDraft(DEFAULT_RULE)}>
            Varsayılanlara dön
          </button>
        </div>
      </fieldset>
    </div>
  )
}
