import { useEffect, useState } from 'react'
import { PrefsProvider, usePrefs } from './lib/prefs'
import { DeployProvider } from './components/DeployPanel'
import { keyCombo, type KeyAction } from '../../shared/settings'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase, supabaseConfigured } from './lib/supabase'
import { PipelineProvider } from './lib/pipeline'
import { KillSwitchProvider } from './lib/killswitch'
import { EngineProvider } from './lib/engine'
import { OrdersProvider } from './lib/orders'
import { APP_VERSION, desktop, isDesktop, versionLess } from './lib/platform'
import { ApprovalsPage } from './pages/Approvals'
import { RulesPage } from './pages/Rules'
import { OrdersPage } from './pages/Orders'
import { Layout, type Page } from './components/Layout'
import { LoginPage } from './pages/Login'
import { FeedPage } from './pages/Feed'
import { SourcesPage } from './pages/Sources'
import { TokenCheckPage } from './pages/TokenCheck'
import { PositionsPage } from './pages/Positions'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users'

export function App() {
  if (!supabaseConfigured) {
    return (
      <div className="login-wrap">
        <div className="login">
          <h1>Yapılandırma eksik</h1>
          <p className="muted">
            Supabase adresi ve anahtarı bulunamadı. Proje kökündeki <span className="mono">.env.example</span> dosyasını{' '}
            <span className="mono">.env</span> olarak kopyalayıp doldurun ve uygulamayı yeniden derleyin.
          </p>
        </div>
      </div>
    )
  }
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

// Masaüstünde eski sürüm motorla çalışamaz: founder'ın belirlediği en düşük sürümün altındaysa güncelleme iste
function useOutdated(enabled: boolean): string | null {
  const [min, setMin] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !isDesktop) return
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'min_app_version')
      .maybeSingle()
      .then(({ data }) => typeof data?.value === 'string' && setMin(data.value))
  }, [enabled])
  return min && versionLess(APP_VERSION, min) ? min : null
}

function Gate() {
  const { loading, session, profile } = useAuth()
  const [page, setPage] = useState<Page>('feed')
  const [checkTarget, setCheckTarget] = useState<{ mint: string; n: number } | null>(null)
  const outdated = useOutdated(!!profile)

  if (loading) return <div className="login-wrap muted">Yükleniyor…</div>
  if (!session || !profile) return <LoginPage />
  if (outdated) {
    return (
      <div className="login-wrap">
        <div className="login">
          <h1>Güncelleme gerekli</h1>
          <p className="muted">
            Bu sürüm ({APP_VERSION}) artık desteklenmiyor; en az {outdated} gerekli. Güncelleme arka planda iniyor, birazdan
            uygulamayı yeniden başlatmanız istenecek.
          </p>
          <button className="btn" onClick={() => desktop?.updater.check()}>
            Güncellemeyi denetle
          </button>
        </div>
      </div>
    )
  }

  const openCheck = (mint: string) => {
    setCheckTarget((prev) => ({ mint, n: (prev?.n ?? 0) + 1 }))
    setPage('token')
  }

  return (
    <KillSwitchProvider>
      <EngineProvider>
        <PipelineProvider>
          <PrefsProvider>
          <OrdersProvider>
          <DeployProvider>
            <Shortcuts onNavigate={(p) => setPage(p)} />
            <Layout
              page={page}
              onNavigate={(p) => {
                setCheckTarget(null)
                setPage(p)
              }}
            >
              {page === 'feed' && <FeedPage onCheck={openCheck} />}
              {page === 'approvals' && <ApprovalsPage onCheck={openCheck} />}
              {page === 'sources' && <SourcesPage />}
              {page === 'token' && <TokenCheckPage key={checkTarget?.n ?? 0} initial={checkTarget?.mint} />}
              {page === 'positions' && <PositionsPage />}
              {page === 'orders' && <OrdersPage />}
              {page === 'rules' && <RulesPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'users' && profile.role === 'founder' && <UsersPage />}
            </Layout>
          </DeployProvider>
          </OrdersProvider>
          </PrefsProvider>
        </PipelineProvider>
      </EngineProvider>
    </KillSwitchProvider>
  )
}

// Klavye kısayolları (Ayarlar → Kısayollar). Yazı alanlarında sadece F tuşları çalışır.
function Shortcuts({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { keybinds, setActivePreset } = usePrefs()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = keyCombo(e)
      if (!combo) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing && !/^F\d+$/.test(combo)) return
      const action = (Object.keys(keybinds) as KeyAction[]).find((a) => keybinds[a] === combo)
      if (!action) return
      e.preventDefault()
      if (action === 'preset1' || action === 'preset2' || action === 'preset3') setActivePreset(Number(action.slice(-1)) as 1 | 2 | 3)
      else if (action === 'feed' || action === 'approvals' || action === 'positions') onNavigate(action)
      else if (action === 'deploy') window.dispatchEvent(new CustomEvent('memebot:deploy'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keybinds, setActivePreset, onNavigate])
  return null
}
