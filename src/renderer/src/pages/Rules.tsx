import { useEffect, useState } from 'react'
import { Bot, Eye, Hand, Plus, RotateCcw, Save, ShieldCheck, Target, Trash2, Zap } from 'lucide-react'
import { canTrade, useAuth } from '../lib/auth'
import { DEFAULT_RULE, usePipeline, type Rule, type RuleLimits, type TradeMode } from '../lib/pipeline'
import { Section, SettingRow, Toggle, UnitInput } from '../components/ui'
import type { SafetyThresholds } from '../../../shared/safety'
import type { ConditionOrder } from '../../../shared/types'

type NumKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends number ? K : never }[keyof SafetyThresholds]
type BoolKey = { [K in keyof SafetyThresholds]: SafetyThresholds[K] extends boolean ? K : never }[keyof SafetyThresholds]

// Oranlar arayüzde yüzde olarak gösterilir, veritabanında 0–1 olarak saklanır.
const NUM_FIELDS: { key: NumKey; label: string; desc: string; percent?: boolean; unit?: string }[] = [
  { key: 'maxRugRatio', label: 'Maks. rug riski', desc: 'GMGN rug skoru, 0–1 arası', unit: '0–1' },
  { key: 'maxTop10Rate', label: 'Maks. top 10 holder', desc: 'İlk 10 cüzdanın payı', percent: true },
  { key: 'maxDevTeamRate', label: 'Maks. dev ekip payı', desc: 'Geliştirici ve ekibinin payı', percent: true },
  { key: 'maxInsiderRate', label: 'Maks. insider payı', desc: 'İçeriden alanların payı', percent: true },
  { key: 'maxBundlerRate', label: 'Maks. bundler hacmi', desc: 'Paketlenmiş alımların payı', percent: true },
  { key: 'maxTax', label: 'Maks. alım/satım vergisi', desc: 'Token vergisi', percent: true },
  { key: 'maxCreatorLaunches', label: 'Dev en fazla kaç token çıkarmış', desc: 'Seri token çıkaranları eler', unit: 'adet' },
  { key: 'minLiquidityUsd', label: 'Min. likidite', desc: '0 = kapalı', unit: '$' },
  { key: 'minMcapUsd', label: 'Min. piyasa değeri', desc: '0 = kapalı', unit: '$' },
  { key: 'maxMcapUsd', label: 'Maks. piyasa değeri', desc: '0 = kapalı', unit: '$' }
]

const BOOL_FIELDS: { key: BoolKey; label: string; desc: string }[] = [
  { key: 'requireMintRenounced', label: 'Mint yetkisi bırakılmış olmalı', desc: 'Yeni token basılamasın' },
  { key: 'requireFreezeRenounced', label: 'Freeze yetkisi bırakılmış olmalı', desc: 'Cüzdanlar dondurulamasın' },
  { key: 'rejectWashTrading', label: 'Wash trading varsa reddet', desc: 'Sahte hacim işaretli token\'lar' }
]

const MODES: { value: TradeMode; label: string; hint: string; icon: typeof Eye }[] = [
  { value: 'watch', label: 'Sadece izle', hint: 'Sinyaller kontrol edilir, onaya düşmez.', icon: Eye },
  { value: 'manual', label: 'Manuel onay', hint: 'Güvenlikten geçenler Onay Bekleyenler ekranına düşer.', icon: Hand },
  { value: 'auto', label: 'Otomatik', hint: 'Güvenlikten geçenler onaysız alınır; limitler ve günlük zarar sınırı geçerli.', icon: Bot }
]

const TPSL_TYPES: { value: ConditionOrder['order_type']; label: string; scaleLabel: string }[] = [
  { value: 'profit_stop', label: 'Kâr al', scaleLabel: 'Artış' },
  { value: 'loss_stop', label: 'Zarar durdur', scaleLabel: 'Düşüş' },
  { value: 'profit_stop_trace', label: 'İz süren kâr al', scaleLabel: 'Devreye girme' },
  { value: 'loss_stop_trace', label: 'İz süren zarar durdur', scaleLabel: 'Düşüş (isteğe bağlı)' }
]

