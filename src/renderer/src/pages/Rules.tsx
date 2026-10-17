import { useState } from 'react'
import { Bot, Eye, Hand, LayoutGrid, Plus, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Target, Zap } from 'lucide-react'
import { useRuleDraft } from '../lib/ruleDraft'
import { Section, SettingRow, Toggle, UnitInput } from '../components/ui'
import { FeeTable, SAFETY_BOOL, SAFETY_NUM, SlotGrid, TpSlList } from '../components/RuleBits'
import type { TradeMode } from '../../../shared/rules'
import type { PresetSlot } from '../../../shared/settings'

// Kurallar: GMGN "Quick Buy Settings" düzeni. Alım / Satış / Otomatik sekmeleri.
// Kural alanları taslakta tutulur ve alttaki çubuktan kaydedilir; ücret tabloları alandan çıkınca anında kaydedilir.

type Tab = 'buy' | 'sell' | 'auto'

const MODES: { value: TradeMode; label: string; hint: string; icon: typeof Eye }[] = [
  { value: 'watch', label: 'Sadece izle', hint: 'Sinyaller kontrol edilir, onaya düşmez.', icon: Eye },
  { value: 'manual', label: 'Manuel onay', hint: 'Güvenlikten geçenler Onay Bekleyenler ekranına düşer.', icon: Hand },
  { value: 'auto', label: 'Otomatik', hint: 'Güvenlikten geçenler onaysız alınır; limitler ve günlük zarar sınırı geçerli.', icon: Bot }
]

