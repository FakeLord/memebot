import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errText, useEngine } from '../lib/engine'
import { APP_VERSION, desktop } from '../lib/platform'
import type { EngineHostStatus, WalletInfo } from '../../../shared/types'
import type { GmgnPlan } from '../../../shared/engine'
import { AccountsSection } from './settings/Accounts'
import { KeywordsSection } from './settings/Keywords'
import { AppearanceSection } from './settings/Appearance'
import { PresetsSection } from './settings/Presets'
import { ShortcutsSection } from './settings/Shortcuts'
import { DeploySettingsSection } from './settings/DeploySettings'
import { WalletsSection } from './settings/Wallets'

type Msg = { kind: 'ok' | 'error'; text: string } | null

type Section = 'accounts' | 'keywords' | 'appearance' | 'presets' | 'connections' | 'deploy' | 'wallets' | 'shortcuts' | 'about'

const MENU: { group: string; items: { id: Section; label: string }[] }[] = [
  { group: 'Takip', items: [{ id: 'accounts', label: 'Hesaplar' }, { id: 'keywords', label: 'Anahtar kelimeler' }, { id: 'appearance', label: 'Görünüm' }] },
  { group: 'İşlem', items: [{ id: 'presets', label: "Ücret preset'leri" }, { id: 'connections', label: 'GMGN ve motor' }] },
  { group: 'Deploy', items: [{ id: 'deploy', label: 'Genel' }, { id: 'wallets', label: 'Cüzdanlar' }] },
  { group: 'Uygulama', items: [{ id: 'shortcuts', label: 'Kısayollar' }, { id: 'about', label: 'Hakkında' }] }
]

