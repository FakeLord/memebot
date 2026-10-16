import { useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Droplet,
  Info,
  Keyboard,
  LayoutGrid,
  Plug,
  Radio,
  Search,
  SlidersHorizontal,
  Star,
  UserCog,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useNav, type Section } from '../lib/nav'
import { AccountsSection } from './settings/Accounts'
import { KeywordsSection } from './settings/Keywords'
import { AppearanceSection } from './settings/Appearance'
import { ShortcutsSection } from './settings/Shortcuts'
import { DeploySettingsSection } from './settings/DeploySettings'
import { WalletsSection } from './settings/Wallets'
import { ConnectionsSection } from './settings/Connections'
import { AboutSection } from './settings/About'
import { SourcesPage } from './Sources'
import { RulesPage } from './Rules'
import { UsersPage } from './Users'

type Item = { id: Section; label: string; icon: LucideIcon; founder?: boolean }

const MENU: { group: string; items: Item[] }[] = [
  {
    group: 'Takip',
    items: [
      { id: 'accounts', label: 'Hesaplar', icon: Users },
      { id: 'sources', label: 'Kaynaklar', icon: Radio },
      { id: 'appearance', label: 'Görünüm', icon: Droplet },
      { id: 'keywords', label: 'Anahtar kelimeler', icon: Star }
    ]
  },
  {
    group: 'İşlem',
    items: [
      { id: 'rules', label: 'Kurallar', icon: SlidersHorizontal },
      { id: 'connections', label: 'GMGN ve motor', icon: Plug }
    ]
  },
  {
    group: 'Deploy',
    items: [
      { id: 'deploy', label: 'Genel', icon: LayoutGrid },
      { id: 'wallets', label: 'Cüzdanlar', icon: Wallet }
    ]
  },
  {
    group: 'Uygulama',
    items: [
      { id: 'shortcuts', label: 'Kısayollar', icon: Keyboard },
      { id: 'users', label: 'Kullanıcılar', icon: UserCog, founder: true },
      { id: 'about', label: 'Hakkında', icon: Info }
    ]
  }
]

export function SettingsPage() {
  const { section, go } = useNav()
  const { profile } = useAuth()
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('memebot.settingsNav') === 'collapsed'
    } catch {
      return false
    }
  })
  const collapse = (v: boolean) => {
    setCollapsed(v)
    try {
      localStorage.setItem('memebot.settingsNav', v ? 'collapsed' : 'open')
    } catch {
      /* depolama kapalı olabilir */
    }
  }
  const founder = profile?.role === 'founder'
  const ql = q.trim().toLocaleLowerCase('tr')
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => (!i.founder || founder) && (!ql || i.label.toLocaleLowerCase('tr').includes(ql))) })).filter(
    (g) => g.items.length
  )
  const group = MENU.find((g) => g.items.some((i) => i.id === section)) ?? MENU[0]
  const item = group.items.find((i) => i.id === section) ?? group.items[0]
  const open = (id: Section) => go('settings', id)

  return (
    <div className={`settings${collapsed ? ' collapsed' : ''}`}>
      <nav className="settings-nav">
        <div className="settings-nav-head">
          Ayarlar
          <button className="icon-btn sm" title="Menüyü daralt" onClick={() => collapse(true)}>
            <PanelLeftClose size={14} />
          </button>
        </div>
        <label className="search">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ayarlarda ara" />
        </label>
        {groups.map((g) => (
          <div key={g.group} style={{ display: 'grid', gap: 1 }}>
            <div className="settings-group">{g.group}</div>
            {g.items.map((i) => (
              <button key={i.id} className="nav-item" aria-current={section === i.id ? 'page' : undefined} onClick={() => open(i.id)}>
                <i.icon size={14} />
                {i.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-main">
        <div className="page-head">
          {collapsed && (
            <button className="icon-btn" title="Menüyü aç" onClick={() => collapse(false)}>
              <PanelLeftOpen size={15} />
            </button>
          )}
          <span className="page-head-icon">
            <item.icon size={16} />
          </span>
          <div>
            <h1>{item.label}</h1>
            <div className="page-head-sub">{group.group} ayarları</div>
          </div>
        </div>
        <div className="settings-body">
          {section === 'accounts' && <AccountsSection />}
          {section === 'sources' && <SourcesPage />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'keywords' && <KeywordsSection />}
          {section === 'rules' && <RulesPage />}
          {section === 'connections' && <ConnectionsSection />}
          {section === 'deploy' && <DeploySettingsSection />}
          {section === 'wallets' && <WalletsSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'users' && founder && <UsersPage />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  )
}
