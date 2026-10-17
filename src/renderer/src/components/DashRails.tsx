import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, CalendarDays, Flame, GripVertical, LayoutDashboard, Radio, ShieldCheck, Wallet } from 'lucide-react'
import { useDashboardData, useDashMode, useGmgnDash } from '../lib/dashboard'
import { useNav } from '../lib/nav'
import { usePrefs } from '../lib/prefs'
import { funnel, summarize } from '../../../shared/dashboard'
import { Card, FunnelBars, ModeSwitch, OpenPositions, PendingList, PnlKpis, RecentSignals, TrendingList } from './DashWidgets'
import { AlertList, HealthList, useHealth } from './DashHealth'
import { PnlCalendar, WalletSummary } from './DashExtras'

// Ana sayfanın (Canlı Akış) iki yanındaki paneller. Hangi kartların görüneceği ve yerleri kullanıcıya bağlı:
// alt çubuktaki "Paneller" menüsünden eklenir/kaldırılır, kart başlığındaki tutamaçtan sürüklenir.
// Geniş ekranda görünür; ayrıntı için Dashboard sayfası.

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Ortak veri: bütün paneller aynı kancayı paylaşsın diye tek yerde çağrılır. */
export function useRailData() {
  const data = useDashboardData()
  const [mode, setMode] = useDashMode()
  const { dash } = useGmgnDash()
  const now = useNow(1000)
  const summary = summarize(data.positions, mode)
  const health = useHealth(data.orders, summary, mode, dash)
  return { data, mode, setMode, dash, now, summary, health }
}
export type RailData = ReturnType<typeof useRailData>

// ---------------------------------------------------------------- panel kataloğu
export type RailSide = 'left' | 'right'
export interface RailLayout {
  left: string[]
  right: string[]
}

export const RAIL_WIDGETS = {
  summary: { title: 'Özet', icon: LayoutDashboard, desc: 'Bugün / 7 gün / 30 gün kâr-zarar' },
  open: { title: 'Açık pozisyonlar', icon: Wallet, desc: 'Elde tutulanlar, hızlı satış' },
  pending: { title: 'Onay bekleyenler', icon: ShieldCheck, desc: 'Karar bekleyen adaylar' },
  wallet: { title: 'Cüzdan özeti', icon: Wallet, desc: 'Bakiye ve 7 günlük GMGN istatistiği' },
  calendar: { title: 'PnL takvimi', icon: CalendarDays, desc: 'Günlük kâr/zarar ısı haritası' },
  alerts: { title: 'Uyarılar', icon: Activity, desc: 'Limit ve bağlantı uyarıları' },
  system: { title: 'Sistem', icon: Activity, desc: 'Motor, GMGN, X, Telegram durumu' },
  funnel: { title: 'Bugünün hunisi', icon: Radio, desc: 'Sinyalden alıma süreç' },
  trend: { title: 'Trend token\'lar', icon: Flame, desc: 'GMGN 5 dk hacim sıralaması' },
  signals: { title: 'Son sinyaller', icon: Radio, desc: 'En son gelen token adresleri' }
} as const
export type WidgetId = keyof typeof RAIL_WIDGETS

export const DEFAULT_RAILS: RailLayout = {
  left: ['summary', 'open', 'pending'],
  right: ['alerts', 'system', 'funnel', 'trend', 'signals']
}

const isWidget = (id: string): id is WidgetId => id in RAIL_WIDGETS

