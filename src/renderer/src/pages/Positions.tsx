import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { useOrders, type PositionRow } from '../lib/orders'
import { useTracker } from '../lib/tracker'

interface Position extends PositionRow {
  entry_price: number | null
  entry_mcap: number | null
  amount_initial_raw: string | null
  proceeds_estimated: boolean
  close_reason: string | null
  opened_at: string
  closed_at: string | null
}

const COLS =
  'id, mint, symbol, amount_raw, amount_initial_raw, cost_sol, proceeds_sol, proceeds_estimated, close_reason, is_dry_run, status, entry_price, entry_mcap, opened_at, closed_at'

const CLOSE_REASON: Record<string, string> = { manual: 'Elle', gmgn_tpsl: 'GMGN TP/SL', panic: 'Tümünü sat' }

// Elde kalan oran × fiyat değişimi × maliyet = elde kalanın tahmini SOL değeri
function heldValueSol(p: Position, priceUsd: number | undefined): number | undefined {
  if (priceUsd === undefined || !p.entry_price || !p.cost_sol) return undefined
  const cur = p.amount_raw && /^\d+$/.test(p.amount_raw) ? Number(p.amount_raw) : undefined
  const init = p.amount_initial_raw && /^\d+$/.test(p.amount_initial_raw) ? Number(p.amount_initial_raw) : cur
  const frac = cur !== undefined && init ? cur / init : 1
  return Number(p.cost_sol) * frac * (priceUsd / Number(p.entry_price))
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`
}

function sol(n: number | null | undefined, sign = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${sign && n > 0 ? '+' : ''}${n.toFixed(4)} SOL`
}

