import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCheck,
  CircleDollarSign,
  Gauge,
  History,
  House,
  Layers,
  LineChart,
  LogOut,
  Maximize,
  Minimize,
  Palette,
  Pause,
  Play,
  Rocket,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Users,
  type LucideIcon
} from 'lucide-react'
import { ROLE_LABEL, canTrade, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useKillSwitch } from '../lib/killswitch'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
import { useEngine } from '../lib/engine'
import { usePrefs } from '../lib/prefs'
import { useNav, type Page } from '../lib/nav'
import { useDeploy } from './DeployPanel'
import { FeesPopover } from './FeesPopover'
import { ConnPanel, EnginePanel, HistoryPanel, ModePanel, ThemePanel } from './StatusPanels'
import { APP_VERSION, desktop, isDesktop } from '../lib/platform'
import type { UpdateStatus } from '../../../shared/types'

// Uygulama kabuğu: ortalanmış üst menü, sayfa içeriği, alt durum çubuğu (bağlantı, motor, ücret preset'i).

const HEAD: Partial<Record<Page, { icon: LucideIcon; title: string; sub: string }>> = {
  approvals: { icon: CheckCheck, title: 'Onay Bekleyenler', sub: 'Güvenlikten geçen sinyaller' },
  positions: { icon: LineChart, title: 'Pozisyonlar', sub: 'Açık ve kapanan işlemler' },
  orders: { icon: ScrollText, title: 'Emirler', sub: 'Alım-satım geçmişi' },
  token: { icon: Search, title: 'Token Kontrol', sub: 'Adres ya da mesaj yapıştırın' }
}

export function Layout({ children }: { children: ReactNode }) {
  const { page, go } = useNav()
  const { profile } = useAuth()
  const killSwitch = useKillSwitch()
  const { online } = useEngine()
  const head = HEAD[page]

  return (
    <div className="app">
      <TopBar />
      {!online && (
        <div className="banner">
          Motor çalışmıyor: sinyaller işlenmiyor, alım-satım yapılamaz.
          <button className="link" onClick={() => go('settings', 'connections')}>
            Ayarlar → GMGN ve motor
          </button>
        </div>
      )}
      <main className="main">
        {killSwitch && (
          <div className="paused-pill" title={profile?.role === 'founder' ? 'Üst menüden devam ettirebilirsiniz' : 'Founder durdurdu'}>
            <Pause size={12} strokeWidth={3} /> İşlemler durduruldu
          </div>
        )}
        {head ? (
          <>
            <div className="page-head">
              <span className="page-head-icon">
                <head.icon size={16} />
              </span>
              <div>
                <h1>{head.title}</h1>
                <div className="page-head-sub">{head.sub}</div>
              </div>
            </div>
            <div className="page">{children}</div>
          </>
        ) : (
          children
        )}
      </main>
      <StatusBar />
    </div>
  )
}

