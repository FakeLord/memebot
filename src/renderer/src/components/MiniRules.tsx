import { useState } from 'react'
import { Plus, Settings as SettingsIcon, Wallet } from 'lucide-react'
import { FloatingPanel } from './FloatingPanel'
import { usePrefs } from '../lib/prefs'
import { useNav } from '../lib/nav'
import { useWallets, shortAddr } from '../lib/wallets'
import { useRuleDraft } from '../lib/ruleDraft'
import { SolMark } from '../pages/settings/Wallets'
import { UnitInput, Toggle } from './ui'
import { Expander, FeeSummary, QuickGrid, SafetyCompact, TpSlList } from './RuleBits'
import type { PresetSlot } from '../../../shared/settings'
import type { TradeMode } from '../../../shared/rules'

// Alt çubuktaki "Kurallar": GMGN'in mini emir panosu düzeninde kural panosu (taşınır, boyutlanır: FloatingPanel).
// Alım / Satış / Otomatik sekmeleri; değişiklikler büyük düğmeyle kaydedilir.

type Tab = 'buy' | 'sell' | 'auto'

const MODES: { value: TradeMode; label: string }[] = [
  { value: 'watch', label: 'İzle' },
  { value: 'manual', label: 'Manuel' },
  { value: 'auto', label: 'Otomatik' }
]

