import { useEffect, useState } from 'react'
import { canTrade, useAuth } from '../lib/auth'
import { DEFAULT_RULE, usePipeline, type Rule, type RuleLimits, type TradeMode } from '../lib/pipeline'
import type { SafetyThresholds } from '../../../shared/safety'
import type { ConditionOrder } from '../../../shared/types'

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
  { value: 'auto', label: 'Otomatik', hint: 'Güvenlikten geçenler onaysız alınır; limitler ve günlük zarar sınırı geçerli.' }
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
    if (draft.mode === 'auto' && !(draft.limits.autoBuySol > 0 && draft.limits.autoBuySol <= draft.limits.maxBuySol))
      return setMsg({ kind: 'error', text: "Otomatik alım tutarı 0'dan büyük ve işlem başı maks. tutardan küçük olmalı." })
    for (const r of draft.tpSl) {
      const ratio = Number(r.sell_ratio)
      if (!(ratio >= 1 && ratio <= 100)) return setMsg({ kind: 'error', text: 'TP/SL satış oranı 1–100 olmalı.' })
      if (r.order_type !== 'loss_stop_trace' && !(Number(r.price_scale) > 0))
        return setMsg({ kind: 'error', text: 'TP/SL satırlarında fiyat yüzdesi zorunlu.' })
      if (r.order_type === 'loss_stop' && Number(r.price_scale) >= 100)
        return setMsg({ kind: 'error', text: "Zarar durdur düşüşü %100'den küçük olmalı." })
      if (r.order_type.endsWith('_trace') && !(Number(r.drawdown_rate) > 0 && Number(r.drawdown_rate) <= 100))
        return setMsg({ kind: 'error', text: 'İz süren koşullarda geri çekilme yüzdesi zorunlu.' })
    }
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
                onChange={() => {
                  if (
                    m.value === 'auto' &&
                    !confirm(
                      draft.limits.liveTrading
                        ? 'Otomatik + GERÇEK işlem: güvenlikten geçen her token için onay sormadan gerçek SOL harcanacak. Emin misiniz?'
                        : 'Otomatik mod deneme modunda çalışacak (para harcanmaz). Devam?'
                    )
                  )
                    return
                  setDraft((d) => ({ ...d, mode: m.value }))
                }}
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

        <TradingCard draft={draft} setDraft={setDraft} />

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

const TPSL_TYPES: { value: ConditionOrder['order_type']; label: string; scaleLabel: string }[] = [
  { value: 'profit_stop', label: 'Kâr al', scaleLabel: 'Giriş fiyatından artış %' },
  { value: 'loss_stop', label: 'Zarar durdur', scaleLabel: 'Giriş fiyatından düşüş %' },
  { value: 'profit_stop_trace', label: 'İz süren kâr al', scaleLabel: 'Devreye girme artışı %' },
  { value: 'loss_stop_trace', label: 'İz süren zarar durdur', scaleLabel: 'Düşüş % (isteğe bağlı)' }
]

function TradingCard({ draft, setDraft }: { draft: Rule; setDraft: React.Dispatch<React.SetStateAction<Rule>> }) {
  const l = draft.limits
  const setL = <K extends keyof RuleLimits>(k: K, v: RuleLimits[K]) => setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: v } }))
  const setRow = (i: number, patch: Partial<ConditionOrder>) =>
    setDraft((d) => ({ ...d, tpSl: d.tpSl.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  const numIn = (v: string, min = 0) => Math.max(min, Number(v.replace(',', '.')) || 0)

  const toggleLive = (on: boolean) => {
    if (on && !confirm('Gerçek mod açılırsa onayladığınız token\'lar için GMGN cüzdanınızdan GERÇEK SOL harcanır. Emin misiniz?')) return
    setL('liveTrading', on)
  }

  return (
    <div className="card stack">
      <h2>İşlem</h2>
      <label className="row" style={{ color: 'var(--text)', fontSize: 13 }}>
        <input type="checkbox" checked={l.liveTrading} onChange={(e) => toggleLive(e.target.checked)} />
        <b>Gerçek işlem</b>
        <span className={l.liveTrading ? 'neg' : 'faint'}>
          {l.liveTrading ? '— onaylar gerçek SOL harcar' : '— kapalı: deneme modu, sadece GMGN fiyat teklifi alınır'}
        </span>
      </label>

      <p className="faint">Öncelik ücreti, tip, slippage ve anti-MEV artık Ayarlar → Ücret preset'leri (P1–P3) bölümünde.</p>
      <div className="grid-2">
        <label>
          Günlük maks. harcama (SOL)
          <input type="number" min={0} step="any" value={l.dailyMaxSol} onChange={(e) => setL('dailyMaxSol', numIn(e.target.value))} />
        </label>
        <label>
          Otomatik alım tutarı (SOL)
          <input type="number" min={0} step="any" value={l.autoBuySol} onChange={(e) => setL('autoBuySol', numIn(e.target.value))} />
        </label>
        <label>
          Günlük zarar sınırı (SOL) <span className="faint">· aşılınca otomatik mod kapanır</span>
          <input type="number" min={0} step="any" value={l.dailyLossLimitSol} onChange={(e) => setL('dailyLossLimitSol', numIn(e.target.value))} />
        </label>
        <label>
          Aynı anda maks. açık pozisyon
          <input type="number" min={1} max={50} value={l.maxOpenPositions} onChange={(e) => setL('maxOpenPositions', Math.round(numIn(e.target.value, 1)))} />
        </label>
      </div>

      <h2 style={{ marginTop: 8 }}>TP / SL (alımla birlikte GMGN'de kurulur)</h2>
      <p className="faint">
        Bilgisayar kapalıyken de GMGN tarafında çalışır. Satış oranı, tetiklendiği anda elde kalan miktarın yüzdesidir. Deneme modunda kurulmaz.
      </p>
      {draft.tpSl.map((row, i) => {
        const t = TPSL_TYPES.find((x) => x.value === row.order_type) ?? TPSL_TYPES[0]
        const trace = row.order_type.endsWith('_trace')
        return (
          <div key={i} className="row" style={{ alignItems: 'end' }}>
            <label style={{ flex: 1.3 }}>
              Tür
              <select value={row.order_type} onChange={(e) => setRow(i, { order_type: e.target.value as ConditionOrder['order_type'] })}>
                {TPSL_TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              {t.scaleLabel}
              <input type="number" min={1} value={row.price_scale ?? ''} onChange={(e) => setRow(i, { price_scale: e.target.value || undefined })} />
            </label>
            {trace && (
              <label style={{ flex: 1 }}>
                Zirveden geri çekilme %
                <input type="number" min={1} max={100} value={row.drawdown_rate ?? ''} onChange={(e) => setRow(i, { drawdown_rate: e.target.value || undefined })} />
              </label>
            )}
            <label style={{ flex: 1 }}>
              Satış oranı %
              <input type="number" min={1} max={100} value={row.sell_ratio} onChange={(e) => setRow(i, { sell_ratio: e.target.value })} />
            </label>
            <button className="btn btn-sm btn-danger" onClick={() => setDraft((d) => ({ ...d, tpSl: d.tpSl.filter((_, j) => j !== i) }))}>
              Sil
            </button>
          </div>
        )
      })}
      <div>
        <button
          className="btn btn-sm"
          disabled={draft.tpSl.length >= 10}
          onClick={() => setDraft((d) => ({ ...d, tpSl: [...d.tpSl, { order_type: 'profit_stop', side: 'sell', price_scale: '200', sell_ratio: '50' }] }))}
        >
          Koşul ekle
        </button>
      </div>
    </div>
  )
}
