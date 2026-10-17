import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react'
import { dayKey, inMode, positionPnl, type DPosition, type Mode } from '../../../shared/dashboard'
import type { DashGmgn } from '../../../shared/engine'
import { usePrices } from '../lib/prices'
import { Empty, Kpi, ago, pct, sol, tone, usd } from './DashWidgets'

// PnL takvimi (günlük kâr/zarar ısı haritası) ve cüzdan özeti.

const WEEK = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

const short = (v: number) => {
  const a = Math.abs(v)
  const t = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${t}`
}

export function PnlCalendar({ positions, mode, onShare }: { positions: DPosition[]; mode: Mode; onShare?: (p: DPosition) => void }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [picked, setPicked] = useState<string | null>(null)

  // gün → { pnl, trades[] } (yalnızca kapanan pozisyonlar, seçili mod)
  const days = useMemo(() => {
    const m = new Map<string, { pnl: number; trades: DPosition[] }>()
    for (const p of positions) {
      if (p.status !== 'closed' || !p.closed_at || !inMode(mode, p.is_dry_run)) continue
      const k = dayKey(p.closed_at)
      const d = m.get(k) ?? { pnl: 0, trades: [] }
      d.pnl += positionPnl(p) ?? 0
      d.trades.push(p)
      m.set(k, d)
    }
    return m
  }, [positions, mode])

  const y = cursor.getFullYear()
  const mo = cursor.getMonth()
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7 // Pazartesi başlangıçlı
  const count = new Date(y, mo + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  const keyOf = (d: number) => dayKey(new Date(y, mo, d))

  let monthPnl = 0
  let monthTrades = 0
  let max = 0
  for (let d = 1; d <= count; d++) {
    const x = days.get(keyOf(d))
    if (!x) continue
    monthPnl += x.pnl
    monthTrades += x.trades.length
    max = Math.max(max, Math.abs(x.pnl))
  }
  const todayKey = dayKey(new Date())
  const sel = picked ? days.get(picked) : undefined

  return (
    <div className="pcal">
      <div className="pcal-head">
        <button className="icon-btn sm" title="Önceki ay" onClick={() => setCursor(new Date(y, mo - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <b>
          {MONTHS[mo]} {y}
        </b>
        <button className="icon-btn sm" title="Sonraki ay" onClick={() => setCursor(new Date(y, mo + 1, 1))}>
          <ChevronRight size={14} />
        </button>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 11 }}>
          {monthTrades} işlem
        </span>
        <b className={`mono ${tone(monthPnl) ?? ''}`}>{sol(monthPnl, true)}</b>
      </div>
      <div className="pcal-grid">
        {WEEK.map((w) => (
          <span key={w} className="pcal-dow">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />
          const k = keyOf(d)
          const x = days.get(k)
          const a = x && max ? Math.min(1, Math.abs(x.pnl) / max) : 0
          const bg = x ? `color-mix(in srgb, ${x.pnl >= 0 ? 'var(--pos)' : 'var(--neg)'} ${Math.round(14 + a * 46)}%, var(--bg))` : undefined
          return (
            <button
              key={k}
              className={`pcal-day${k === todayKey ? ' today' : ''}${picked === k ? ' sel' : ''}`}
              style={{ background: bg }}
              disabled={!x}
              onClick={() => setPicked(picked === k ? null : k)}
              title={x ? `${x.trades.length} işlem · ${sol(x.pnl, true)}` : undefined}
            >
              <span className="pcal-n">{d}</span>
              {x && <span className="pcal-v">{short(x.pnl)}</span>}
            </button>
          )
        })}
      </div>
      {picked && sel && (
        <div className="pcal-list">
          <div className="faint" style={{ fontSize: 11 }}>
            {picked.split('-').reverse().join('.')} · {sel.trades.length} işlem
          </div>
          {sel.trades.map((p) => {
            const pnl = positionPnl(p) ?? 0
            return (
              <div key={p.id} className="pcal-trade">
                <b>{p.symbol ?? `${p.mint.slice(0, 4)}…`}</b>
                {p.is_dry_run && <span className="badge">Deneme</span>}
                <span className="spacer" />
                <span className={`mono ${tone(pnl) ?? ''}`}>{sol(pnl, true)}</span>
                {onShare && (
                  <button className="icon-btn sm" title="Paylaşım kartı" onClick={() => onShare(p)}>
                    <Share2 size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!days.size && <Empty>Henüz kapanan işlem yok.</Empty>}
    </div>
  )
}

/** Cüzdan özeti: varsayılan cüzdanın SOL bakiyesi (≈ USD) ve GMGN'den gelen 7 gün istatistikleri. */
export function WalletSummary({ dash }: { dash: DashGmgn | null }) {
  const q = usePrices()
  const s = dash?.stats?.['7d']
  const solUsd = q.SOL?.price
  if (!dash || (dash.balance === undefined && !s)) return <Empty>Cüzdan özeti, motor GMGN'den ilk veriyi alınca görünür (yaklaşık 1 dk).</Empty>
  return (
    <div className="kpi-grid">
      <Kpi label="Bakiye" value={dash.balance !== undefined ? sol(dash.balance) : '—'} sub={dash.balance !== undefined && solUsd ? `≈ ${usd(dash.balance * solUsd)}` : undefined} hint="Varsayılan GMGN cüzdanı" />
      <Kpi label="7G gerçekleşen" value={usd(s?.realizedProfit, true)} tone={tone(s?.realizedProfit)} sub={s ? `${s.buyCount} alım · ${s.sellCount} satım` : undefined} />
      <Kpi label="7G gerçekleşmemiş" value={usd(s?.unrealizedProfit, true)} tone={tone(s?.unrealizedProfit)} />
      <Kpi label="7G getiri" value={pct(s?.pnl, true)} tone={tone(s?.pnl)} sub={s ? `kazanma ${pct(s.winrate, false, 0)}` : undefined} hint="Gerçekleşen kâr / toplam maliyet" />
      <Kpi label="7G maliyet" value={usd(s?.totalCost)} sub={dash.at ? `${ago(dash.at)} önce` : undefined} />
    </div>
  )
}