export function MiniRules({ onClose, anchorX }: { onClose: () => void; anchorX?: number }) {
  const d = useRuleDraft()
  const { activePreset, setActivePreset } = usePrefs()
  const { go } = useNav()
  const wallets = useWallets()
  const [tab, setTab] = useState<Tab>('buy')
  const [openTp, setOpenTp] = useState(false)
  const [openSafety, setOpenSafety] = useState(false)
  const l = d.draft.limits
  const wallet = wallets.rows.find((w) => w.isDefault)

  const cta = d.busy ? 'Kaydediliyor…' : d.dirty ? 'Kuralları kaydet' : d.msg?.kind === 'ok' ? 'Kaydedildi' : 'Değişiklik yok'

  return (
    <FloatingPanel
      id="rules"
      title="Kurallar"
      className="gm"
      anchorX={anchorX}
      width={320}
      minW={300}
      onClose={onClose}
      head={
        <>
          <span className="gm-presets" title="Etkin ücret preset'i (F1 / F2 / F3)">
            {([1, 2, 3] as PresetSlot[]).map((s) => (
              <button key={s} className={`gm-preset ${activePreset === s ? 'on' : ''}`} disabled={!d.editable} onClick={() => setActivePreset(s)}>
                P{s}
              </button>
            ))}
          </span>
          <span className="spacer" />
          <span className="gm-chip" title={wallet ? wallet.address : 'Varsayılan cüzdan seçilmedi'}>
            <Wallet size={12} /> {wallet ? (wallet.label ?? shortAddr(wallet.address)) : '—'}
          </span>
          <span className="gm-chip">
            <SolMark size={12} /> {wallet?.balance !== undefined ? wallet.balance.toFixed(3) : '—'}
          </span>
          <button
            className="icon-btn sm"
            title="Tüm kural ayarları"
            onClick={() => {
              onClose()
              go('settings', 'rules')
            }}
          >
            <SettingsIcon size={14} />
          </button>
        </>
      }
    >
      <div className="gm-tabs">
        <button className={`gm-tab ${tab === 'buy' ? 'on buy' : ''}`} onClick={() => setTab('buy')}>
          Alım
        </button>
        <button className={`gm-tab ${tab === 'sell' ? 'on sell' : ''}`} onClick={() => setTab('sell')}>
          Satış
        </button>
        <button className={`gm-tab ${tab === 'auto' ? 'on auto' : ''}`} onClick={() => setTab('auto')}>
          Otomatik
        </button>
      </div>

      <fieldset disabled={!d.editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 10 }}>
        {tab === 'buy' && (
          <>
            <div className="gm-box">
              <div className="gm-amount">
                <label>İşlem başı maks.</label>
                <input
                  inputMode="decimal"
                  defaultValue={l.maxBuySol}
                  key={`max-${l.maxBuySol}`}
                  onBlur={(e) => {
                    const n = Number(e.target.value.replace(',', '.'))
                    if (Number.isFinite(n) && n >= 0) d.setL('maxBuySol', Math.min(5, n))
                  }}
                />
                <span>SOL</span>
              </div>
              <QuickGrid values={l.buyPresetsSol} editable={d.editable} onChange={(v) => d.setL('buyPresetsSol', [...v, ...l.buyPresetsSol.slice(4)])} />
            </div>
            <div className="gm-line">
              Günlük maks. harcama
              <UnitInput value={l.dailyMaxSol} unit="SOL" onChange={(v) => d.setL('dailyMaxSol', v)} />
            </div>
            <div className="gm-line">
              Aynı anda maks. açık pozisyon
              <UnitInput value={l.maxOpenPositions} unit="adet" min={1} max={50} integer onChange={(v) => d.setL('maxOpenPositions', v)} />
            </div>
            <div className="gm-line">
              Onay bekleme süresi
              <UnitInput value={l.approvalTtlMin} unit="dk" min={1} max={120} integer onChange={(v) => d.setL('approvalTtlMin', v)} />
            </div>
          </>
        )}

        {tab === 'sell' && (
          <>
            <div className="gm-box">
              <div className="gm-amount">
                <label>Hızlı satış</label>
                <span style={{ marginLeft: 'auto' }}>%</span>
              </div>
              <QuickGrid values={l.sellPresetsPct} suffix="%" editable={d.editable} onChange={(v) => d.setL('sellPresetsPct', [...v.map((x) => Math.min(100, x)), ...l.sellPresetsPct.slice(4)])} />
            </div>
            <div className="gm-line">
              Günlük zarar sınırı
              <UnitInput value={l.dailyLossLimitSol} unit="SOL" onChange={(v) => d.setL('dailyLossLimitSol', v)} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Expander label={`TP / SL stratejisi (${d.draft.tpSl.length})`} open={openTp} onToggle={() => setOpenTp((x) => !x)} />
              {openTp && (
                <button
                  className="icon-btn sm"
                  title="Koşul ekle"
                  disabled={d.draft.tpSl.length >= 10}
                  onClick={() => d.setTpSl((r) => [...r, { order_type: 'profit_stop', side: 'sell', price_scale: '200', sell_ratio: '50' }])}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
            {openTp && <TpSlList d={d} compact />}
          </>
        )}

        {tab === 'auto' && (
          <>
            <div className="gm-sub">
              {MODES.map((m) => (
                <button key={m.value} className={d.draft.mode === m.value ? 'on' : ''} onClick={() => d.setMode(m.value)}>
                  {m.label}
                </button>
              ))}
              <span className="spacer" />
              <span className={`badge ${l.liveTrading ? 'fail' : 'warn'}`}>{l.liveTrading ? 'GERÇEK' : 'DENEME'}</span>
            </div>
            <div className="gm-box">
              <div className="gm-amount">
                <label>Otomatik alım</label>
                <input
                  inputMode="decimal"
                  defaultValue={l.autoBuySol}
                  key={`auto-${l.autoBuySol}`}
                  onBlur={(e) => {
                    const n = Number(e.target.value.replace(',', '.'))
                    if (Number.isFinite(n) && n >= 0) d.setL('autoBuySol', n)
                  }}
                />
                <span>SOL</span>
              </div>
            </div>
            <div className="gm-line">
              <span className={l.liveTrading ? 'neg' : undefined}>Gerçek işlem</span>
              <Toggle checked={l.liveTrading} onChange={d.setLive} />
            </div>
            <div className="gm-line">
              Otomatik moddaki ücret preset'i
              <span className="gm-presets">
                {([1, 2, 3] as PresetSlot[]).map((s) => (
                  <button key={s} className={`gm-preset ${l.autoPreset === s ? 'on' : ''}`} onClick={() => d.setL('autoPreset', s)}>
                    P{s}
                  </button>
                ))}
              </span>
            </div>
            <Expander label="Güvenlik filtresi" open={openSafety} onToggle={() => setOpenSafety((x) => !x)} />
            {openSafety && <SafetyCompact d={d} />}
          </>
        )}

        <button className={`gm-cta ${tab}`} disabled={!d.dirty || d.busy} onClick={d.save}>
          {cta}
        </button>
      </fieldset>

      {d.msg && <div className={`gm-msg ${d.msg.kind === 'ok' ? 'pos' : 'neg'}`}>{d.msg.text}</div>}
      {!d.editable && <div className="gm-msg faint">Asistan rolü kuralları değiştiremez.</div>}
      {d.dirty && (
        <button className="link faint" style={{ fontSize: 11, justifySelf: 'center' }} onClick={d.reset}>
          Değişiklikleri geri al
        </button>
      )}

      <FeeSummary kind={tab === 'sell' ? 'sell' : 'buy'} slot={tab === 'auto' ? l.autoPreset : activePreset} />
    </FloatingPanel>
  )
}
