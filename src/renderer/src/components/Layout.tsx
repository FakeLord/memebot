import { useEffect, useState, type ReactNode } from 'react'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { UpdateStatus } from '../../../shared/types'

export type Page = 'feed' | 'token' | 'positions' | 'settings' | 'users'

const TITLES: Record<Page, string> = {
  feed: 'Canlı Akış',
  token: 'Token Kontrol',
  positions: 'Pozisyonlar',
  settings: 'Ayarlar',
  users: 'Kullanıcılar'
}

export function Layout({ page, onNavigate, children }: { page: Page; onNavigate: (p: Page) => void; children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const [killSwitch, setKillSwitch] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => window.api.updater.onStatus(setUpdate), [])

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'kill_switch')
      .maybeSingle()
      .then(({ data }) => setKillSwitch(data?.value === true))
    const ch = supabase
      .channel('settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.kill_switch' }, (p) =>
        setKillSwitch((p.new as { value?: unknown })?.value === true)
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const toggleKill = async () => {
    const next = !killSwitch
    const { error } = await supabase.from('app_settings').update({ value: next, updated_by: profile!.id, updated_at: new Date().toISOString() }).eq('key', 'kill_switch')
    if (!error) {
      setKillSwitch(next)
      await supabase.from('audit_log').insert({ action: next ? 'kill_switch.on' : 'kill_switch.off' })
    }
  }

  const items: Page[] = ['feed', 'token', 'positions', 'settings']
  if (profile?.role === 'founder') items.push('users')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">MemeBot</div>
        {items.map((p) => (
          <button key={p} className="nav-item" aria-current={page === p ? 'page' : undefined} onClick={() => onNavigate(p)}>
            {TITLES[p]}
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
