import { useState } from 'react'
import { BarChart3, CalendarDays, Trophy as TrophyIcon, Flame, LayoutDashboard, Radio, RefreshCw, Rocket, Search, ShieldCheck, SlidersHorizontal, Trophy, Wallet, Zap } from 'lucide-react'
import { useDashboardData, useDashMode, useGmgnDash } from '../lib/dashboard'
import { useNav } from '../lib/nav'
import { canTrade, useAuth } from '../lib/auth'
import { dailySeries, funnel, sourcePerformance, startOfDay, summarize, type DPosition } from '../../../shared/dashboard'
import { Card, Empty, FunnelBars, Kpi, ModeSwitch, OpenPositions, PendingList, PnlChart, PnlKpis, RecentSignals, SourceTable, TrendingList, WalletStatsCards, ago, pct, sol, tone } from '../components/DashWidgets'
import { useHealth } from '../components/DashHealth'
import { useNow } from '../components/DashRails'
import { useDeploy } from '../components/DeployPanel'
import { PnlCalendar } from '../components/DashExtras'
import { TopCallers } from '../components/Callers'
import { useShareCard } from '../components/ShareCard'

// Dashboard: tüm veriler tek ekranda. Ana sayfanın yan panelleri bunun özetidir.
// Pozisyon/emir/sinyal verisi kendi veritabanımızdan, trend ve cüzdan istatistikleri GMGN'den (motor toplar) gelir.

const RANGES = [7, 14, 30, 90] as const