export function SettingsPage({ initial }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial ?? 'connections')
  return (
    <div className="settings">
      <nav className="settings-nav">
        {MENU.map((g) => (
          <div key={g.group} className="stack" style={{ gap: 2 }}>
            <div className="settings-group">{g.group}</div>
            {g.items.map((i) => (
              <button key={i.id} className="nav-item" aria-current={section === i.id ? 'page' : undefined} onClick={() => setSection(i.id)}>
                {i.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-body">
        {section === 'accounts' && <AccountsSection />}
        {section === 'keywords' && <KeywordsSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'presets' && <PresetsSection />}
        {section === 'connections' && <ConnectionsSection />}
        {section === 'deploy' && <DeploySettingsSection />}
        {section === 'wallets' && <WalletsSection />}
        {section === 'shortcuts' && <ShortcutsSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  )
}

function ConnectionsSection() {
  const { profile } = useAuth()
  return (
    <div className="stack">
      <EngineCard />
      <GmgnCard />
      <WalletsSection />
      {desktop && profile?.role === 'founder' && <EngineHostCard />}
    </div>
  )
}

function AboutSection() {
  return (
    <div className="card stack">
      <h2>Uygulama</h2>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          Sürüm <span className="mono">{APP_VERSION}</span> · {desktop ? 'masaüstü' : 'web'}
        </span>
        {desktop && (
          <button className="btn btn-sm" onClick={() => desktop?.updater.check()}>
            Güncellemeleri denetle
          </button>
        )}
      </div>
    </div>
  )
}

function EngineCard() {
  const { online, status } = useEngine()
  return (
    <div className="card stack">
      <h2>Motor</h2>
      <div className="row">
        <span className={`dot ${online ? 'on' : 'off'}`} />
        <span>{online ? 'Çalışıyor' : 'Çalışmıyor'}</span>
        {status?.version && <span className="faint">· sürüm {status.version}</span>}
        {status?.host && <span className="faint">· {status.host}</span>}
        {online && status?.gmgn_latency_ms != null && <span className="faint">· GMGN {status.gmgn_latency_ms} ms</span>}
      </div>
      <p className="muted">
        Sinyalleri dinleyen, güvenlik kontrolü yapan ve alım-satımı yürüten motor 7/24 tek bir yerde çalışır. Bu ekran (tarayıcı ya da
        masaüstü) sadece arayüzdür; kapatsanız da motor çalışmaya devam eder.
      </p>
    </div>
  )
}

function GmgnCard() {
  const { me, online, run, runSealed } = useEngine()
  const [apiKey, setApiKey] = useState('')
  const [pem, setPem] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const configured = me?.gmgn.configured === true
  const plan = me?.gmgn.plan ?? 'free'

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ kind: 'ok', text: ok })
      return true
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (await act(() => runSealed('gmgn.save', { apiKey, privateKeyPem: pem }), 'Anahtar motora şifreli olarak kaydedildi.')) {
      setApiKey('')
      setPem('')
    }
  }

  return (
    <div className="card stack">
      <h2>GMGN API</h2>
      <p className="muted">
        Anahtarınızı <span className="mono">gmgn.ai/ai</span> adresinden alın. Anahtar bu ekranda motorun açık anahtarıyla şifrelenir; Supabase'e
        düz metin gitmez, sadece motor açabilir ve kendi kasasında şifreli saklar.
      </p>
      <div className="row">
        <span className={`dot ${configured ? 'on' : 'off'}`} />
        <span>{me ? (configured ? 'Anahtar kayıtlı' : 'Anahtar yok') : '…'}</span>
      </div>
      {configured && (
        <label style={{ maxWidth: 320 }}>
          GMGN planı (istek hızı sınırı)
          <select
            value={plan}
            disabled={busy || !online}
            onChange={(e) => act(() => run('gmgn.plan', { plan: e.target.value as GmgnPlan }), 'Plan güncellendi.')}
          >
            <option value="free">Free — 5 istek/sn</option>
            <option value="plus">Plus — 20 istek/sn</option>
            <option value="pro">Pro — 50 istek/sn</option>
          </select>
        </label>
      )}
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      <label>
        API Key
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        İmza anahtarı (Ed25519 PEM — cüzdan anahtarı DEĞİL)
        <textarea
          rows={4}
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          spellCheck={false}
          placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
        />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !online || !apiKey || !pem} onClick={save}>
          Kaydet
        </button>
        <button className="btn" disabled={busy || !online || !configured} onClick={() => act(() => run('gmgn.test', {}), 'GMGN bağlantısı çalışıyor.')}>
          Bağlantıyı test et
        </button>
        <button
          className="btn btn-danger"
          disabled={busy || !online || !configured}
          onClick={() => confirm('GMGN anahtarı motordan silinsin mi?') && act(() => run('gmgn.clear', {}), 'Anahtar silindi.')}
        >
          Anahtarı sil
        </button>
      </div>
      {!online && <p className="faint">Motor çalışmadığı için anahtar işlemleri şu an yapılamaz.</p>}
    </div>
  )
}

// Masaüstü + founder: motoru bu bilgisayarda çalıştırma ayarı (VPS'e geçene kadar)
function EngineHostCard() {
  const [st, setSt] = useState<EngineHostStatus | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    const load = () => desktop?.engine.status().then(setSt)
    load()
    const t = setInterval(load, 3_000)
    return () => clearInterval(t)
  }, [])

  const configure = async (patch: { enabled?: boolean; serviceRoleKey?: string }, ok: string) => {
    const r = await desktop!.engine.configure(patch)
    if (r.ok) {
      setSt(r.status)
      setMsg({ kind: 'ok', text: ok })
      setKey('')
    } else setMsg({ kind: 'error', text: r.error })
  }

  if (!st) return null
  return (
    <div className="card stack">
      <h2>Bu bilgisayarda motor</h2>
      <p className="muted">
        Proje VPS'e taşınana kadar motor bu bilgisayarda, uygulama açıkken arka planda çalışır. Bunun için Supabase{' '}
        <b>service_role</b> anahtarı gerekir (Supabase → Project Settings → API Keys). Anahtar sadece bu bilgisayarda Windows şifrelemesiyle
        saklanır; başka hiçbir yere gönderilmez.
      </p>
      <div className="row">
        <span className={`dot ${st.running ? 'on' : 'off'}`} />
        <span>{st.running ? 'Bu bilgisayarda çalışıyor' : st.enabled ? 'Açık ama çalışmıyor' : 'Kapalı'}</span>
        <span className="faint">· service_role anahtarı {st.hasServiceKey ? 'kayıtlı' : 'yok'}</span>
      </div>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      <div className="row">
        <input
          type="password"
          style={{ flex: 1 }}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={st.hasServiceKey ? 'Yeni service_role anahtarı (değiştirmek için)' : 'service_role anahtarı'}
          autoComplete="off"
        />
        <button className="btn" disabled={!key.trim()} onClick={() => configure({ serviceRoleKey: key }, 'Anahtar kaydedildi.')}>
          Kaydet
        </button>
      </div>
      <label className="row" style={{ color: 'var(--text)', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={st.enabled}
          disabled={!st.hasServiceKey}
          onChange={(e) =>
            configure({ enabled: e.target.checked }, e.target.checked ? 'Motor başlatılıyor…' : 'Motor bu bilgisayarda durduruldu.')
          }
        />
        Motor bu bilgisayarda çalışsın
      </label>
      <div>
        <button className="btn btn-sm" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? 'Günlüğü gizle' : 'Motor günlüğünü göster'}
        </button>
      </div>
      {showLogs && (
        <pre className="log">{st.logs.length ? st.logs.join('\n') : 'Henüz kayıt yok.'}</pre>
      )}
    </div>
  )
}
