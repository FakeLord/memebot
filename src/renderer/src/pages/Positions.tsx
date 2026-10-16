import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Position {
  id: string
  mint: string
  entry_price: number | null
  status: 'open' | 'closed'
  is_dry_run: boolean
  pnl_usd: number | null
  opened_at: string
}

export function PositionsPage() {
  const [rows, setRows] = useState<Position[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = () =>
      supabase
        .from('positions')
        .select('id, mint, entry_price, status, is_dry_run, pnl_usd, opened_at')
        .order('opened_at', { ascending: false })
        .limit(200)
        .then(({ data }) => {
          setRows((data as Position[]) ?? [])
          setLoaded(true)
        })
    load()
    const ch = supabase
      .channel('positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  if (loaded && rows.length === 0) {
    return <div className="empty">Açık ya da kapanmış pozisyon yok.</div>
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Giriş</th>
            <th>PnL</th>
            <th>Durum</th>
            <th>Açılış</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.mint}</td>
              <td className="mono">{p.entry_price ?? '—'}</td>
              <td className={`mono ${p.pnl_usd == null ? '' : p.pnl_usd >= 0 ? 'pos' : 'neg'}`}>
                {p.pnl_usd == null ? '—' : `${p.pnl_usd >= 0 ? '+' : ''}${p.pnl_usd.toFixed(2)} $`}
              </td>
              <td>
                <span className="badge">{p.status === 'open' ? 'Açık' : 'Kapalı'}</span>{' '}
                {p.is_dry_run && <span className="badge">Deneme</span>}
              </td>
              <td className="muted">{new Date(p.opened_at).toLocaleString('tr-TR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
