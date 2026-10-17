import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react'
import { useOrders, type PositionRow } from '../lib/orders'
import { usePipeline } from '../lib/pipeline'
import { canTrade, useAuth } from '../lib/auth'
import { useKillSwitch } from '../lib/killswitch'
import { useNav } from '../lib/nav'
import { heldValueSol, positionPnl, type DayPoint, type DPosition, type DSource, type Funnel, type Mode, type PnlSummary, type SourceRow } from '../../../shared/dashboard'
import type { DashGmgn, DashTrend, DashWalletStats } from '../../../shared/engine'
import type { PendingCandidate } from '../lib/dashboard'
import { StatusPill } from './ui'

// Dashboard parçaları: ana sayfanın yan panelleri ve Dashboard sayfası aynı bileşenleri kullanır.

// ---------------------------------------------------------------- biçimler
export const sol = (v: number | null | undefined, sign = false) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const d = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 3 : 4
  return `${sign && v > 0 ? '+' : ''}${v.toFixed(d)} SOL`
}
export const usd = (v: number | null | undefined, sign = false) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const t = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(2) : a.toPrecision(2)
  return `${v < 0 ? '-' : sign && v > 0 ? '+' : ''}$${t}`
}
export const pct = (v: number | null | undefined, sign = false, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
export const tone = (v: number | null | undefined): 'pos' | 'neg' | undefined => (v == null || v === 0 ? undefined : v > 0 ? 'pos' : 'neg')
export const ago = (iso: string | number | null | undefined, now = Date.now()) => {
  if (iso == null) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.floor(s / 60)} dk` : s < 86400 ? `${Math.floor(s / 3600)} sa` : `${Math.floor(s / 86400)} g`
}

// ---------------------------------------------------------------- küçük yapı taşları
export function Card({ title, icon, actions, children, flush }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="dcard">
      <header className="dcard-head">
        <span className="dcard-title">
          {icon} {title}
        </span>
        {actions && <span className="dcard-actions">{actions}</span>}
      </header>
      <div className={flush ? 'dcard-body flush' : 'dcard-body'}>{children}</div>
    </section>
  )
}

export function Kpi({ label, value, sub, tone: t, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'warn'; hint?: string }) {
  return (
    <div className="kpi" title={hint}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${t ?? ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="pills" role="tablist" aria-label="Gösterilecek işlemler">
      {([['live', 'Gerçek'], ['dry', 'Deneme'], ['all', 'Tümü']] as const).map(([m, l]) => (
        <button key={m} className="pill" role="tab" aria-selected={mode === m} onClick={() => onChange(m)}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="dempty">{children}</div>
}

// ---------------------------------------------------------------- kâr/zarar özeti
export function PnlKpis({ s, mode }: { s: PnlSummary; mode: Mode }) {
  return (
    <div className="kpi-grid">
      <Kpi label="Bugün (kapanan)" value={sol(s.today, true)} tone={tone(s.today)} hint="Bugün kapanan pozisyonların kâr/zararı" />
      <Kpi
        label="Açık (tahmini)"
        value={sol(s.openUnrealized, true)}
        tone={tone(s.openUnrealized)}
        sub={s.openUnknown ? `${s.openUnknown} pozisyonun fiyatı yok` : `${s.openCount} pozisyon`}
        hint="Açık pozisyonların güncel fiyata göre tahmini kâr/zararı"
      />
      <Kpi label="7 gün" value={sol(s.d7, true)} tone={tone(s.d7)} sub={mode === 'dry' ? 'deneme' : undefined} />
      <Kpi label="30 gün" value={sol(s.d30, true)} tone={tone(s.d30)} />
    </div>
  )
}

// ---------------------------------------------------------------- grafikler (SVG)
export function PnlChart({ series }: { series: DayPoint[] }) {
  const W = 640
  const H = 160
  const pad = { l: 8, r: 8, t: 10, b: 20 }
  const any = series.some((p) => p.trades > 0)
  const { path, area, bars, zeroY, ticks, lo, hi } = useMemo(() => {
    const cums = series.map((p) => p.cum)
    const pnls = series.map((p) => p.pnl)
    const lo = Math.min(0, ...cums, ...pnls)
    const hi = Math.max(0, ...cums, ...pnls)
    const span = hi - lo || 1
    const x = (i: number) => pad.l + (series.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (series.length - 1)) * (W - pad.l - pad.r))
    const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
    const bw = Math.max(2, Math.min(18, ((W - pad.l - pad.r) / Math.max(1, series.length)) * 0.6))
    const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`)
    const zeroY = y(0)
    return {
      path: pts.length ? `M${pts.join(' L')}` : '',
      area: pts.length ? `M${x(0).toFixed(1)},${zeroY.toFixed(1)} L${pts.join(' L')} L${x(series.length - 1).toFixed(1)},${zeroY.toFixed(1)} Z` : '',
      bars: series.map((p, i) => ({ x: x(i) - bw / 2, y: Math.min(y(p.pnl), zeroY), h: Math.abs(y(p.pnl) - zeroY), w: bw, pos: p.pnl >= 0, day: p.day, pnl: p.pnl, trades: p.trades })),
      zeroY,
      ticks: [0, Math.floor((series.length - 1) / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0).map((i) => ({ x: x(i), label: series[i]?.day.slice(5) })),
      lo,
      hi
    }
  }, [series])
  const last = series[series.length - 1]
  if (!any) return <Empty>Bu dönemde kapanan işlem yok.</Empty>
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Günlük ve birikimli kâr/zarar">
        <title>Günlük kâr/zarar (çubuk) ve birikimli eğri</title>
        <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="3 3" />
        {bars.map((b) => (
          <rect key={b.day} x={b.x} y={b.y} width={b.w} height={Math.max(b.h, b.pnl === 0 ? 0 : 1)} rx={1.5} fill={b.pos ? 'var(--pos)' : 'var(--neg)'} opacity={0.35}>
            <title>{`${b.day}: ${sol(b.pnl, true)} · ${b.trades} işlem`}</title>
          </rect>
        ))}
        <path d={area} fill="var(--accent)" opacity={0.08} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {ticks.map((t) => (
          <text key={t.label} x={t.x} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--faint)">
            {t.label}
          </text>
        ))}
      </svg>
      <div className="chart-foot">
        <span className="faint">
          {sol(lo, true)} … {sol(hi, true)}
        </span>
        <span className={tone(last?.cum)}>Birikimli {sol(last?.cum, true)}</span>
      </div>
    </div>
  )
}

