import { useEffect, useState, type ReactNode } from 'react'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useKillSwitch } from '../lib/killswitch'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
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
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => window.api.updater.onStatus(setUpdate), [])

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
              <button className="btn btn-sm" onClick={() => window.api.updater.install()}>
                v{update.version} hazır — yeniden başlat
              </button>
            )}
            {update.state === 'downloading' && <span className="faint">Güncelleme indiriliyor %{update.percent}</span>}
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
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
