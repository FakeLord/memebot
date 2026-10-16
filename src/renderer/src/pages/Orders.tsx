import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

interface Order {
  id: string
  side: 'buy' | 'sell'
  mint: string
  symbol: string | null
  amount_in: string
  sell_percent: number | null
  status: string
  is_dry_run: boolean
  tx_hash: string | null
  error_code: string | null
  created_at: string
}

// Gönderim (submitted) ile zincirde kesinleşme (confirmed) ayrı gösterilir.
const STATUS: Record<string, { label: string; cls: string }> = {
  created: { label: 'Hazırlanıyor', cls: '' },
  submitted: { label: 'Gönderildi', cls: 'warn' },
  pending: { label: 'Bekliyor', cls: 'warn' },
  processed: { label: 'İşlendi', cls: 'warn' },
  confirmed: { label: 'Kesinleşti', cls: 'pass' },
  failed: { label: 'Başarısız', cls: 'fail' },
  expired: { label: 'Süresi doldu', cls: 'fail' }
}

export function OrdersPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Order[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!profile) return
    const load = () =>
      supabase
        .from('orders')
        .select('id, side, mint, symbol, amount_in, sell_percent, status, is_dry_run, tx_hash, error_code, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(200)
        .then(({ data }) => {
          setRows((data as Order[]) ?? [])
          setLoaded(true)
        })
    load()
    const ch = supabase
      .channel('orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  if (loaded && rows.length === 0) return <div className="empty">Henüz emir yok.</div>

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Zaman</th>
            <th>İşlem</th>
            <th>Token</th>
            <th>Miktar</th>
            <th>Durum</th>
            <th>İşlem kaydı</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const st = STATUS[o.status] ?? { label: o.status, cls: '' }
            return (
              <tr key={o.id}>
                <td className="muted mono">{new Date(o.created_at).toLocaleString('tr-TR')}</td>
                <td>
                  {o.side === 'buy' ? 'Alım' : 'Satış'} {o.is_dry_run && <span className="badge">Deneme</span>}
                </td>
                <td>
                  {o.symbol ?? '—'}{' '}
                  <span className="mono faint">
                    {o.mint.slice(0, 4)}…{o.mint.slice(-4)}
                  </span>
                </td>
                <td className="mono">{o.side === 'buy' ? `${(Number(o.amount_in) / 1e9).toFixed(4)} SOL` : `%${o.sell_percent ?? '—'}`}</td>
                <td>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                  {o.error_code && (
                    <div className="faint" style={{ fontSize: 12 }} title={o.error_code}>
                      {o.error_code.length > 60 ? o.error_code.slice(0, 60) + '…' : o.error_code}
                    </div>
                  )}
                </td>
                <td>
                  {o.tx_hash ? (
                    <a className="mono" href={`https://solscan.io/tx/${o.tx_hash}`} target="_blank" rel="noreferrer">
                      {o.tx_hash.slice(0, 8)}…
                    </a>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