export function PositionsPage() {
  const { profile } = useAuth()
  const { sell, sellAll } = useOrders()
  const { prices, lastError } = useTracker()
  const [open, setOpen] = useState<Position[]>([])
  const [closed, setClosed] = useState<Position[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const trader = canTrade(profile?.role)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      const [{ data: o }, { data: c }] = await Promise.all([
        supabase.from('positions').select(COLS).eq('user_id', profile.id).eq('status', 'open').order('opened_at', { ascending: false }),
        supabase
          .from('positions')
          .select(COLS)
          .eq('user_id', profile.id)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false })
          .limit(50)
      ])
      setOpen((o as Position[]) ?? [])
      setClosed((c as Position[]) ?? [])
      setLoaded(true)
    }
    load()
    const ch = supabase
      .channel('positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  const doSell = async (p: Position, pct: number) => {
    if (!p.is_dry_run && !confirm(`${p.symbol ?? p.mint.slice(0, 6)} pozisyonunun %${pct}'i GERÇEK olarak satılacak. Devam?`)) return
    setBusy(p.id)
    setMsg(null)
    const err = await sell(p, pct)
    setBusy(null)
    setMsg(err ? { kind: 'error', text: `Satış yapılamadı: ${err}` } : { kind: 'ok', text: `%${pct} satış ${p.is_dry_run ? '(deneme) tamamlandı' : 'emri gönderildi'}.` })
  }

  const panic = async () => {
    const liveCount = open.filter((p) => !p.is_dry_run).length
    if (
      !confirm(
        `Açık ${open.length} pozisyonun tamamı satılacak${liveCount ? ` (${liveCount} tanesi GERÇEK)` : ''}. Devam?`
      )
    )
      return
    setBusy('all')
    const errors = await sellAll()
    setBusy(null)
    setMsg(errors.length ? { kind: 'error', text: `Bazı satışlar yapılamadı: ${errors.join(' · ')}` } : { kind: 'ok', text: 'Tüm pozisyonlar için satış gönderildi.' })
  }

  // Özet (açık pozisyonlar, aynı modlar birlikte)
  const totals = open.reduce(
    (a, p) => {
      const v = heldValueSol(p, prices[p.mint]?.priceUsd)
      if (v === undefined) return a
      return { cost: a.cost + Number(p.cost_sol), now: a.now + v + Number(p.proceeds_sol || 0) }
    },
    { cost: 0, now: 0 }
  )

  if (loaded && open.length === 0 && closed.length === 0) {
    return <div className="empty">Henüz pozisyon yok. Onay Bekleyenler ekranından alım yapıldığında burada görünür.</div>
  }

  return (
    <div className="stack">
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {lastError && <div className="notice error">{lastError}</div>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          Fiyatlar 15 sn'de bir güncellenir. GMGN'de TP/SL tetiklenirse miktar cüzdandan eşitlenir; gelen SOL o anki fiyattan tahmin edilir (*).
        </span>
        {open.length > 0 && totals.cost > 0 && (
          <span className={`mono ${totals.now >= totals.cost ? 'pos' : 'neg'}`}>
            Açık toplam {sol(totals.now - totals.cost, true)} ({pct(totals.now / totals.cost - 1)})
          </span>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: '14px 16px 0' }}>
          <h2 style={{ margin: 0 }}>Açık ({open.length})</h2>
          {trader && open.length > 0 && (
            <button className="btn btn-sm btn-danger" disabled={busy !== null} onClick={panic}>
              {busy === 'all' ? 'Satılıyor…' : 'Tümünü sat'}
            </button>
          )}
        </div>
        {open.length === 0 ? (
          <p className="muted" style={{ padding: '0 16px 16px' }}>
            Açık pozisyon yok.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Giriş</th>
                <th>Şimdi</th>
                <th>Maliyet</th>
                <th>Kâr / zarar</th>
                <th>Açılış</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div>
                      {p.symbol ?? '—'} {p.is_dry_run && <span className="badge">Deneme</span>}
                    </div>
                    <div className="mono faint">
                      {p.mint.slice(0, 6)}…{p.mint.slice(-6)}
                    </div>
                  </td>
                  <td className="mono">{p.entry_price ? `$${Number(p.entry_price).toPrecision(4)}` : '—'}</td>
                  <td className="mono">
                    {(() => {
                      const pr = prices[p.mint]?.priceUsd
                      if (pr === undefined) return <span className="faint">…</span>
                      const ch = p.entry_price ? pr / Number(p.entry_price) - 1 : undefined
                      return (
                        <>
                          ${pr.toPrecision(4)} {ch !== undefined && <span className={ch >= 0 ? 'pos' : 'neg'}>{pct(ch)}</span>}
                        </>
                      )
                    })()}
                  </td>
                  <td className="mono">{sol(p.cost_sol)}</td>
                  <td className="mono">
                    {(() => {
                      const v = heldValueSol(p, prices[p.mint]?.priceUsd)
                      if (v === undefined || !p.cost_sol) return <span className="faint">—</span>
                      const pnl = v + Number(p.proceeds_sol || 0) - Number(p.cost_sol)
                      return (
                        <span className={pnl >= 0 ? 'pos' : 'neg'}>
                          {sol(pnl, true)}
                          {p.proceeds_estimated ? '*' : ''}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="muted">{new Date(p.opened_at).toLocaleString('tr-TR')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {[25, 50, 100].map((pct) => (
                      <button
                        key={pct}
                        className={`btn btn-sm ${pct === 100 ? 'btn-danger' : ''}`}
                        disabled={!trader || busy === p.id}
                        onClick={() => doSell(p, pct)}
                        style={{ marginLeft: 4 }}
                      >
                        %{pct} sat
                      </button>
                    ))}
                    <a className="btn btn-sm" style={{ marginLeft: 4 }} href={`https://gmgn.ai/sol/token/${p.mint}`} target="_blank" rel="noreferrer">
                      GMGN
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {closed.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <h2 style={{ padding: '14px 16px 0' }}>Kapanan</h2>
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Maliyet</th>
                <th>Gelen</th>
                <th>Sonuç</th>
                <th>Neden</th>
                <th>Kapanış</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((p) => {
                const pnl = p.cost_sol != null ? Number(p.proceeds_sol) - Number(p.cost_sol) : null
                return (
                  <tr key={p.id}>
                    <td>
                      {p.symbol ?? p.mint.slice(0, 6)} {p.is_dry_run && <span className="badge">Deneme</span>}
                    </td>
                    <td className="mono">{sol(p.cost_sol)}</td>
                    <td className="mono">{sol(p.proceeds_sol)}</td>
                    <td className={`mono ${pnl == null ? '' : pnl >= 0 ? 'pos' : 'neg'}`}>
                      {sol(pnl, true)}
                      {p.proceeds_estimated ? '*' : ''}
                    </td>
                    <td className="muted">{p.close_reason ? (CLOSE_REASON[p.close_reason] ?? p.close_reason) : '—'}</td>
                    <td className="muted">{p.closed_at ? new Date(p.closed_at).toLocaleString('tr-TR') : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
