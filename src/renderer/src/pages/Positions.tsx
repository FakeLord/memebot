import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { useOrders, type PositionRow } from '../lib/orders'

interface Position extends PositionRow {
  entry_price: number | null
  entry_mcap: number | null
  opened_at: string
  closed_at: string | null
}

const COLS = 'id, mint, symbol, amount_raw, cost_sol, proceeds_sol, is_dry_run, status, entry_price, entry_mcap, opened_at, closed_at'

function sol(n: number | null | undefined, sign = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${sign && n > 0 ? '+' : ''}${n.toFixed(4)} SOL`
}

export function PositionsPage() {
  const { profile } = useAuth()
  const { sell } = useOrders()
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

  if (loaded && open.length === 0 && closed.length === 0) {
    return <div className="empty">Henüz pozisyon yok. Onay Bekleyenler ekranından alım yapıldığında burada görünür.</div>
  }

  return (
    <div className="stack">
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      <p className="faint">
        Anlık fiyat ve kâr/zarar takibi bir sonraki sürümde. GMGN'de kurulan TP/SL tetiklenirse elde kalan miktar burada henüz güncellenmez.
      </p>

      <div className="card" style={{ padding: 0 }}>
        <h2 style={{ padding: '14px 16px 0' }}>Açık ({open.length})</h2>
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
                <th>Maliyet</th>
                <th>Satıştan gelen</th>
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
                  <td className="mono">{sol(p.cost_sol)}</td>
                  <td className="mono">{p.proceeds_sol ? sol(p.proceeds_sol) : '—'}</td>
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
                    <td className={`mono ${pnl == null ? '' : pnl >= 0 ? 'pos' : 'neg'}`}>{sol(pnl, true)}</td>
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
