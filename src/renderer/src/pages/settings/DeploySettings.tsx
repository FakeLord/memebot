import { ArrowRight, CircleDollarSign, LayoutGrid, PanelRight, Rocket, SquareStack, Wallet } from 'lucide-react'
import { usePrefs, type UiLayout } from '../../lib/prefs'
import { useNav } from '../../lib/nav'
import { useEngine } from '../../lib/engine'
import { usePipeline } from '../../lib/pipeline'
import { shortAddr } from '../../lib/wallets'
import { Section, SettingRow, StatusPill } from '../../components/ui'
import { PLATFORM_LABEL, type DeployPlatform } from '../../../../shared/deploy'
import type { PresetSlot } from '../../../../shared/settings'

// Deploy → Genel: varsayılan platform, form yerleşimi, deploy sonrası açılacak site, deploy ücretleri ve cüzdan özeti.

const PLATFORM_DESC: Record<DeployPlatform, string> = {
  pump: 'En yaygın launchpad, bonding curve',
  bonk: 'LetsBonk; ücret paylaşımı yok',
  bags: 'BAGS; ücret paylaşımı destekli'
}

export function DeploySettingsSection() {
  const { layout, setLayout, preset, activePreset } = usePrefs()
  const { rule } = usePipeline()
  const { me } = useEngine()
  const { go } = useNav()
  const set = <K extends keyof UiLayout>(k: K, v: UiLayout[K]) => setLayout({ ...layout, [k]: v })
  const platform = layout.deployPlatform ?? 'pump'
  const form = layout.deployForm ?? 'modal'

  return (
    <div>
      <Section icon={Rocket} title="Varsayılan platform">
        <div className="choice-grid">
          {(Object.keys(PLATFORM_LABEL) as DeployPlatform[]).map((p) => (
            <button key={p} className="choice" aria-pressed={platform === p} onClick={() => set('deployPlatform', p)}>
              <span className="choice-title">{PLATFORM_LABEL[p]}</span>
              <span className="choice-desc">{PLATFORM_DESC[p]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section icon={LayoutGrid} title="Form">
        <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 4 }}>
          <button className="choice" aria-pressed={form === 'modal'} onClick={() => set('deployForm', 'modal')}>
            <span className="choice-title">
              <SquareStack size={14} /> Ortada pencere
            </span>
            <span className="choice-desc">Akışın üstünde açılır, Esc ile kapanır</span>
          </button>
          <button className="choice" aria-pressed={form === 'side'} onClick={() => set('deployForm', 'side')}>
            <span className="choice-title">
              <PanelRight size={14} /> Sağda yan panel
            </span>
            <span className="choice-desc">Akış görünür kalır, kartlara bakarak doldurursunuz</span>
          </button>
        </div>
        <SettingRow title="Deploy sonrası aç" desc="Token kesinleşince yeni sekmede açılacak site">
          <select className="input-sm" value={layout.openAfterDeploy ?? 'gmgn'} onChange={(e) => set('openAfterDeploy', e.target.value as UiLayout['openAfterDeploy'])}>
            <option value="gmgn">GMGN</option>
            <option value="solscan">Solscan</option>
            <option value="none">Hiçbiri</option>
          </select>
        </SettingRow>
      </Section>

      <Section
        icon={CircleDollarSign}
        title="Deploy ücretleri"
        actions={
          <button className="btn btn-sm" onClick={() => window.dispatchEvent(new CustomEvent('memebot:panel', { detail: 'fees' }))}>
            Ücretleri düzenle
          </button>
        }
        note="Formda preset seçilir; varsayılan olarak etkin preset gelir. Değerler alt çubuktaki Ücret menüsünün Deploy sekmesinden düzenlenir."
      >
        <div className="setting-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {([1, 2, 3] as PresetSlot[]).map((s) => {
            const f = preset(s, 'deploy')
            return (
              <div key={s} className="choice" aria-pressed={activePreset === s} style={{ cursor: 'default' }}>
                <span className="choice-title">
                  Preset {s} {activePreset === s && <StatusPill tone="on">Etkin</StatusPill>}
                </span>
                <span className="choice-desc mono">
                  öncelik {f.priorityFeeSol} · bribe {f.tipFeeSol} SOL
                  <br />
                  slippage {f.slippage === 'auto' ? 'otomatik' : `%${f.slippage}`}
                  {f.antiMev ? ' · anti-MEV' : ''}
                </span>
              </div>
            )
          })}
        </div>
      </Section>

      <Section icon={Wallet} title="Cüzdan ve mod">
        <SettingRow title="Deploy cüzdanı" desc="Alım-satım ve deploy ★ varsayılan cüzdandan yapılır">
          <span className="mono muted" style={{ fontSize: 12 }}>
            {me?.gmgn.wallet ? shortAddr(me.gmgn.wallet) : 'seçilmedi'}
          </span>
          <button className="btn btn-sm" onClick={() => go('settings', 'wallets')}>
            Cüzdanlar <ArrowRight size={12} />
          </button>
        </SettingRow>
        <SettingRow
          title="İşlem modu"
          desc={rule.limits.liveTrading ? 'Gerçek işlem açık: deploy GMGN\'e gönderilir' : 'Deneme modu: deploy isteği sadece hazırlanıp kaydedilir, GMGN\'e gitmez'}
          danger={rule.limits.liveTrading}
        >
          <StatusPill tone={rule.limits.liveTrading ? 'off' : 'wait'}>{rule.limits.liveTrading ? 'GERÇEK' : 'DENEME'}</StatusPill>
          <button className="btn btn-sm" onClick={() => go('settings', 'rules')}>
            Kurallar <ArrowRight size={12} />
          </button>
        </SettingRow>
      </Section>
    </div>
  )
}