function ClosedTrades({ positions }: { positions: DPosition[] }) {
  const rows = positions.filter((p) => p.status === 'closed').slice(0, 8)
  if (!rows.length) return <Empty>Henüz kapanan işlem yok.</Empty>
  return (
    <div className="stable-wrap">
      <table className="stable">
        <thead>
          <tr>
            <th>Token</th>
            <th className="r">Maliyet</th>
            <th className="r">Gelen</th>
            <th className="r">Kâr/zarar</th>
            <th className="r">Kapanış</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const pnl = Number(p.proceeds_sol ?? 0) - Number(p.cost_sol ?? 0)
            return (
              <tr key={p.id}>
                <td>
                  <b>{p.symbol ?? `${p.mint.slice(0, 4)}…`}</b> {p.is_dry_run && <span className="badge">Deneme</span>}
                </td>
                <td className="r mono">{sol(Number(p.cost_sol ?? 0))}</td>
                <td className="r mono">{sol(Number(p.proceeds_sol ?? 0))}</td>
                <td className={`r mono ${tone(pnl) ?? ''}`}>{sol(pnl, true)}</td>
                <td className="r faint">{p.closed_at ? `${ago(p.closed_at)} önce` : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DashboardPage({ onCheck }: { onCheck: (mint: string) => void }) {
  const { profile } = useAuth()
  const { go } = useNav()
  const { open: openDeploy } = useDeploy()
  const data = useDashboardData()
  const [share, shareModal] = useShareCard()
  const [mode, setMode] = useDashMode()
  const { dash, configured } = useGmgnDash()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const now = useNow(1000)
  const nowD = new Date(now)

  const summary = summarize(data.positions, mode, nowD)
  const health = useHealth(data.orders, summary, mode, dash)
  const series = dailySeries(data.positions, mode, days, nowD)
  const f = funnel(data.signals, data.candidates, data.orders, mode, nowD)
  const sources = sourcePerformance(data.positions, data.signals, data.sources, mode, startOfDay(nowD, days - 1))
  const modePositions = data.positions.filter((p) => (mode === 'all' ? true : mode === 'dry' ? p.is_dry_run : !p.is_dry_run))
  const rangePnl = series.reduce((a, p) => a + p.pnl, 0)
  const trader = canTrade(profile?.role)

  return (
    <div className="stack" style={{ gap: 16 }}>
      {shareModal}
      <div className="dash-toolbar">
        <ModeSwitch mode={mode} onChange={setMode} />
        <div className="pills" aria-label="Dönem">
          {RANGES.map((d) => (
            <button key={d} className="pill" aria-selected={days === d} onClick={() => setDays(d)}>
              {d} gün
            </button>
          ))}
        </div>
        <span className="spacer" />
        {data.error && <span className="neg" style={{ fontSize: 12 }}>Veri alınamadı: {data.error}</span>}
        <button className="btn btn-sm btn-ghost" onClick={data.reload} title="Şimdi tazele">
          <RefreshCw size={13} /> Yenile
        </button>
      </div>

      {!data.loaded ? (
        <Empty>Yükleniyor…</Empty>
      ) : (
        <>
          <section>
            <PnlKpis s={summary} mode={mode} />
            <div className="kpi-grid" style={{ marginTop: 8 }}>
              <Kpi label="Kazanma oranı" value={summary.winrate === null ? '—' : pct(summary.winrate, false, 0)} sub={`${summary.wins} kazanç · ${summary.losses} zarar`} hint="Kapanan işlemler (90 gün)" />
              <Kpi label="Ort. kazanç / zarar" value={summary.avgWin === null ? '—' : sol(summary.avgWin, true)} sub={summary.avgLoss === null ? 'zarar yok' : `zarar ${sol(summary.avgLoss)}`} tone={tone(summary.avgWin)} />
              <Kpi label="En iyi / en kötü" value={summary.bestPnl === null ? '—' : sol(summary.bestPnl, true)} sub={summary.worstPnl === null ? '' : `en kötü ${sol(summary.worstPnl, true)}`} tone={tone(summary.bestPnl)} />
              <Kpi label="Açık maliyet" value={sol(summary.openCost)} sub={`${summary.openCount} / ${health.limits.maxOpenPositions} pozisyon`} />
              <Kpi label="Bugün harcanan" value={sol(health.spent)} sub={`limit ${sol(health.limits.dailyMaxSol)}`} tone={health.limits.dailyMaxSol > 0 && health.spent >= health.limits.dailyMaxSol * 0.8 ? 'warn' : undefined} />
              <Kpi label="Cüzdan bakiyesi" value={configured && dash?.balance !== undefined ? sol(dash.balance) : '—'} sub={configured ? 'GMGN' : 'GMGN anahtarı yok'} hint="Varsayılan GMGN cüzdanının SOL bakiyesi" />
            </div>
          </section>

          <div className="dgrid dgrid-2">
            <Card title={`Kâr / zarar · ${days} gün`} icon={<BarChart3 size={13} />} actions={<b className={`mono ${tone(rangePnl) ?? ''}`}>{sol(rangePnl, true)}</b>}>
              <PnlChart series={series} />
            </Card>
            <Card title="Bugünün hunisi" icon={<Radio size={13} />}>
              <FunnelBars f={f} />
            </Card>
          </div>

          <Card title="PnL takvimi" icon={<CalendarDays size={13} />}>
            <PnlCalendar positions={data.positions} mode={mode} onShare={share} />
          </Card>

          <div className="dgrid dgrid-2">
            <Card title={`Açık pozisyonlar (${summary.openCount})`} icon={<Wallet size={13} />} flush>
              <OpenPositions positions={modePositions} limit={10} />
            </Card>
            <Card title={`Onay bekleyenler (${data.pending.length})`} icon={<ShieldCheck size={13} />} flush>
              <PendingList pending={data.pending} now={now} />
            </Card>
          </div>

          <Card title="En çok kazandıran 10 kişi (Telegram grupları)" icon={<TrophyIcon size={13} />}>
            <TopCallers data={data} mode={mode} />
          </Card>

          <Card title={`Kaynak performansı · ${days} gün`} icon={<Trophy size={13} />} flush>
            <SourceTable rows={sources} />
          </Card>

          <div className="dgrid dgrid-2">
            <Card title="Trend token'lar (GMGN · 5 dk · hacme göre)" icon={<Flame size={13} />} flush>
              <TrendingList items={dash?.trending?.items ?? []} onCheck={onCheck} />
            </Card>
            <Card title="Cüzdan istatistikleri (GMGN)" icon={<Wallet size={13} />}>
              {configured ? <WalletStatsCards dash={dash} /> : <Empty>GMGN anahtarı girilince cüzdan istatistikleri burada görünür.</Empty>}
            </Card>
          </div>

          <div className="dgrid dgrid-2">
            <Card title="Son sinyaller" icon={<Radio size={13} />} flush>
              <RecentSignals rows={data.recentSignals} sources={data.sources} now={now} />
            </Card>
            <Card
              title="Son kapanan işlemler"
              icon={<LayoutDashboard size={13} />}
              flush
              actions={
                <button className="link faint" style={{ fontSize: 11, textDecoration: 'none' }} onClick={() => go('positions')}>
                  Pozisyonlar
                </button>
              }
            >
              <ClosedTrades positions={modePositions} />
            </Card>
          </div>

          <Card title="Hızlı işlemler" icon={<Zap size={13} />}>
            <div className="row">
              {trader && (
                <button className="btn btn-sm" onClick={() => openDeploy()}>
                  <Rocket size={13} /> Token deploy
                </button>
              )}
              <button className="btn btn-sm" onClick={() => go('token')}>
                <Search size={13} /> Token kontrol
              </button>
              <button className="btn btn-sm" onClick={() => window.dispatchEvent(new CustomEvent('memebot:panel', { detail: 'rules' }))}>
                <SlidersHorizontal size={13} /> Kurallar panosu
              </button>
              <button className="btn btn-sm" onClick={() => go('orders')}>
                Emirler
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
