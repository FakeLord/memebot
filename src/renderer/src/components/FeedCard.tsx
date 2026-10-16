import { memo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { supabase } from '../lib/supabase'
import { usd } from '../../../shared/safety'
import { highlight, type FeedItem, type FeedSuggestion, type KeywordRule } from '../../../shared/feed'

// Gönderi kartı: başlık → gövde (vurgulu) → yanıt/alıntı → medya → token adresleri → öneri ızgarası → alt aksiyonlar.
// Sade tasarım: renk sadece anlam taşır; vurgular açık gri zemin (kullanıcı kelime rengi seçtiyse o renk).

export interface CardActions {
  quickBuy: (mint: string, symbol?: string) => Promise<string | null>
  buyLabel: string // "Al · 0.1" / "Dene · 0.1"
  canBuy: boolean
  onCheck: (mint: string) => void
  onDeploy?: (item: FeedItem, snapshot: () => Promise<string | null>) => void
}

function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} sn önce`
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`
  return new Date(iso).toLocaleDateString('tr-TR')
}

function latency(item: FeedItem): string | null {
  if (!item.posted_at) return null
  const ms = new Date(item.received_at).getTime() - new Date(item.posted_at).getTime()
  if (ms < 0) return null
  return ms < 1000 ? '<1 sn' : ms < 60_000 ? `${(ms / 1000).toFixed(1)} sn` : `${Math.round(ms / 60_000)} dk`
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

function Avatar({ src, name }: { src?: string; name?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) return <img className="avatar" src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  return <span className="avatar avatar-text">{(name ?? '?').slice(0, 1).toUpperCase()}</span>
}

function Body({ text, keywords, mints }: { text: string; keywords: (KeywordRule & { color?: string | null })[]; mints: string[] }) {
  return (
    <div className="post-body">
      {highlight(text, { keywords, mints }).map((s, i) =>
        !s.mark ? (
          <span key={i}>{s.text}</span>
        ) : s.mark === 'link' ? (
          <a key={i} href={s.text} target="_blank" rel="noreferrer" className="post-link">
            {s.text.replace(/^https?:\/\//, '').slice(0, 48)}
          </a>
        ) : (
          <mark key={i} className={`hl hl-${s.mark}`} style={s.color ? { background: s.color } : undefined}>
            {s.text}
          </mark>
        )
      )}
    </div>
  )
}

function Suggestion({ s, actions, setMsg }: { s: FeedSuggestion; actions: CardActions; setMsg: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="sugg">
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
        {s.logo ? <img className="sugg-logo" src={s.logo} alt="" referrerPolicy="no-referrer" /> : <span className="sugg-logo avatar-text">{(s.symbol ?? '?').slice(0, 1)}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis">
            <b>${s.symbol ?? '?'}</b> <span className="muted">{s.name}</span>
          </div>
          <div className="faint mono">{s.mcapUsd !== undefined ? `MC ${usd(s.mcapUsd)}` : short(s.address)}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button
          className="btn btn-xs btn-primary"
          disabled={!actions.canBuy || busy}
          onClick={async () => {
            setBusy(true)
            const err = await actions.quickBuy(s.address, s.symbol)
            setBusy(false)
            setMsg(err ? `Alım yapılamadı: ${err}` : `${s.symbol ?? 'Token'}: ${actions.buyLabel} tamam — Pozisyonlar`)
          }}
        >
          {busy ? '…' : actions.buyLabel}
        </button>
        <a className="btn btn-xs" href={`https://gmgn.ai/sol/token/${s.address}`} target="_blank" rel="noreferrer">
          GMGN
        </a>
      </div>
    </div>
  )
}

export const FeedCard = memo(function FeedCard({
  item,
  now,
  keywords,
  actions
}: {
  item: FeedItem
  now: number
  keywords: (KeywordRule & { color?: string | null })[]
  actions: CardActions
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showSugg, setShowSugg] = useState(true)
  const [busyMint, setBusyMint] = useState<string | null>(null)
  const a = item.author ?? {}
  const lat = latency(item)

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setMsg(`${label} kopyalandı`)
    setTimeout(() => setMsg((m) => (m?.endsWith('kopyalandı') ? null : m)), 1500)
  }

  // Kartın PNG görüntüsü (deploy görseli ve "görsel olarak kaydet")
  const snapshot = async (): Promise<string | null> => {
    if (!ref.current) return null
    try {
      return await toPng(ref.current, { pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor })
    } catch {
      return null
    }
  }

  const saveImage = async () => {
    if (!ref.current) return
    try {
      const url = await snapshot()
      if (!url) throw new Error()
      const link = document.createElement('a')
      link.download = `gonderi-${item.external_id.replace(/\W/g, '-')}.png`
      link.href = url
      link.click()
    } catch {
      setMsg('Görsel oluşturulamadı (dış görseller engellenmiş olabilir)')
    }
  }

  const setFlag = (patch: { hidden?: boolean; pinned?: boolean }) => supabase.from('feed_items').update(patch).eq('id', item.id)

  return (
    <article className={`post ${item.pinned ? 'post-pinned' : ''}`} ref={ref}>
      <header className="post-head">
        <Avatar src={a.avatar} name={a.name ?? a.handle} />
        <div className="post-who">
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <b className="ellipsis">{a.name ?? a.handle ?? 'Bilinmeyen'}</b>
            {a.verified && <span className="verified" title="Onaylı hesap">✓</span>}
            {a.handle && <span className="muted ellipsis">@{a.handle}</span>}
            {a.followers !== undefined && <span className="faint">· {compact(a.followers)} takipçi</span>}
          </div>
          <div className="faint">
            <span className="platform">{item.platform === 'x' ? 'X' : 'Telegram'}</span> · {ago(item.posted_at ?? item.received_at, now)}
            {lat && <span title="Gönderi zamanı → motorun aldığı an"> · gecikme {lat}</span>}
            {item.pinned && <span> · sabitlendi</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {actions.onDeploy && (
            <button className="btn btn-xs" title="Bu gönderiden token çıkar" onClick={() => actions.onDeploy!(item, snapshot)}>
              ⚡ Deploy
            </button>
          )}
          <button className="btn btn-xs" title="Kartı gizle" onClick={() => setFlag({ hidden: !item.hidden })}>
            {item.hidden ? 'Göster' : 'Gizle'}
          </button>
        </div>
      </header>

      {item.text && <Body text={item.text} keywords={keywords} mints={item.mints} />}

      {item.ref && (item.ref.text || item.ref.author) && (
        <div className={`post-ref post-ref-${item.kind}`}>
          <div className="faint">
            {item.kind === 'reply' ? 'Yanıt' : item.kind === 'repost' ? 'Yeniden paylaşım' : 'Alıntı'}
            {item.ref.author?.handle && ` · @${item.ref.author.handle}`}
          </div>
          {item.ref.text && <div className="post-ref-text">{item.ref.text}</div>}
        </div>
      )}

      {item.media.length > 0 && (
        <div className={`post-media post-media-${Math.min(item.media.length, 4)}`}>
          {item.media.slice(0, 4).map((m) => (
            <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
              <img src={m.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
              {m.type === 'video' && <span className="post-video">▶</span>}
            </a>
          ))}
        </div>
      )}

      {item.mints.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {item.mints.map((mint) => (
            <div key={mint} className="row mint-row">
              <span className="mono" title={mint}>
                CA {short(mint)}
              </span>
              <button
                className="btn btn-xs btn-primary"
                disabled={!actions.canBuy || busyMint === mint}
                onClick={async () => {
                  setBusyMint(mint)
                  const err = await actions.quickBuy(mint)
                  setBusyMint(null)
                  setMsg(err ? `Alım yapılamadı: ${err}` : `${actions.buyLabel} tamam — Pozisyonlar`)
                }}
              >
                {busyMint === mint ? '…' : actions.buyLabel}
              </button>
              <button className="btn btn-xs" onClick={() => actions.onCheck(mint)}>
                Kontrol
              </button>
              <button className="btn btn-xs" onClick={() => copy(mint, 'Adres')}>
                Kopyala
              </button>
              <a className="btn btn-xs" href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noreferrer">
                GMGN
              </a>
            </div>
          ))}
        </div>
      )}

      {item.suggestions && item.suggestions.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <button className="link faint" style={{ fontSize: 12 }} onClick={() => setShowSugg((v) => !v)}>
            {showSugg ? '▾' : '▸'} Eşleşen token'lar ({item.suggestions.length}) · {[...new Set(item.suggestions.map((s) => s.term))].join(', ')}
          </button>
          {showSugg && (
            <div className="sugg-grid">
              {item.suggestions.map((s) => (
                <Suggestion key={s.address} s={s} actions={actions} setMsg={setMsg} />
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <div className={`post-msg ${msg.startsWith('Alım yapılamadı') ? 'neg' : 'muted'}`}>{msg}</div>}

      <footer className="post-foot">
        <button className="link" onClick={() => copy(item.text, 'Metin')}>
          Metni kopyala
        </button>
        <button className="link" onClick={saveImage}>
          Görsel olarak kaydet
        </button>
        <button className="link" onClick={() => setFlag({ pinned: !item.pinned })}>
          {item.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
        </button>
        {item.url && (
          <a className="link" href={item.url} target="_blank" rel="noreferrer">
            {item.platform === 'x' ? "X'te aç ↗" : "Telegram'da aç ↗"}
          </a>
        )}
      </footer>
    </article>
  )
})