/** Kayıtlı yerleşim (tanınmayan/yinelenen kartlar ayıklanır); yoksa varsayılan. */
export function useRails() {
  const { layout, setLayout } = usePrefs()
  const saved = layout.rails
  const seen = new Set<string>()
  const clean = (ids: string[] | undefined) => (ids ?? []).filter((id) => isWidget(id) && !seen.has(id) && !!seen.add(id))
  const rails: RailLayout = saved ? { left: clean(saved.left), right: clean(saved.right) } : DEFAULT_RAILS

  const save = useCallback((next: RailLayout) => setLayout({ ...layout, rails: next }), [layout, setLayout])

  /** Kartı bir sütunun belirli sırasına taşır (kaldırıp ekler). */
  const move = useCallback(
    (id: string, side: RailSide, index: number) => {
      const without = { left: rails.left.filter((x) => x !== id), right: rails.right.filter((x) => x !== id) }
      const list = [...without[side]]
      list.splice(Math.max(0, Math.min(index, list.length)), 0, id)
      save({ ...without, [side]: list })
    },
    [rails, save]
  )
  const toggle = useCallback(
    (id: string) => {
      if (rails.left.includes(id) || rails.right.includes(id)) save({ left: rails.left.filter((x) => x !== id), right: rails.right.filter((x) => x !== id) })
      else save(rails.left.length < rails.right.length ? { ...rails, left: [...rails.left, id] } : { ...rails, right: [...rails.right, id] })
    },
    [rails, save]
  )
  const reset = useCallback(() => save(DEFAULT_RAILS), [save])
  return { rails, move, toggle, reset }
}

// ---------------------------------------------------------------- kartların içeriği
function Widget({ id, r, onCheck, grip }: { id: WidgetId; r: RailData; onCheck: (mint: string) => void; grip: ReactNode }) {
  const { go } = useNav()
  const meta = RAIL_WIDGETS[id]
  const Icon = meta.icon
  const icon = <Icon size={13} />
  const link = (label: string, to: Parameters<typeof go>[0]) => (
    <button className="link faint" style={{ fontSize: 11, textDecoration: 'none' }} onClick={() => go(to)}>
      {label}
    </button>
  )
  const modePositions = r.data.positions.filter((p) => (r.mode === 'all' ? true : r.mode === 'dry' ? p.is_dry_run : !p.is_dry_run))
  switch (id) {
    case 'summary':
      return (
        <Card title="Özet" icon={icon} grip={grip} actions={link('Dashboard', 'dashboard')}>
          <ModeSwitch mode={r.mode} onChange={r.setMode} />
          <PnlKpis s={r.summary} mode={r.mode} />
        </Card>
      )
    case 'open':
      return (
        <Card title={`Açık pozisyonlar (${r.summary.openCount})`} icon={icon} grip={grip} flush>
          <OpenPositions positions={modePositions} limit={6} compact />
        </Card>
      )
    case 'pending':
      return (
        <Card title={`Onay bekleyenler (${r.data.pending.length})`} icon={icon} grip={grip} flush>
          <PendingList pending={r.data.pending} now={r.now} />
        </Card>
      )
    case 'wallet':
      return (
        <Card title="Cüzdan özeti" icon={icon} grip={grip}>
          <WalletSummary dash={r.dash} />
        </Card>
      )
    case 'calendar':
      return (
        <Card title="PnL takvimi" icon={icon} grip={grip}>
          <PnlCalendar positions={r.data.positions} mode={r.mode} />
        </Card>
      )
    case 'alerts':
      return r.health.alerts.length ? (
        <div className="rail-bare">
          {grip}
          <AlertList alerts={r.health.alerts.slice(0, 3)} />
        </div>
      ) : null
    case 'system':
      return (
        <Card title="Sistem" icon={icon} grip={grip} flush actions={link('Hız', 'speed')}>
          <HealthList health={r.health} compact />
        </Card>
      )
    case 'funnel':
      return (
        <Card title="Bugünün hunisi" icon={icon} grip={grip}>
          <FunnelBars f={funnel(r.data.signals, r.data.candidates, r.data.orders, r.mode, new Date(r.now))} />
        </Card>
      )
    case 'trend':
      return (
        <Card title="Trend (GMGN · 5 dk)" icon={icon} grip={grip} flush>
          <TrendingList items={r.dash?.trending?.items ?? []} compact onCheck={onCheck} />
        </Card>
      )
    case 'signals':
      return (
        <Card title="Son sinyaller" icon={icon} grip={grip} flush>
          <RecentSignals rows={r.data.recentSignals.slice(0, 5)} sources={r.data.sources} now={r.now} />
        </Card>
      )
  }
}