export function FunnelBars({ f }: { f: Funnel }) {
  const rows: { label: string; v: number; cls?: string }[] = [
    { label: 'Sinyal', v: f.signals },
    { label: 'Güvenlikten geçen', v: f.candidates },
    { label: 'Onaylanan', v: f.approved, cls: 'pos' },
    { label: 'Reddedilen', v: f.rejected, cls: 'neg' },
    { label: 'Süresi dolan', v: f.expired },
    { label: 'Alınan', v: f.bought, cls: 'pos' }
  ]
  const max = Math.max(1, ...rows.map((r) => r.v))
  return (
    <div className="funnel">
      {rows.map((r) => (
        <div key={r.label} className="funnel-row">
          <span className="funnel-label">{r.label}</span>
          <span className="funnel-track">
            <span className={`funnel-fill ${r.cls ?? ''}`} style={{ width: `${(r.v / max) * 100}%` }} />
          </span>
          <b className="mono">{r.v}</b>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- açık pozisyonlar
export function OpenPositions({ positions, limit, compact }: { positions: DPosition[]; limit?: number; compact?: boolean }) {
  const { profile } = useAuth()
  const { sell } = useOrders()
  const { rule } = usePipeline()
  const { go } = useNav()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const trader = canTrade(profile?.role)
  const list = positions.filter((p) => p.status === 'open').slice(0, limit ?? 99)
  const presets = rule.limits.sellPresetsPct.filter((n) => n > 0).slice(0, compact ? 2 : 3)

  const doSell = async (p: DPosition, percent: number) => {
    if (!p.is_dry_run && !confirm(`${p.symbol ?? p.mint.slice(0, 6)} pozisyonunun %${percent}'i GERÇEK olarak satılacak. Devam?`)) return
    setBusy(`${p.id}:${percent}`)
    setMsg(null)
    const err = await sell(p as unknown as PositionRow, percent)
    setBusy(null)
    setMsg(err ? { kind: 'error', text: `Satış yapılamadı: ${err}` } : { kind: 'ok', text: `%${percent} satış ${p.is_dry_run ? '(deneme) tamamlandı' : 'emri gönderildi'}.` })
  }

  if (!list.length) return <Empty>Açık pozisyon yok.</Empty>
  return (
    <div className="plist">
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {list.map((p) => {
        const pnl = positionPnl(p)
        const cost = Number(p.cost_sol ?? 0)
        const ratio = pnl !== null && cost > 0 ? pnl / cost : null
        const held = heldValueSol(p)
        return (
          <div key={p.id} className="prow">
            <div className="prow-main">
              <b className="ellipsis">{p.symbol ?? `${p.mint.slice(0, 4)}…`}</b>
              {p.is_dry_run && <span className="badge">Deneme</span>}
              <span className="faint mono" style={{ fontSize: 11 }}>
                {sol(cost)}
              </span>
            </div>
            <div className="prow-pnl">
              <b className={`mono ${tone(pnl) ?? ''}`}>{pnl === null ? '…' : sol(pnl, true)}</b>
              <span className={`faint mono ${tone(ratio) ?? ''}`} style={{ fontSize: 11 }}>
                {ratio === null ? '' : pct(ratio, true)}
                {!compact && held !== undefined ? ` · değer ${sol(held)}` : ''}
              </span>
            </div>
            {trader && (
              <div className="prow-btns">
                {presets.map((n) => (
                  <button key={n} className={`btn btn-xs ${n >= 100 ? 'btn-danger' : ''}`} disabled={busy !== null} onClick={() => doSell(p, n)} title={`%${n} sat`}>
                    {busy === `${p.id}:${n}` ? '…' : `%${n}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {positions.filter((p) => p.status === 'open').length > list.length && (
        <button className="link faint" style={{ fontSize: 11.5, textDecoration: 'none' }} onClick={() => go('positions')}>
          Tümünü gör <ArrowRight size={10} style={{ verticalAlign: -1 }} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- onay bekleyenler
export function PendingList({ pending, now }: { pending: PendingCandidate[]; now: number }) {
  const { go } = useNav()
  const live = pending.filter((c) => new Date(c.expires_at).getTime() > now)
  if (!live.length) return <Empty>Onay bekleyen token yok.</Empty>
  return (
    <div className="plist">
      {live.map((c) => {
        const left = Math.max(0, Math.floor((new Date(c.expires_at).getTime() - now) / 1000))
        return (
          <button key={c.id} className="prow clickable" onClick={() => go('approvals')} title="Onay Bekleyenler'de aç">
            <div className="prow-main">
              <b className="ellipsis">{c.summary?.symbol ?? `${c.mint.slice(0, 4)}…`}</b>
              <StatusPill tone={c.verdict === 'pass' ? 'on' : 'wait'}>{c.verdict === 'pass' ? 'Geçti' : 'Uyarı'}</StatusPill>
            </div>
            <div className="prow-pnl">
              <span className="faint mono" style={{ fontSize: 11 }}>
                {c.summary?.mcapUsd !== undefined ? `MC ${usd(c.summary.mcapUsd)}` : ''}
              </span>
              <span className="mono" style={{ fontSize: 11 }}>
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- son sinyaller
export function RecentSignals({ rows, sources, now }: { rows: { id: string; mint: string; received_at: string; source_id: string | null }[]; sources: DSource[]; now: number }) {
  const title = new Map(sources.map((s) => [s.id, s.title]))
  if (!rows.length) return <Empty>Henüz sinyal yok.</Empty>
  return (
    <div className="plist">
      {rows.map((r) => (
        <div key={r.id} className="prow">
          <div className="prow-main">
            <span className="mono" title={r.mint}>
              {r.mint.slice(0, 4)}…{r.mint.slice(-4)}
            </span>
            <span className="faint ellipsis" style={{ fontSize: 11 }}>
              {r.source_id ? (title.get(r.source_id) ?? '') : 'Elle'}
            </span>
          </div>
          <div className="prow-pnl">
            <span className="faint" style={{ fontSize: 11 }}>
              {ago(r.received_at, now)}
            </span>
          </div>
          <div className="prow-btns">
            <a className="icon-btn sm" href={`https://gmgn.ai/sol/token/${r.mint}`} target="_blank" rel="noreferrer" title="GMGN'de aç">
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- GMGN: trend token'lar
export function TrendingList({ items, compact, onCheck }: { items: DashTrend[]; compact?: boolean; onCheck?: (mint: string) => void }) {
  if (!items.length) return <Empty>Trend verisi henüz gelmedi.</Empty>
  return (
    <div className="plist">
      {items.slice(0, compact ? 6 : 15).map((t) => (
        <div key={t.address} className="prow">
          <div className="prow-main">
            {t.logo ? <img className="avatar sm" src={t.logo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar sm avatar-text">{t.symbol.slice(0, 1)}</span>}
            <b className="ellipsis">{t.symbol}</b>
            {!compact && t.launchpad && <span className="faint" style={{ fontSize: 11 }}>{t.launchpad}</span>}
          </div>
          <div className="prow-pnl">
            <span className="mono" style={{ fontSize: 11.5 }}>
              {t.marketCap !== undefined ? `MC ${usd(t.marketCap)}` : '—'}
            </span>
            <span className={`mono ${tone(t.change) ?? ''}`} style={{ fontSize: 11 }}>
              {t.change === undefined ? '' : `${t.change > 0 ? '+' : ''}${t.change.toFixed(1)}%`}
              {!compact && t.volume !== undefined ? ` · hacim ${usd(t.volume)}` : ''}
            </span>
          </div>
          <div className="prow-btns">
            {onCheck && (
              <button className="btn btn-xs" onClick={() => onCheck(t.address)} title="Token kontrol">
                Kontrol
              </button>
            )}
            <a className="icon-btn sm" href={`https://gmgn.ai/sol/token/${t.address}`} target="_blank" rel="noreferrer" title="GMGN'de aç">
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- GMGN: cüzdan istatistikleri
export function WalletStatsCards({ dash }: { dash: DashGmgn | null }) {
  const stat = (p: '7d' | '30d', s?: DashWalletStats) =>
    s ? (
      <div key={p} className="wstat">
        <div className="wstat-head">
          <b>{p === '7d' ? 'Son 7 gün' : 'Son 30 gün'}</b>
          <span className="faint" style={{ fontSize: 11 }}>
            {s.buyCount} alım · {s.sellCount} satım
          </span>
        </div>
        <div className="wstat-grid">
          <Kpi label="Gerçekleşen" value={usd(s.realizedProfit, true)} tone={tone(s.realizedProfit)} />
          <Kpi label="Gerçekleşmemiş" value={usd(s.unrealizedProfit, true)} tone={tone(s.unrealizedProfit)} />
          <Kpi label="Kazanma oranı" value={pct(s.winrate, false, 0)} />
          <Kpi label="Getiri" value={pct(s.pnl, true)} tone={tone(s.pnl)} hint="Gerçekleşen kâr / toplam maliyet" />
        </div>
      </div>
    ) : null
  const one = dash?.profits?.['1d']
  const all = dash?.profits?.all
  const any = dash?.stats?.['7d'] || dash?.stats?.['30d'] || one || all
  if (!any) return <Empty>{dash?.error ?? 'Cüzdan istatistikleri henüz gelmedi (ilk tazeleme ~1 dk sürer).'}</Empty>
  return (
    <div className="plist" style={{ gap: 10 }}>
      {stat('7d', dash?.stats?.['7d'])}
      {stat('30d', dash?.stats?.['30d'])}
      <div className="wstat">
        <div className="wstat-head">
          <b>Cüzdan toplam kâr (GMGN)</b>
          <span className="faint" style={{ fontSize: 11 }}>USD</span>
        </div>
        <div className="wstat-grid">
          <Kpi label="Bugün" value={usd(one?.totalProfit, true)} tone={tone(one?.totalProfit)} />
          <Kpi label="Tüm zamanlar" value={usd(all?.totalProfit, true)} tone={tone(all?.totalProfit)} />
          <Kpi label="Gerçekleşen (tümü)" value={usd(all?.realizedProfit, true)} tone={tone(all?.realizedProfit)} />
          <Kpi label="Maliyet (tümü)" value={usd(all?.totalCost)} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- kaynak performansı
export function SourceTable({ rows, limit }: { rows: SourceRow[]; limit?: number }) {
  const list = rows.slice(0, limit ?? 50)
  if (!list.length) return <Empty>Bu dönemde kaynak verisi yok.</Empty>
  return (
    <div className="stable-wrap">
      <table className="stable">
        <thead>
          <tr>
            <th>Kaynak</th>
            <th className="r">Sinyal</th>
            <th className="r">İşlem</th>
            <th className="r">Kazanma</th>
            <th className="r">Kâr/zarar</th>
            <th className="r">Getiri</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.sourceId ?? 'manual'}>
              <td>
                <b>{r.title}</b> <span className="faint" style={{ fontSize: 11 }}>{r.type === 'x' ? 'X' : r.type === 'telegram' ? 'Telegram' : ''}</span>
              </td>
              <td className="r mono">{r.signals}</td>
              <td className="r mono">{r.trades}</td>
              <td className="r mono">{r.closed ? pct(r.winrate, false, 0) : '—'}</td>
              <td className={`r mono ${tone(r.pnl) ?? ''}`}>{r.trades ? sol(r.pnl, true) : '—'}</td>
              <td className={`r mono ${tone(r.roi) ?? ''}`}>{r.roi === null ? '—' : pct(r.roi, true, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const TrendIcon = ({ v }: { v: number | null | undefined }) => (v == null || v === 0 ? null : v > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />)
