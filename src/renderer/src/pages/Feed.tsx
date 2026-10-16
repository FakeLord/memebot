import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useTelegram } from '../lib/telegram'

interface SignalRow {
  id: string
  mint: string
  raw_text: string | null
  msg_ts: string | null
  received_at: string
  sources: { title: string } | null
}

interface Hits {
  [mint: string]: number
}

function latency(msgTs: string | null, receivedAt: string): string {
  if (!msgTs) return '—'
  const ms = new Date(receivedAt).getTime() - new Date(msgTs).getTime()
  // Telegram saniye hassasiyetinde zaman verir; 1 sn altı "<1 sn" görünür
  return ms < 1000 ? '<1 sn' : `${(ms / 1000).toFixed(0)} sn`
}

function excerpt(text: string | null, mint: string): string {
  if (!text) return ''
  const firstLine = text.split('\n').find((l) => l.trim() && !l.includes(mint)) ?? ''
  return firstLine.length > 90 ? firstLine.slice(0, 90) + '…' : firstLine
}

export function FeedPage({ onCheck }: { onCheck: (mint: string) => void }) {
  const { profile } = useAuth()
  const { status, sources } = useTelegram()
  const [rows, setRows] = useState<SignalRow[]>([])
  const [hits, setHits] = useState<Hits>({})
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      const { data } = await supabase
        .from('signals')
        .select('id, mint, raw_text, msg_ts, received_at, sources(title)')
        .eq('user_id', profile.id)
        .order('received_at', { ascending: false })
        .limit(150)
      const list = (data as unknown as SignalRow[]) ?? []
      setRows(list)
      const mints = [...new Set(list.map((r) => r.mint))]
      if (mints.length) {
        const { data: h } = await supabase.from('signal_hits').select('mint, hit_count').eq('user_id', profile.id).in('mint', mints)
        setHits(Object.fromEntries(((h as { mint: string; hit_count: number }[]) ?? []).map((x) => [x.mint, x.hit_count])))
      }
      setLoaded(true)
    }
    load()
    const ch = supabase
      .channel('feed-signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  const copy = async (mint: string) => {
    await navigator.clipboard.writeText(mint)
    setCopied(mint)
    setTimeout(() => setCopied((c) => (c === mint ? null : c)), 1200)
  }

  const watching = sources.filter((s) => s.is_active).length

  return (
    <div className="stack">
      <div className="row muted">
        <span className={`dot ${status.state === 'connected' ? 'on' : 'off'}`} />
        {status.state === 'connected' ? `Telegram bağlı · ${watching} kanal izleniyor` : 'Telegram bağlı değil — Kaynaklar ekranından bağlanın'}
      </div>

      {loaded && rows.length === 0 ? (
        <div className="empty">
          Henüz sinyal yok.
          <div className="faint" style={{ marginTop: 6 }}>
            İzlenen kanallarda bir token adresi paylaşıldığında burada görünecek.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Kaynak</th>
                <th>Token</th>
                <th>Çağrı</th>
                <th>Gecikme</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted mono">{new Date(r.received_at).toLocaleTimeString('tr-TR')}</td>
                  <td>
                    <div>{r.sources?.title ?? '—'}</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {excerpt(r.raw_text, r.mint)}
                    </div>
                  </td>
                  <td className="mono" title={r.mint}>
                    {r.mint.slice(0, 6)}…{r.mint.slice(-6)}
                  </td>
                  <td>{hits[r.mint] && hits[r.mint] > 1 ? <span className="badge warn">{hits[r.mint]}×</span> : <span className="faint">1</span>}</td>
                  <td className="muted mono">{latency(r.msg_ts, r.received_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => copy(r.mint)}>
                      {copied === r.mint ? 'Kopyalandı' : 'Kopyala'}
                    </button>{' '}
                    <button className="btn btn-sm" onClick={() => onCheck(r.mint)}>
                      Kontrol
                    </button>{' '}
                    <a className="btn btn-sm" href={`https://gmgn.ai/sol/token/${r.mint}`} target="_blank" rel="noreferrer">
                      GMGN
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