export function RulesPage() {
  const d = useRuleDraft()
  const [tab, setTab] = useState<Tab>('buy')
  const l = d.draft.limits

  return (
    <div style={{ maxWidth: 860 }}>
      {!d.editable && <div className="notice" style={{ marginBottom: 14 }}>Asistan rolü kuralları görüntüleyebilir, değiştiremez.</div>}

      <div className="gm-tabs" style={{ marginBottom: 18 }}>
        <button className={`gm-tab ${tab === 'buy' ? 'on buy' : ''}`} onClick={() => setTab('buy')}>
          Alım ayarları
        </button>
        <button className={`gm-tab ${tab === 'sell' ? 'on sell' : ''}`} onClick={() => setTab('sell')}>
          Satış ayarları
        </button>
        <button className={`gm-tab ${tab === 'auto' ? 'on auto' : ''}`} onClick={() => setTab('auto')}>
          Otomatik ve güvenlik
        </button>
      </div>

      <fieldset disabled={!d.editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {tab === 'buy' && (
          <>
            <Section icon={LayoutGrid} title="Düğme preset'leri" note="Akıştaki ve Onay Bekleyenler'deki hızlı alım düğmeleri (ilk 4'ü gösterilir; akış ilkini kullanır).">
              <SlotGrid values={l.buyPresetsSol} unit="SOL" max={5} onChange={(v) => d.setL('buyPresetsSol', v)} />
            </Section>
            <Section icon={SlidersHorizontal} title="Limitler">
              <div className="setting-grid">
                <SettingRow title="İşlem başı maks. tutar" desc="Tek emirde en fazla (mutlak sınır 5 SOL)">
                  <UnitInput value={l.maxBuySol} unit="SOL" max={5} onChange={(v) => d.setL('maxBuySol', v)} />
                </SettingRow>
                <SettingRow title="Günlük maks. harcama" desc="Gün içindeki toplam alım">
                  <UnitInput value={l.dailyMaxSol} unit="SOL" onChange={(v) => d.setL('dailyMaxSol', v)} />
                </SettingRow>
                <SettingRow title="Maks. açık pozisyon" desc="Aynı anda">
                  <UnitInput value={l.maxOpenPositions} unit="adet" min={1} max={50} integer onChange={(v) => d.setL('maxOpenPositions', v)} />
                </SettingRow>
                <SettingRow title="Onay bekleme süresi" desc="Sonra aday düşer">
                  <UnitInput value={l.approvalTtlMin} unit="dk" min={1} max={120} integer onChange={(v) => d.setL('approvalTtlMin', v)} />
                </SettingRow>
              </div>
            </Section>
            <Section icon={Zap} title="İşlem preset'leri · alım" note="Ücret tablosu alandan çıkınca anında kaydedilir. Etkin preset yeşil; alt çubuktan ya da F1 / F2 / F3 ile değişir.">
              <FeeTable kind="buy" />
            </Section>
          </>
        )}

        {tab === 'sell' && (
          <>
            <Section icon={LayoutGrid} title="Düğme preset'leri" note="Pozisyonlar ekranındaki hızlı satış düğmeleri (yüzde).">
              <SlotGrid values={l.sellPresetsPct} unit="%" max={100} onChange={(v) => d.setL('sellPresetsPct', v)} />
            </Section>
            <Section
              icon={Target}
              title="TP / SL"
              count={d.draft.tpSl.length}
              actions={
                <button
                  className="btn btn-sm"
                  disabled={d.draft.tpSl.length >= 10}
                  onClick={() => d.setTpSl((r) => [...r, { order_type: 'profit_stop', side: 'sell', price_scale: '200', sell_ratio: '50' }])}
                >
                  <Plus size={13} /> Koşul ekle
                </button>
              }
              note="Alımla birlikte GMGN'de kurulur; bilgisayar kapalıyken de çalışır. Satış oranı, tetiklendiği anda elde kalan miktarın yüzdesidir. Deneme modunda kurulmaz."
            >
              <TpSlList d={d} />
            </Section>
            <Section icon={SlidersHorizontal} title="Zarar sınırı">
              <SettingRow title="Günlük zarar sınırı" desc="Bugünkü gerçekleşen zarar bunu aşarsa otomatik mod kendini kapatır">
                <UnitInput value={l.dailyLossLimitSol} unit="SOL" onChange={(v) => d.setL('dailyLossLimitSol', v)} />
              </SettingRow>
            </Section>
            <Section icon={Zap} title="İşlem preset'leri · satış" note="Ücret tablosu alandan çıkınca anında kaydedilir.">
              <FeeTable kind="sell" />
            </Section>
          </>
        )}

        {tab === 'auto' && (
          <>
            <Section icon={Bot} title="Mod">
              <div className="choice-grid">
                {MODES.map((m) => (
                  <button key={m.value} className="choice" aria-pressed={d.draft.mode === m.value} onClick={() => d.setMode(m.value)}>
                    <span className="choice-title">
                      <m.icon size={14} /> {m.label}
                    </span>
                    <span className="choice-desc">{m.hint}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section icon={Zap} title="İşlem">
              <SettingRow
                title="Gerçek işlem"
                desc={l.liveTrading ? 'Açık: onaylar ve otomatik alımlar gerçek SOL harcar' : 'Kapalı: deneme modu, sadece GMGN fiyat teklifi alınır'}
                danger={l.liveTrading}
              >
                <Toggle checked={l.liveTrading} onChange={d.setLive} />
              </SettingRow>
              <div className="setting-grid" style={{ marginTop: 4 }}>
                <SettingRow title="Otomatik alım tutarı" desc="Otomatik modda her alım">
                  <UnitInput value={l.autoBuySol} unit="SOL" onChange={(v) => d.setL('autoBuySol', v)} />
                </SettingRow>
                <SettingRow title="Otomatik alım yalnız güvenilir kişilerden" desc="Telegram grup çağrılarında: Çağrıcılar'da “Güvenilir” seçtikleriniz otomatik alınır, diğerleri onaya düşer (kanal ve X sinyalleri etkilenmez)">
                  <Toggle checked={l.autoOnlyTrusted} onChange={(v) => d.setL('autoOnlyTrusted', v)} />
                </SettingRow>
                <SettingRow title="Güvenilir kişide tutar çarpanı" desc="Otomatik alım tutarı × çarpan (en çok işlem başı maks. tutar)">
                  <UnitInput value={l.trustedBuyMult} unit="×" onChange={(v) => d.setL('trustedBuyMult', v)} />
                </SettingRow>
                <SettingRow title="Otomatik moddaki ücret preset'i">
                  <span className="gm-presets">
                    {([1, 2, 3] as PresetSlot[]).map((s) => (
                      <button key={s} className={`gm-preset ${l.autoPreset === s ? 'on' : ''}`} onClick={() => d.setL('autoPreset', s)}>
                        P{s}
                      </button>
                    ))}
                  </span>
                </SettingRow>
              </div>
            </Section>
            <Section icon={ShieldCheck} title="Güvenlik filtresi" note="Sinyaller bu eşiklerden geçerse onaya düşer ya da otomatik modda alınır.">
              <div className="setting-grid">
                {SAFETY_BOOL.map((f) => (
                  <SettingRow key={f.key} title={f.label}>
                    <Toggle checked={d.draft.thresholds[f.key]} onChange={(v) => d.setT(f.key, v)} />
                  </SettingRow>
                ))}
                <SettingRow title="UYARI'lı token'lar da onaya düşsün" desc="Verisi eksik olanlar">
                  <Toggle checked={l.allowWarn} onChange={(v) => d.setL('allowWarn', v)} />
                </SettingRow>
                {SAFETY_NUM.map((f) => {
                  const v = d.draft.thresholds[f.key]
                  return (
                    <SettingRow key={f.key} title={f.label} desc={f.unit === '$' ? '0 = kapalı' : undefined}>
                      <UnitInput
                        value={f.percent ? +(v * 100).toFixed(2) : v}
                        unit={f.percent ? '%' : f.unit}
                        max={f.percent ? 100 : undefined}
                        onChange={(n) => d.setT(f.key, f.percent ? n / 100 : n)}
                      />
                    </SettingRow>
                  )
                })}
              </div>
            </Section>
          </>
        )}

        <div className="save-bar">
          {d.msg ? (
            <span className={`spacer ${d.msg.kind === 'ok' ? 'pos' : 'neg'}`}>{d.msg.text}</span>
          ) : (
            <span className="spacer">{d.dirty ? 'Kaydedilmemiş değişiklik var' : ''}</span>
          )}
          {d.dirty && (
            <button className="btn btn-ghost" onClick={d.reset}>
              <RotateCcw size={13} /> Geri al
            </button>
          )}
          <button className={`btn btn-primary`} disabled={!d.dirty || d.busy} onClick={d.save}>
            <Save size={13} /> {d.busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}
