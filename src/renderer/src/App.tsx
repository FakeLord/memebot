import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import { TelegramProvider } from './lib/telegram'
import { XSourceProvider } from './lib/xsource'
import { PipelineProvider } from './lib/pipeline'
import { KillSwitchProvider } from './lib/killswitch'
import { ApprovalsPage } from './pages/Approvals'
import { RulesPage } from './pages/Rules'
import { OrdersPage } from './pages/Orders'
import { OrdersProvider } from './lib/orders'
import { TrackerProvider } from './lib/tracker'
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

function Gate() {
  const { loading, session, profile } = useAuth()
  const [page, setPage] = useState<Page>('feed')
  const [checkTarget, setCheckTarget] = useState<{ mint: string; n: number } | null>(null)

  if (loading) return <div className="login-wrap muted">Yükleniyor…</div>
  if (!session || !profile) return <LoginPage />

  const openCheck = (mint: string) => {
    setCheckTarget((prev) => ({ mint, n: (prev?.n ?? 0) + 1 }))
    setPage('token')
  }

  return (
    <KillSwitchProvider>
      <TelegramProvider>
        <XSourceProvider>
          <PipelineProvider>
            <OrdersProvider>
              <TrackerProvider>
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
              </TrackerProvider>
            </OrdersProvider>
          </PipelineProvider>
        </XSourceProvider>
      </TelegramProvider>
    </KillSwitchProvider>
  )
}
