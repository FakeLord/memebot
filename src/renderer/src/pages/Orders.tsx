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

  return (
    <div className="stack">
      {loaded && rows.length === 0 ? <div className="empty">Henüz emir yok.</div> : <OrdersTable rows={rows} />}
      <DeploysTable />
    </div>
  )
}

function OrdersTable({ rows }: { rows: Order[] }) {
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

interface Deploy {
  id: string
  platform: string
  name: string
  symbol: string
  is_dry_run: boolean
  status: string
  mint: string | null
  error: string | null
  created_at: string
}

const DEPLOY_STATUS: Record<string, { label: string; cls: string }> = {
  simulated: { label: 'Deneme (gönderilmedi)', cls: '' },
  sending: { label: 'Gönderiliyor', cls: 'warn' },
  submitted: { label: 'Bekliyor', cls: 'warn' },
  confirmed: { label: 'Çıktı', cls: 'pass' },
  failed: { label: 'Başarısız', cls: 'fail' }
}

function DeploysTable() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Deploy[]>([])

  useEffect(() => {
    if (!profile) return
    const load = () =>
      supabase
        .from('deploys')
        .select('id, platform, name, symbol, is_dry_run, status, mint, error, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data }) => setRows((data as Deploy[]) ?? []))
    load()
    const ch = supabase
      .channel('deploys')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deploys', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  if (!rows.length) return null
  return (
    <div className="card" style={{ padding: 0 }}>
      <h2 style={{ padding: '14px 16px 0' }}>Deploy'lar</h2>
      <table>
        <tbody>
          {rows.map((d) => {
            const st = DEPLOY_STATUS[d.status] ?? { label: d.status, cls: '' }
            return (
              <tr key={d.id}>
                <td className="muted mono">{new Date(d.created_at).toLocaleString('tr-TR')}</td>
                <td>
                  <b>${d.symbol}</b> <span className="muted">{d.name}</span>
                </td>
                <td className="muted">{d.platform}</td>
                <td>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                  {d.error && (
                    <div className="faint" style={{ fontSize: 12 }} title={d.error}>
                      {d.error.slice(0, 60)}
                    </div>
                  )}
                </td>
                <td>
                  {d.mint ? (
                    <a className="mono" href={`https://gmgn.ai/sol/token/${d.mint}`} target="_blank" rel="noreferrer">
                      {d.mint.slice(0, 6)}…
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
