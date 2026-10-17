import { createContext, useContext } from 'react'

// Sayfa gezintisi: üst menüdeki sayfalar + Ayarlar'ın sol menü bölümleri.
// Herhangi bir bileşen useNav().go(...) ile başka sayfaya/bölüme geçebilir.

export type Page = 'feed' | 'dashboard' | 'approvals' | 'positions' | 'orders' | 'token' | 'speed' | 'settings'

export type Section =
  | 'accounts'
  | 'sources'
  | 'appearance'
  | 'keywords'
  | 'rules'
  | 'connections'
  | 'deploy'
  | 'wallets'
  | 'shortcuts'
  | 'users'
  | 'account'
  | 'callers'
  | 'notifications'
  | 'about'

interface NavCtx {
  page: Page
  section: Section
  go: (page: Page, section?: Section) => void
}

export const NavContext = createContext<NavCtx>({ page: 'feed', section: 'accounts', go: () => undefined })
export const useNav = () => useContext(NavContext)