// ---------------------------------------------------------------- sürükle-bırak
/** Tek bir panel sütunu. Kartlar başlıklarındaki tutamaçtan sürüklenir; sütunlar arası da taşınır. */
export function RailColumn({
  side,
  r,
  onCheck,
  rails,
  move
}: {
  side: RailSide
  r: RailData
  onCheck: (mint: string) => void
  rails: RailLayout
  move: (id: string, side: RailSide, index: number) => void
}) {
  const ids = rails[side]
  const [over, setOver] = useState<number | null>(null)
  const dragging = useRef<string | null>(null)
  const colRef = useRef<HTMLElement>(null)

  // Fare konumuna göre "kartın önüne mi sonuna mı" bırakılacağı
  const indexAt = (clientY: number): number => {
    const items = colRef.current?.querySelectorAll<HTMLElement>('[data-rail-id]')
    if (!items) return ids.length
    let i = 0
    for (const el of items) {
      const b = el.getBoundingClientRect()
      if (clientY < b.top + b.height / 2) return i
      i++
    }
    return i
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const id = dragging.current ?? e.dataTransfer.getData('text/plain')
    setOver(null)
    dragging.current = null
    if (!id) return
    let idx = indexAt(e.clientY)
    // Aynı sütunda aşağı taşırken kendi yeri çıkarılınca sıra bir kayar
    const from = ids.indexOf(id)
    if (from !== -1 && from < idx) idx--
    move(id, side, idx)
  }

  return (
    <aside
      ref={colRef}
      className={`rail rail-${side}${over !== null ? ' rail-over' : ''}`}
      aria-label={side === 'left' ? 'Sol paneller' : 'Sağ paneller'}
      onDragOver={(e) => {
        if (dragging.current === null && !e.dataTransfer.types.includes('text/plain')) return
        e.preventDefault()
        setOver(indexAt(e.clientY))
      }}
      onDragLeave={(e) => {
        if (!colRef.current?.contains(e.relatedTarget as Node)) setOver(null)
      }}
      onDrop={onDrop}
    >
      {ids.map((id, i) => {
        if (!isWidget(id)) return null
        const grip = (
          <span
            className="rail-grip"
            title="Sürükleyerek taşıyın"
            draggable
            onDragStart={(e) => {
              dragging.current = id
              e.dataTransfer.setData('text/plain', id)
              e.dataTransfer.effectAllowed = 'move'
              const item = (e.currentTarget as HTMLElement).closest('[data-rail-id]')
              if (item) e.dataTransfer.setDragImage(item, 12, 12)
            }}
            onDragEnd={() => {
              dragging.current = null
              setOver(null)
            }}
          >
            <GripVertical size={13} />
          </span>
        )
        return (
          <div key={id} data-rail-id={id} className={`rail-item${over === i ? ' drop-before' : ''}`}>
            <Widget id={id} r={r} onCheck={onCheck} grip={grip} />
          </div>
        )
      })}
      {over !== null && over >= ids.length && <div className="rail-drop-end" />}
      {ids.length === 0 && <div className="rail-empty">Kartları buraya sürükleyin ya da alt çubuktaki “Paneller”den ekleyin.</div>}
    </aside>
  )
}

export function LeftRail(p: { r: RailData; onCheck: (mint: string) => void; rails: RailLayout; move: (id: string, side: RailSide, index: number) => void }) {
  return <RailColumn side="left" {...p} />
}

export function RightRail(p: { r: RailData; onCheck: (mint: string) => void; rails: RailLayout; move: (id: string, side: RailSide, index: number) => void }) {
  return <RailColumn side="right" {...p} />
}
