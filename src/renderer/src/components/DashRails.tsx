import { useEffect, useState } from 'react'
import { Activity, Flame, LayoutDashboard, Radio, ShieldCheck, Wallet } from 'lucide-react'
import { useDashboardData, useDashMode, useGmgnDash } from '../lib/dashboard'
import { useNav } from '../lib/nav'
import { funnel, summarize } from '../../../shared/dashboard'
import { Card, FunnelBars, ModeSwitch, OpenPositions, PendingList, PnlKpis, RecentSignals, TrendingList } from './DashWidgets'
import { AlertList, HealthList, useHealth } from './DashHealth'

// Ana sayfanın (Canlı Akış) iki yanındaki paneller. Geniş ekranda görünür; ayrıntı için Dashboard sayfası.

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Ortak veri: sol ve sağ panel aynı kancayı paylaşsın diye tek yerde çağrılır. */
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

export function LeftRail({ r }: { r: RailData }) {
  const { go } = useNav()
  return (
    <aside className="rail rail-left" aria-label="Özet">
      <Card
        title="Özet"
        icon={<LayoutDashboard size={13} />}
        actions={
          <button className="link faint" style={{ fontSize: 11, textDecoration: 'none' }} onClick={() => go('dashboard')}>
            Dashboard
          </button>
        }
      >
        <ModeSwitch mode={r.mode} onChange={r.setMode} />
        <PnlKpis s={r.summary} mode={r.mode} />
      </Card>
      <Card title={`Açık pozisyonlar (${r.summary.openCount})`} icon={<Wallet size={13} />} flush>
        <OpenPositions positions={r.data.positions.filter((p) => (r.mode === 'all' ? true : r.mode === 'dry' ? p.is_dry_run : !p.is_dry_run))} limit={6} compact />
      </Card>
      <Card title={`Onay bekleyenler (${r.data.pending.length})`} icon={<ShieldCheck size={13} />} flush>
        <PendingList pending={r.data.pending} now={r.now} />
      </Card>
    </aside>
  )
}

export function RightRail({ r, onCheck }: { r: RailData; onCheck: (mint: string) => void }) {
  const { go } = useNav()
  const f = funnel(r.data.signals, r.data.candidates, r.data.orders, r.mode, new Date(r.now))
  return (
    <aside className="rail rail-right" aria-label="Sistem">
      <AlertList alerts={r.health.alerts.slice(0, 3)} />
      <Card title="Sistem" icon={<Activity size={13} />} flush actions={<button className="link faint" style={{ fontSize: 11, textDecoration: 'none' }} onClick={() => go('speed')}>Hız</button>}>
        <HealthList health={r.health} compact />
      </Card>
      <Card title="Bugünün hunisi" icon={<Radio size={13} />}>
        <FunnelBars f={f} />
      </Card>
      <Card title="Trend (GMGN · 5 dk)" icon={<Flame size={13} />} flush>
        <TrendingList items={r.dash?.trending?.items ?? []} compact onCheck={onCheck} />
      </Card>
      <Card title="Son sinyaller" icon={<Radio size={13} />} flush>
        <RecentSignals rows={r.data.recentSignals.slice(0, 5)} sources={r.data.sources} now={r.now} />
      </Card>
    </aside>
  )
}
