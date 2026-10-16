import { useEffect, useState, type ReactNode } from 'react'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useKillSwitch } from '../lib/killswitch'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
import { useEngine } from '../lib/engine'
import { usePrefs } from '../lib/prefs'
import { APP_VERSION, desktop, isDesktop } from '../lib/platform'
import type { UpdateStatus } from '../../../shared/types'

export type Page = 'feed' | 'approvals' | 'sources' | 'token' | 'positions' | 'orders' | 'rules' | 'settings' | 'users'

const TITLES: Record<Page, string> = {
  feed: 'Canlı Akış',
  approvals: 'Onay Bekleyenler',
  sources: 'Kaynaklar',
  token: 'Token Kontrol',
  positions: 'Pozisyonlar',
  orders: 'Emirler',
  rules: 'Kurallar',
  settings: 'Ayarlar',
  users: 'Kullanıcılar'
}

export function Layout({ page, onNavigate, children }: { page: Page; onNavigate: (p: Page) => void; children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const killSwitch = useKillSwitch()
  const { pendingCount, state, lastError, rule } = usePipeline()
  const { autoNotice } = useOrders()
  const { online, status } = useEngine()
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => desktop?.updater.onStatus(setUpdate), [])

  const toggleKill = async () => {
    const next = !killSwitch
    const { error } = await supabase
      .from('app_settings')
      .update({ value: next, updated_by: profile!.id, updated_at: new Date().toISOString() })
      .eq('key', 'kill_switch')
    if (!error) await supabase.from('audit_log').insert({ action: next ? 'kill_switch.on' : 'kill_switch.off' })
  }

  const items: Page[] = ['feed', 'approvals', 'positions', 'orders', 'sources', 'token', 'rules', 'settings']
  if (profile?.role === 'founder') items.push('users')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">MemeBot</div>
        {items.map((p) => (
          <button key={p} className="nav-item row" aria-current={page === p ? 'page' : undefined} onClick={() => onNavigate(p)}>
            <span style={{ flex: 1 }}>{TITLES[p]}</span>
            {p === 'approvals' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          <div>
            <div>{profile?.username}</div>
            <div className="faint">{profile && ROLE_LABEL[profile.role]}</div>
          </div>
          <button className="btn btn-sm" onClick={signOut}>
            Çıkış
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{TITLES[page]}</h1>
          <div className="row">
            {rule.mode === 'auto' && (
              <span className={`badge ${rule.limits.liveTrading ? 'fail' : 'warn'}`}>
                OTOMATİK · {rule.limits.liveTrading ? 'GERÇEK' : 'DENEME'}
              </span>
            )}
            {autoNotice && (
              <span className="neg" title={autoNotice}>
                {autoNotice.length > 60 ? autoNotice.slice(0, 60) + '…' : autoNotice}
              </span>
            )}
            {state === 'working' && <span className="faint">Güvenlik kontrolü…</span>}
            {state === 'no_key' && (
              <button className="btn btn-sm btn-danger" onClick={() => onNavigate('settings')}>
                GMGN anahtarı yok — kontrol yapılamıyor
              </button>
            )}
            {lastError && state !== 'no_key' && (
              <span className="neg" title={lastError}>
                Kontrol hatası
              </span>
            )}
            {update.state === 'ready' && (
              <button className="btn btn-sm" onClick={() => desktop?.updater.install()}>
                v{update.version} hazır — yeniden başlat
              </button>
            )}
            {update.state === 'downloading' && <span className="faint">Güncelleme indiriliyor %{update.percent}</span>}
            <span className="row muted" title={status?.version ? `Motor ${status.version} · ${status.host ?? ''}` : undefined}>
              <span className={`dot ${online ? 'on' : 'off'}`} />
              {online ? 'Motor çalışıyor' : 'Motor kapalı'}
            </span>
            <span className="row muted">
              <span className={`dot ${killSwitch ? 'off' : 'on'}`} />
              {killSwitch ? 'İşlemler durduruldu' : 'İşlemler açık'}
            </span>
            {profile?.role === 'founder' && (
              <button className={`btn btn-sm ${killSwitch ? '' : 'btn-danger'}`} onClick={toggleKill}>
                {killSwitch ? 'Devam ettir' : 'Tümünü durdur'}
              </button>
            )}
          </div>
        </header>
        {!online && (
          <div className="banner">
            Motor çalışmıyor: sinyaller işlenmiyor, alım-satım yapılamaz.{' '}
            <button className="link" onClick={() => onNavigate('settings')}>
              Ayarlar → Motor
            </button>
          </div>
        )}
        <main className="content">{children}</main>
        <StatusBar />
      </div>
    </div>
  )
}

// Alt durum çubuğu: veritabanı bağlantısı, motor, GMGN gecikmesi, işlem modu
function StatusBar() {
  const { online, status } = useEngine()
  const { rule } = usePipeline()
  const { activePreset, setActivePreset, keybinds } = usePrefs()
  const [connected, setConnected] = useState(true)

  // Gerçek zamanlı bağlantı: kendi kanalımızın durumu (kopunca istemci kendisi yeniden bağlanır)
  useEffect(() => {
    const ch = supabase.channel('statusbar-ping').subscribe((st) => setConnected(st === 'SUBSCRIBED'))
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  return (
    <footer className="statusbar">
      <span className="row" style={{ gap: 5 }}>
        <span className={`dot ${connected ? 'on' : 'off'}`} />
        {connected ? 'Bağlı' : 'Bağlantı yok'}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <span className={`dot ${online ? 'on' : 'off'}`} />
        Motor{status?.host ? ` · ${status.host}` : ''}
      </span>
      {online && status?.gmgn_latency_ms != null && <span>GMGN {status.gmgn_latency_ms} ms</span>}
      <span className={rule.limits.liveTrading ? 'neg' : undefined}>{rule.limits.liveTrading ? 'GERÇEK işlem' : 'Deneme modu'}</span>
      <span className="row" style={{ gap: 2 }} title="Ücret preset'i (Ayarlar → Ücret preset'leri)">
        Ücret
        {([1, 2, 3] as const).map((s) => (
          <button
            key={s}
            className={`preset-pill ${activePreset === s ? 'on' : ''}`}
            title={keybinds[`preset${s}`]}
            onClick={() => setActivePreset(s)}
          >
            P{s}
          </button>
        ))}
      </span>
      <span style={{ marginLeft: 'auto' }}>
        {isDesktop ? 'Masaüstü' : 'Web'} · v{APP_VERSION}
      </span>
    </footer>
  )
}
