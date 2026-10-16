import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { usePipeline } from '../lib/pipeline'
import { useEngine } from '../lib/engine'
import { useSources } from './Sources'
import type { TelegramStatus } from '../../../shared/types'
import { extractMints } from '../../../shared/extract'
import { evaluateSafety, VERDICT_LABEL, type Verdict } from '../../../shared/safety'

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

type Raw = { info: unknown; security: unknown }

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
  const { me } = useEngine()
  const status = (me?.telegram && 'state' in me.telegram ? me.telegram : { state: 'needs_setup' }) as TelegramStatus
  const x = me?.x ?? {}
  const { sources } = useSources('telegram')
  const { sources: xSources } = useSources('x')
  const xWatching = xSources.filter((s) => s.is_active).length
  const [rows, setRows] = useState<SignalRow[]>([])
  const [hits, setHits] = useState<Hits>({})
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const { rule } = usePipeline()
  const [raws, setRaws] = useState<Record<string, Raw>>({})
  const [manual, setManual] = useState('')
  const [manualMsg, setManualMsg] = useState<string | null>(null)

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
        // Her mint için en son güvenlik kontrolü (karar kullanıcının kendi eşikleriyle hesaplanır)
        const { data: checks } = await supabase
          .from('safety_checks')
          .select('mint, raw, checked_at')
          .in('mint', mints)
          .order('checked_at', { ascending: false })
          .limit(300)
        const latest: Record<string, Raw> = {}
        for (const c of (checks as { mint: string; raw: Raw }[]) ?? []) if (!latest[c.mint] && c.raw) latest[c.mint] = c.raw
        setRaws(latest)
      }
      setLoaded(true)
    }
    load()
    const ch = supabase
      .channel('feed-signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `user_id=eq.${profile.id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'safety_checks' }, load)
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

  // Telegram olmadan test: adresi/mesajı elle akışa ekler (kaynak: "Manuel")
  const addManual = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile) return
    const mints = extractMints(manual)
    if (!mints.length) return setManualMsg('Geçerli bir token adresi bulunamadı.')
    const { data: src, error: srcErr } = await supabase
      .from('sources')
      .upsert({ user_id: profile.id, type: 'manual', chat_id: 'manual', title: 'Manuel', is_active: true }, { onConflict: 'user_id,type,chat_id' })
      .select('id')
      .single()
    if (srcErr || !src) return setManualMsg(srcErr?.message ?? 'Kaynak oluşturulamadı')
    for (const mint of mints.slice(0, 5)) {
      const { error } = await supabase.rpc('record_signal', {
        p_source_id: src.id,
        p_msg_id: Date.now(),
        p_mint: mint,
        p_raw_text: manual,
        p_msg_ts: new Date().toISOString()
      })
      if (error) return setManualMsg(error.message)
    }
    setManual('')
    setManualMsg(null)
  }

  const verdictOf = (mint: string): Verdict | undefined =>
    raws[mint] ? evaluateSafety(raws[mint].security, raws[mint].info, rule.thresholds).result : undefined

  return (
    <div className="stack">
      <div className="row muted" style={{ gap: 18 }}>
        <span className="row">
          <span className={`dot ${status.state === 'connected' ? 'on' : 'off'}`} />
          {status.state === 'connected' ? `Telegram · ${watching} kanal` : 'Telegram bağlı değil'}
        </span>
        <span className="row">
          <span className={`dot ${x.state === 'polling' && xWatching > 0 ? 'on' : 'off'}`} />
          {!x.configured ? 'X bağlı değil' : x.state === 'error' ? `X hatası: ${x.error ?? ''}` : `X · ${xWatching} hesap`}
        </span>
        {(status.state !== 'connected' || !x.configured) && <span className="faint">Kaynaklar ekranından bağlanın</span>}
      </div>

      <form className="row" onSubmit={addManual}>
        <input
          style={{ flex: 1 }}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Elle sinyal ekle: token adresi ya da mesaj yapıştırın"
        />
        <button className="btn" disabled={!manual.trim()}>
          Akışa ekle
        </button>
      </form>
      {manualMsg && <div className="notice error">{manualMsg}</div>}

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
                <th>Güvenlik</th>
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
                  <td>
                    {(() => {
                      const v = verdictOf(r.mint)
                      return v ? <span className={`badge ${v}`}>{VERDICT_LABEL[v]}</span> : <span className="faint">—</span>
                    })()}
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
