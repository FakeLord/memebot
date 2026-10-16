import { usePrefs, type UiLayout } from '../../lib/prefs'
import { PLATFORM_LABEL, type DeployPlatform } from '../../../../shared/deploy'

// Deploy → Genel: varsayılan platform, form yerleşimi, deploy sonrası açılacak site.

export function DeploySettingsSection() {
  const { layout, setLayout } = usePrefs()
  const set = <K extends keyof UiLayout>(k: K, v: UiLayout[K]) => setLayout({ ...layout, [k]: v })
  return (
    <div className="card stack">
      <h2>Deploy — genel</h2>
      <div className="grid-2">
        <label>
          Varsayılan platform
          <select value={layout.deployPlatform ?? 'pump'} onChange={(e) => set('deployPlatform', e.target.value as DeployPlatform)}>
            {(Object.keys(PLATFORM_LABEL) as DeployPlatform[]).map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Form yerleşimi
          <select value={layout.deployForm ?? 'modal'} onChange={(e) => set('deployForm', e.target.value as UiLayout['deployForm'])}>
            <option value="modal">Ortada pencere</option>
            <option value="side">Sağda yan panel</option>
          </select>
        </label>
        <label>
          Deploy sonrası aç
          <select value={layout.openAfterDeploy ?? 'gmgn'} onChange={(e) => set('openAfterDeploy', e.target.value as UiLayout['openAfterDeploy'])}>
            <option value="gmgn">GMGN</option>
            <option value="solscan">Solscan</option>
            <option value="none">Hiçbiri</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Deploy ücretleri Ücret preset'leri → Deploy sekmesinden gelir. Kurallar'da <b>Gerçek işlem</b> kapalıyken deploy formu isteği sadece hazırlar ve
        kaydeder; GMGN'e hiçbir şey gönderilmez.
      </p>
    </div>
  )
}