export function RulesPage() {
  const { profile } = useAuth()
  const { rule, saveRule } = usePipeline()
  const [draft, setDraft] = useState<Rule>(rule)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const editable = canTrade(profile?.role)
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule)
  const l = draft.limits

  useEffect(() => setDraft(rule), [rule])

  const setT = <K extends keyof SafetyThresholds>(k: K, v: SafetyThresholds[K]) => setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [k]: v } }))
  const setL = <K extends keyof RuleLimits>(k: K, v: RuleLimits[K]) => setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: v } }))
  const setRow = (i: number, patch: Partial<ConditionOrder>) => setDraft((d) => ({ ...d, tpSl: d.tpSl.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const pickMode = (m: TradeMode) => {
    if (
      m === 'auto' &&
      !confirm(
        l.liveTrading
          ? 'Otomatik + GERÇEK işlem: güvenlikten geçen her token için onay sormadan gerçek SOL harcanacak. Emin misiniz?'
          : 'Otomatik mod deneme modunda çalışacak (para harcanmaz). Devam?'
      )
    )
      return
    setDraft((d) => ({ ...d, mode: m }))
  }

  const toggleLive = (on: boolean) => {
    if (on && !confirm("Gerçek mod açılırsa onayladığınız token'lar için GMGN cüzdanınızdan GERÇEK SOL harcanır. Emin misiniz?")) return
    setL('liveTrading', on)
  }

  const save = async () => {
    const presets = l.buyPresetsSol.filter((n) => n > 0)
    if (!presets.length) return setMsg({ kind: 'error', text: 'En az bir alım tutarı girin.' })
    if (draft.mode === 'auto' && !(l.autoBuySol > 0 && l.autoBuySol <= l.maxBuySol))
      return setMsg({ kind: 'error', text: "Otomatik alım tutarı 0'dan büyük ve işlem başı maks. tutardan küçük olmalı." })
    for (const r of draft.tpSl) {
      const ratio = Number(r.sell_ratio)
      if (!(ratio >= 1 && ratio <= 100)) return setMsg({ kind: 'error', text: 'TP/SL satış oranı 1–100 olmalı.' })
      if (r.order_type !== 'loss_stop_trace' && !(Number(r.price_scale) > 0)) return setMsg({ kind: 'error', text: 'TP/SL satırlarında fiyat yüzdesi zorunlu.' })
      if (r.order_type === 'loss_stop' && Number(r.price_scale) >= 100) return setMsg({ kind: 'error', text: "Zarar durdur düşüşü %100'den küçük olmalı." })
      if (r.order_type.endsWith('_trace') && !(Number(r.drawdown_rate) > 0 && Number(r.drawdown_rate) <= 100))
        return setMsg({ kind: 'error', text: 'İz süren koşullarda geri çekilme yüzdesi zorunlu.' })
    }
    const err = await saveRule({ ...draft, limits: { ...l, buyPresetsSol: presets } })
    setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: 'Kurallar kaydedildi; yeni sinyallere hemen uygulanır.' })
  }

  return (
    <div>
      {!editable && <div className="notice" style={{ marginBottom: 14 }}>Asistan rolü kuralları görüntüleyebilir, değiştiremez.</div>}

      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Section icon={Bot} title="Mod">
          <div className="choice-grid">
            {MODES.map((m) => (
              <button key={m.value} className="choice" aria-pressed={draft.mode === m.value} onClick={() => draft.mode !== m.value && pickMode(m.value)}>
                <span className="choice-title">
                  <m.icon size={14} /> {m.label}
                </span>
                <span className="choice-desc">{m.hint}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section
          icon={Zap}
          title="İşlem"
          note={
            <>
              Öncelik ücreti, bribe, slippage ve anti-MEV alt çubuktaki{' '}
              <button className="link" onClick={() => window.dispatchEvent(new CustomEvent('memebot:panel', { detail: 'fees' }))}>
                Ücret
              </button>{' '}
              menüsünde (P1–P3).
            </>
          }
        >
          <SettingRow
            title="Gerçek işlem"
            desc={l.liveTrading ? 'Açık: onaylar ve otomatik alımlar gerçek SOL harcar' : 'Kapalı: deneme modu, sadece GMGN fiyat teklifi alınır'}
            danger={l.liveTrading}
          >
            <Toggle checked={l.liveTrading} onChange={toggleLive} />
          </SettingRow>
          <div className="setting-grid" style={{ marginTop: 4 }}>
            <SettingRow title="İşlem başı maks. tutar" desc="Tek emirde en fazla">
              <UnitInput value={l.maxBuySol} unit="SOL" onChange={(v) => setL('maxBuySol', v)} />
            </SettingRow>
            <SettingRow title="Hızlı alım tutarları" desc="Akış ve onay düğmeleri, virgülle">
              <span className="unit-input">
                <input
                  defaultValue={l.buyPresetsSol.join(', ')}
                  key={l.buyPresetsSol.join(',')}
                  onBlur={(e) =>
                    setL(
                      'buyPresetsSol',
                      e.target.value
                        .split(',')
                        .map((s) => Number(s.trim().replace(',', '.')))
                        .filter((n) => Number.isFinite(n) && n > 0)
                        .slice(0, 5)
                    )
                  }
                />
                <span>SOL</span>
              </span>
            </SettingRow>
            <SettingRow title="Otomatik alım tutarı" desc="Otomatik modda her alım">
              <UnitInput value={l.autoBuySol} unit="SOL" onChange={(v) => setL('autoBuySol', v)} />
            </SettingRow>
            <SettingRow title="Günlük maks. harcama" desc="Gün içindeki toplam alım">
              <UnitInput value={l.dailyMaxSol} unit="SOL" onChange={(v) => setL('dailyMaxSol', v)} />
            </SettingRow>
            <SettingRow title="Günlük zarar sınırı" desc="Aşılınca otomatik mod kapanır">
              <UnitInput value={l.dailyLossLimitSol} unit="SOL" onChange={(v) => setL('dailyLossLimitSol', v)} />
            </SettingRow>
            <SettingRow title="Maks. açık pozisyon" desc="Aynı anda">
              <UnitInput value={l.maxOpenPositions} unit="adet" min={1} max={50} integer onChange={(v) => setL('maxOpenPositions', v)} />
            </SettingRow>
            <SettingRow title="Onay bekleme süresi" desc="Sonra aday düşer">
              <UnitInput value={l.approvalTtlMin} unit="dk" min={1} max={120} integer onChange={(v) => setL('approvalTtlMin', v)} />
            </SettingRow>
          </div>
        </Section>

        <Section icon={ShieldCheck} title="Güvenlik eşikleri">
          <div className="setting-grid">
            {BOOL_FIELDS.map((f) => (
              <SettingRow key={f.key} title={f.label} desc={f.desc}>
                <Toggle checked={draft.thresholds[f.key]} onChange={(v) => setT(f.key, v)} />
              </SettingRow>
            ))}
            <SettingRow title="UYARI'lı token'lar da onaya düşsün" desc="Verisi eksik olanlar">
              <Toggle checked={l.allowWarn} onChange={(v) => setL('allowWarn', v)} />
            </SettingRow>
            {NUM_FIELDS.map((f) => {
              const v = draft.thresholds[f.key]
              return (
                <SettingRow key={f.key} title={f.label} desc={f.desc}>
                  <UnitInput
                    value={f.percent ? +(v * 100).toFixed(2) : v}
                    unit={f.percent ? '%' : f.unit}
                    max={f.percent ? 100 : undefined}
                    onChange={(n) => setT(f.key, f.percent ? n / 100 : n)}
                  />
                </SettingRow>
              )
            })}
          </div>
        </Section>

        <Section
          icon={Target}
          title="TP / SL"
          count={draft.tpSl.length}
          actions={
            <button
              className="btn btn-sm"
              disabled={draft.tpSl.length >= 10}
              onClick={() => setDraft((d) => ({ ...d, tpSl: [...d.tpSl, { order_type: 'profit_stop', side: 'sell', price_scale: '200', sell_ratio: '50' }] }))}
            >
              <Plus size={13} /> Koşul ekle
            </button>
          }
          note="Alımla birlikte GMGN'de kurulur; bilgisayar kapalıyken de çalışır. Satış oranı, tetiklendiği anda elde kalan miktarın yüzdesidir. Deneme modunda kurulmaz."
        >
          {draft.tpSl.length === 0 ? (
            <div className="empty">Koşul yok: alımlar TP/SL olmadan yapılır.</div>
          ) : (
            draft.tpSl.map((row, i) => {
              const t = TPSL_TYPES.find((x) => x.value === row.order_type) ?? TPSL_TYPES[0]
              const trace = row.order_type.endsWith('_trace')
              return (
                <div key={i} className="tpsl-row">
                  <select className="input-sm" value={row.order_type} onChange={(e) => setRow(i, { order_type: e.target.value as ConditionOrder['order_type'] })}>
                    {TPSL_TYPES.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <span className="tpsl-field">
                    {t.scaleLabel}
                    <UnitInput value={row.price_scale ?? ''} unit="%" min={0} onChange={(v) => setRow(i, { price_scale: v ? String(v) : undefined })} />
                  </span>
                  {trace && (
                    <span className="tpsl-field">
                      Zirveden geri çekilme
                      <UnitInput value={row.drawdown_rate ?? ''} unit="%" max={100} onChange={(v) => setRow(i, { drawdown_rate: v ? String(v) : undefined })} />
                    </span>
                  )}
                  <span className="tpsl-field">
                    Sat
                    <UnitInput value={row.sell_ratio} unit="%" min={1} max={100} onChange={(v) => setRow(i, { sell_ratio: String(v) })} />
                  </span>
                  <span className="spacer" />
                  <button className="icon-btn danger" title="Koşulu sil" onClick={() => setDraft((d) => ({ ...d, tpSl: d.tpSl.filter((_, j) => j !== i) }))}>
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })
          )}
        </Section>

        <div className="save-bar">
          {msg ? <span className={`spacer ${msg.kind === 'ok' ? 'pos' : 'neg'}`}>{msg.text}</span> : <span className="spacer">{dirty ? 'Kaydedilmemiş değişiklik var' : ''}</span>}
          <button className="btn btn-ghost" onClick={() => setDraft(DEFAULT_RULE)}>
            <RotateCcw size={13} /> Varsayılanlar
          </button>
          {dirty && (
            <button className="btn" onClick={() => (setDraft(rule), setMsg(null))}>
              Vazgeç
            </button>
          )}
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>
            <Save size={13} /> Kaydet
          </button>
        </div>
      </fieldset>
    </div>
  )
}