function TopBar() {
  const { page, section, go } = useNav()
  const { profile, signOut } = useAuth()
  const killSwitch = useKillSwitch()
  const { pendingCount, state, lastError, rule } = usePipeline()
  const { autoNotice } = useOrders()
  const { open: openDeploy } = useDeploy()
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [tracked, setTracked] = useState<number | null>(null)
  const [full, setFull] = useState(!!document.fullscreenElement)

  useEffect(() => desktop?.updater.onStatus(setUpdate), [])

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // İzlenen hesap/kanal sayısı (üst menüdeki ilk düğme)
  useEffect(() => {
    if (!profile) return
    const load = () =>
      supabase
        .from('sources')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_active', true)
        .neq('type', 'manual')
        .then(({ count }) => setTracked(count ?? 0))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [profile?.id, page])

  const toggleKill = async () => {
    const next = !killSwitch
    const { error } = await supabase
      .from('app_settings')
      .update({ value: next, updated_by: profile!.id, updated_at: new Date().toISOString() })
      .eq('key', 'kill_switch')
    if (!error) await supabase.from('audit_log').insert({ action: next ? 'kill_switch.on' : 'kill_switch.off' })
  }

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)

  const inSettings = page === 'settings'
  const deploySection = section === 'deploy' || section === 'wallets'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand">MemeBot</span>
      </div>

      <nav className="topnav">
        <button className={`tb ${inSettings && section === 'accounts' ? 'on' : ''}`} title="İzlenen hesaplar" onClick={() => go('settings', 'accounts')}>
          <Users size={14} />
          {tracked ?? '–'}
        </button>
        <button className={`tb ${inSettings && section !== 'accounts' && !deploySection ? 'on' : ''}`} onClick={() => go('settings', section === 'accounts' || deploySection ? 'connections' : section)}>
          <SettingsIcon size={14} />
          <span className="tb-label">Ayarlar</span>
        </button>
        <button className={`tb icon ${page === 'feed' ? 'on' : ''}`} title="Canlı akış" onClick={() => go('feed')}>
          <House size={14} />
        </button>
        <button className={`tb icon ${page === 'token' ? 'on' : ''}`} title="Token kontrol" onClick={() => go('token')}>
          <Search size={14} />
        </button>
        <button className="tb icon" title={full ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleFull}>
          {full ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
        <span className="topnav-sep" />
        <button className={`tb ${page === 'approvals' ? 'on' : ''}`} onClick={() => go('approvals')}>
          <CheckCheck size={14} />
          <span className="tb-label">Onay</span>
          {pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </button>
        <button className={`tb ${page === 'positions' ? 'on' : ''}`} onClick={() => go('positions')}>
          <LineChart size={14} />
          <span className="tb-label">Pozisyonlar</span>
        </button>
        <button className={`tb ${page === 'orders' ? 'on' : ''}`} onClick={() => go('orders')}>
          <ScrollText size={14} />
          <span className="tb-label">Emirler</span>
        </button>
        <span className="topnav-sep" />
        {canTrade(profile?.role) && (
          <button className="tb" title="Boş deploy formu" onClick={() => openDeploy()}>
            <Rocket size={14} />
            <span className="tb-label">Oluştur</span>
          </button>
        )}
        <button className={`tb ${inSettings && deploySection ? 'on' : ''}`} onClick={() => go('settings', 'deploy')}>
          <Layers size={14} />
          <span className="tb-label">Deploy Ayarları</span>
        </button>
      </nav>

      <div className="topbar-right">
        {rule.mode === 'auto' && <span className={`badge ${rule.limits.liveTrading ? 'fail' : 'warn'}`}>OTOMATİK · {rule.limits.liveTrading ? 'GERÇEK' : 'DENEME'}</span>}
        {autoNotice && (
          <span className="neg ellipsis" style={{ maxWidth: 220, fontSize: 12 }} title={autoNotice}>
            {autoNotice}
          </span>
        )}
        {state === 'working' && <span className="faint" style={{ fontSize: 12 }}>Kontrol…</span>}
        {state === 'no_key' && (
          <button className="tb danger" onClick={() => go('settings', 'connections')}>
            GMGN anahtarı yok
          </button>
        )}
        {lastError && state !== 'no_key' && (
          <span className="badge fail" title={lastError}>
            Kontrol hatası
          </span>
        )}
        {update.state === 'ready' && (
          <button className="tb" onClick={() => desktop?.updater.install()}>
            v{update.version} hazır — yeniden başlat
          </button>
        )}
        {update.state === 'downloading' && <span className="faint" style={{ fontSize: 12 }}>Güncelleme %{update.percent}</span>}
        {profile?.role === 'founder' && (
          <button className={`tb ${killSwitch ? '' : 'danger'}`} title={killSwitch ? 'İşlemleri devam ettir' : 'Tüm işlemleri durdur (kill switch)'} onClick={toggleKill}>
            {killSwitch ? <Play size={13} /> : <Pause size={13} />}
            {killSwitch ? 'Devam' : 'Durdur'}
          </button>
        )}
        <span className="tb" style={{ cursor: 'default' }} title={profile ? ROLE_LABEL[profile.role] : undefined}>
          <span className="avatar sm avatar-text">{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</span>
          <span className="tb-name">{profile?.username}</span>
        </span>
        <button className="tb icon" title="Çıkış" onClick={signOut}>
          <LogOut size={14} />
        </button>
      </div>
    </header>
  )
}

// Alt durum çubuğu: her kısayol kendi mini panelini açar (bağlantı, motor, geçmiş, ücret, işlem modu, görünüm).
// Başka bir yerden açmak için: window.dispatchEvent(new CustomEvent('memebot:panel', { detail: 'fees' }))
type PanelName = 'conn' | 'engine' | 'history' | 'fees' | 'mode' | 'theme'

const PANEL_WIDTH: Record<PanelName, number> = { conn: 300, engine: 300, history: 340, fees: 300, mode: 300, theme: 320 }

function StatusBar() {
  const { online, status } = useEngine()
  const { rule } = usePipeline()
  const { activePreset } = usePrefs()
  const [connected, setConnected] = useState(true)
  const [panel, setPanel] = useState<{ name: PanelName; left: number } | null>(null)
  const barRef = useRef<HTMLElement>(null)

  // Kendi kanalımızın durumu (kopunca istemci kendisi yeniden bağlanır)
  useEffect(() => {
    const ch = supabase.channel('statusbar-ping').subscribe((st) => setConnected(st === 'SUBSCRIBED'))
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const openAt = useCallback((name: PanelName, el: HTMLElement | null) => {
    const bar = barRef.current
    if (!bar || !el) return
    const w = PANEL_WIDTH[name]
    const left = el.getBoundingClientRect().left - bar.getBoundingClientRect().left
    setPanel({ name, left: Math.max(8, Math.min(left, bar.clientWidth - w - 8)) })
  }, [])

  useEffect(() => {
    const on = (e: Event) => {
      const name = (e as CustomEvent<PanelName>).detail
      openAt(name, barRef.current?.querySelector<HTMLElement>(`[data-panel="${name}"]`) ?? null)
    }
    window.addEventListener('memebot:panel', on)
    return () => window.removeEventListener('memebot:panel', on)
  }, [openAt])

  const close = useCallback(() => setPanel(null), [])
  const btn = (name: PanelName) => ({
    'data-panel': name,
    className: `sb-item ${panel?.name === name ? 'open' : ''}`,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => (panel?.name === name ? close() : openAt(name, e.currentTarget))
  })
  const left = panel?.left ?? 8

  return (
    <footer className="statusbar" ref={barRef}>
      <button {...btn('conn')}>
        <span className={`dot ${connected ? 'on' : 'off'}`} />
        {connected ? 'Bağlı' : 'Bağlantı yok'}
      </button>
      <button {...btn('engine')}>
        <Gauge size={12} />
        Motor {online ? 'çalışıyor' : 'kapalı'}
      </button>
      <button {...btn('history')}>
        <History size={12} />
        Geçmiş
      </button>
      <button {...btn('fees')}>
        <CircleDollarSign size={12} />
        Ücret <span className="sb-pill">P{activePreset}</span>
      </button>
      <button {...btn('mode')}>
        <span className={rule.limits.liveTrading ? 'neg' : undefined}>{rule.limits.liveTrading ? 'GERÇEK işlem' : 'Deneme modu'}</span>
        <span className="faint">· {rule.mode === 'auto' ? 'otomatik' : rule.mode === 'manual' ? 'manuel' : 'izle'}</span>
      </button>

      {panel?.name === 'conn' && <ConnPanel connected={connected} onClose={close} left={left} />}
      {panel?.name === 'engine' && <EnginePanel onClose={close} left={left} />}
      {panel?.name === 'history' && <HistoryPanel onClose={close} left={left} />}
      {panel?.name === 'fees' && <FeesPopover onClose={close} left={left} />}
      {panel?.name === 'mode' && <ModePanel onClose={close} left={left} />}
      {panel?.name === 'theme' && <ThemePanel onClose={close} left={left} />}

      <div className="sb-right">
        {online && (
          <button {...btn('engine')} data-panel={undefined} title="Motorun çalıştığı yer · GMGN gecikmesi">
            <span className="sb-region">{(status?.host ?? 'MOTOR').toUpperCase()}</span>
            {status?.gmgn_latency_ms != null && <span className="pos">{status.gmgn_latency_ms}ms</span>}
          </button>
        )}
        <button {...btn('theme')}>
          <Palette size={12} />
          Görünüm
        </button>
        <span className="sb-item faint">
          {isDesktop ? 'Masaüstü' : 'Web'} · v{APP_VERSION}
        </span>
      </div>
    </footer>
  )
}
