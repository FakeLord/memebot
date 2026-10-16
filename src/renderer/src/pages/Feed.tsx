import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Hit {
  mint: string
  hit_count: number
  first_seen_at: string
  last_seen_at: string
}

// Telegram dinleyicisi (Faz 2) signal_hits tablosunu doldurur; bu ekran canlı olarak gösterir.
export function FeedPage() {
  const [hits, setHits] = useState<Hit[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = () =>
      supabase
        .from('signal_hits')
        .select('mint, hit_count, first_seen_at, last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(100)
        .then(({ data }) => {
          setHits((data as Hit[]) ?? [])
          setLoaded(true)
        })
    load()
    const ch = supabase
      .channel('feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signal_hits' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  if (loaded && hits.length === 0) {
    return (
      <div className="empty">
        Henüz sinyal yok.
        <div className="faint" style={{ marginTop: 6 }}>
          Telegram kaynak bağlantısı bir sonraki aşamada geliyor. Şimdilik Token Kontrol ekranından adres kontrol edebilirsiniz.
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Çağrı</th>
            <th>İlk görülme</th>
            <th>Son görülme</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h) => (
            <tr key={h.mint}>
              <td className="mono">{h.mint}</td>
              <td>{h.hit_count}</td>
              <td className="muted">{new Date(h.first_seen_at).toLocaleTimeString('tr-TR')}</td>
              <td className="muted">{new Date(h.last_seen_at).toLocaleTimeString('tr-TR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
