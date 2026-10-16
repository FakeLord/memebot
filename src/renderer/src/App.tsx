import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import { Layout, type Page } from './components/Layout'
import { LoginPage } from './pages/Login'
import { FeedPage } from './pages/Feed'
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

  if (loading) return <div className="login-wrap muted">Yükleniyor…</div>
  if (!session || !profile) return <LoginPage />

  return (
    <Layout page={page} onNavigate={setPage}>
      {page === 'feed' && <FeedPage />}
      {page === 'token' && <TokenCheckPage />}
      {page === 'positions' && <PositionsPage />}
      {page === 'settings' && <SettingsPage />}
      {page === 'users' && profile.role === 'founder' && <UsersPage />}
    </Layout>
  )
}
