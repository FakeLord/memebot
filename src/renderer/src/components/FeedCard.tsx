import { memo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import {
  BadgeCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  ImageDown,
  Pin,
  PinOff,
  Play,
  Quote,
  Repeat2,
  Reply,
  ScanSearch,
  Send,
  Users,
  X as XIcon,
  Zap
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usd } from '../../../shared/safety'
import { highlight, type FeedItem, type FeedSuggestion, type KeywordRule } from '../../../shared/feed'

// Gönderi kartı: başlık (ad, saat, tür) → gövde (vurgulu) → yanıt/alıntı → medya → token adresleri →
// öneri ızgarası → alt ikon satırı. Alıntılar pembe sol çizgiyle ayrılır.

export interface CardActions {
  quickBuy: (mint: string, symbol?: string) => Promise<string | null>
  buyLabel: string // "Al · 0.1" / "Dene · 0.1"
  canBuy: boolean
  onCheck: (mint: string) => void
  onDeploy?: (item: FeedItem, snapshot: () => Promise<string | null>) => void
}

function clock(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll(':', '.')
}

function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} sn`
  if (s < 3600) return `${Math.floor(s / 60)} dk`
  if (s < 86400) return `${Math.floor(s / 3600)} sa`
  return new Date(iso).toLocaleDateString('tr-TR')
}

function latency(item: FeedItem): string | null {
  if (!item.posted_at) return null
  const ms = new Date(item.received_at).getTime() - new Date(item.posted_at).getTime()
  if (ms < 0) return null
  return ms < 1000 ? '<1 sn' : ms < 60_000 ? `${(ms / 1000).toFixed(1)} sn` : `${Math.round(ms / 60_000)} dk`
}

// 1×1 gri PNG: indirilemeyen görsellerin yerine (kart görüntüsü yine de oluşur)
const IMAGE_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOwsnIAAAFmALVpiopUAAAAAElFTkSuQmCC'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

const KIND: Record<FeedItem['kind'], { label: string; icon: typeof Reply } | null> = {
  post: null,
  reply: { label: 'Yanıt', icon: Reply },
  quote: { label: 'Alıntı', icon: Quote },
  repost: { label: 'Yeniden paylaşım', icon: Repeat2 }
}

/** X logosu (lucide'de marka ikonu yok) */
export function XLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z" />
    </svg>
  )
}

function Avatar({ src, name, small }: { src?: string; name?: string; small?: boolean }) {
  const [broken, setBroken] = useState(false)
  const cls = `avatar${small ? ' sm' : ''}`
  if (src && !broken) return <img className={cls} src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  return <span className={`${cls} avatar-text`}>{(name ?? '?').slice(0, 1).toUpperCase()}</span>
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
          <mark key={i} className={`hl hl-${s.mark}`} style={s.color ? { background: s.color, color: '#16130a' } : undefined}>
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
      <div className="sugg-main" title={`${s.name ?? ''} · ${s.address}${s.mcapUsd !== undefined ? ` · MC ${usd(s.mcapUsd)}` : ''}`}>
        {s.logo ? <img className="sugg-logo" src={s.logo} alt="" referrerPolicy="no-referrer" /> : <span className="sugg-logo avatar-text">{(s.symbol ?? '?').slice(0, 1)}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="sugg-name ellipsis">{s.name ?? s.symbol ?? '?'}</div>
          <div className="sugg-sym ellipsis">${s.symbol ?? '?'}{s.mcapUsd !== undefined && <span className="faint"> · {usd(s.mcapUsd)}</span>}</div>
        </div>
      </div>
      <div className="sugg-btns">
        <button
          title={actions.buyLabel}
          disabled={!actions.canBuy || busy}
          onClick={async () => {
            setBusy(true)
            const err = await actions.quickBuy(s.address, s.symbol)
            setBusy(false)
            setMsg(err ? `Alım yapılamadı: ${err}` : `${s.symbol ?? 'Token'}: ${actions.buyLabel} tamam — Pozisyonlar`)
          }}
        >
          {busy ? '…' : 'AL'}
        </button>
        <a href={`https://gmgn.ai/sol/token/${s.address}`} target="_blank" rel="noreferrer" title="GMGN'de aç">
          G
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
  const kind = KIND[item.kind]
  const when = item.posted_at ?? item.received_at

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setMsg(`${label} kopyalandı`)
    setTimeout(() => setMsg((m) => (m?.endsWith('kopyalandı') ? null : m)), 1500)
  }

  // Kartın PNG görüntüsü (deploy görseli ve "görsel olarak kaydet")
  const snapshot = async (): Promise<string | null> => {
    if (!ref.current) return null
    try {
      return await toPng(ref.current, {
        pixelRatio: 2,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        // CSP'nin izin vermediği sunuculardaki görseller (ör. token logoları) gri kutu olarak çizilir
        imagePlaceholder: IMAGE_PLACEHOLDER
      })
    } catch {
      return null
    }
  }

  const saveImage = async () => {
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

  // Sorgu ancak await ile gönderilir; kart güncellemesi gerçek zamanlı UPDATE olayıyla gelir
  const setFlag = async (patch: { hidden?: boolean; pinned?: boolean }) => {
    const { error } = await supabase.from('feed_items').update(patch).eq('id', item.id)
    if (error) setMsg(`Kart güncellenemedi: ${error.message}`)
  }

  return (
    <article className={`post ${item.kind === 'quote' ? 'post-quote' : ''} ${item.pinned ? 'post-pinned' : ''}`} ref={ref}>
      <div className="post-inner">
        <header className="post-head">
          <Avatar src={a.avatar} name={a.name ?? a.handle} />
          <div className="post-who">
            <div className="post-line">
              <span className="post-name ellipsis">{a.name ?? a.handle ?? 'Bilinmeyen'}</span>
              {a.verified && (
                <span className="verified" title="Onaylı hesap">
                  <BadgeCheck size={14} />
                </span>
              )}
              <span className="post-time" title={lat ? `Gönderi → motor: ${lat}` : undefined}>
                {clock(when)}
              </span>
              {kind && (
                <span className={`post-kind ${item.kind}`}>
                  <kind.icon size={12} /> {kind.label}
                </span>
              )}
              {item.pinned && <Pin size={11} className="faint" />}
            </div>
            <div className="post-sub">
              {item.platform === 'x' ? <XLogo size={10} /> : <Send size={10} />}
              {a.handle && <span className="ellipsis">@{a.handle}</span>}
              {a.followers !== undefined && (
                <>
                  <span>•</span>
                  <Users size={10} /> {compact(a.followers)}
                </>
              )}
              {lat && <span className="faint">• {lat}</span>}
            </div>
          </div>
          <div className="post-head-actions">
            <button className="icon-btn" title="Kartı gizle" onClick={() => setFlag({ hidden: !item.hidden })}>
              {item.hidden ? <Eye size={14} /> : <XIcon size={15} />}
            </button>
            {actions.onDeploy && (
              <button className="deploy-btn" title="Bu gönderiden token çıkar" onClick={() => actions.onDeploy!(item, snapshot)}>
                <Zap size={13} /> Deploy
              </button>
            )}
          </div>
        </header>

        {item.text && <Body text={item.text} keywords={keywords} mints={item.mints} />}

        {item.ref && (item.ref.text || item.ref.author) && (
          <div className={`post-ref ${item.kind === 'quote' ? 'quote' : ''}`}>
            <span className="post-ref-label">
              {item.kind === 'reply' ? 'Yanıtlanan' : item.kind === 'repost' ? 'Paylaşılan' : 'Alıntılanan'} <ExternalLink size={10} />
            </span>
            {item.ref.author && (
              <div className="post-ref-author">
                <Avatar small name={item.ref.author.name ?? item.ref.author.handle} />
                {item.ref.author.name && <b>{item.ref.author.name}</b>}
                {item.ref.author.handle && <span className="muted">@{item.ref.author.handle}</span>}
              </div>
            )}
            {item.ref.text && <div className="post-ref-text">{item.ref.text}</div>}
          </div>
        )}

        {item.media.length > 0 && (
          <div className={`post-media post-media-${Math.min(item.media.length, 4)}`}>
            {item.media.slice(0, 4).map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
                <img src={m.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {m.type === 'video' && (
                  <span className="post-video">
                    <Play size={28} fill="currentColor" />
                  </span>
                )}
              </a>
            ))}
          </div>
        )}

        {item.mints.map((mint) => (
          <div key={mint} className="mint-row">
            <span className="mono muted" title={mint}>
              CA {short(mint)}
            </span>
            <span className="spacer" />
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
            <button className="icon-btn sm" title="Adresi kopyala" onClick={() => copy(mint, 'Adres')}>
              <Copy size={12} />
            </button>
            <a className="icon-btn sm" title="GMGN'de aç" href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noreferrer">
              <ExternalLink size={12} />
            </a>
          </div>
        ))}
      </div>

      {item.suggestions && item.suggestions.length > 0 && (
        <>
          <button className="sugg-bar" onClick={() => setShowSugg((v) => !v)}>
            {showSugg ? (
              <>
                <XIcon size={10} strokeWidth={3} /> Önerileri gizle
              </>
            ) : (
              <>Eşleşen token'lar ({item.suggestions.length}) · {[...new Set(item.suggestions.map((s) => s.term))].join(', ')}</>
            )}
          </button>
          {showSugg && (
            <div className="sugg-grid">
              {item.suggestions.map((s) => (
                <Suggestion key={s.address} s={s} actions={actions} setMsg={setMsg} />
              ))}
            </div>
          )}
        </>
      )}

      {msg && <div className={`post-msg ${/yapılamadı|güncellenemedi|oluşturulamadı/.test(msg) ? 'neg' : 'muted'}`} style={{ paddingTop: 8 }}>{msg}</div>}

      <footer className="post-foot">
        <button className="icon-btn" title={item.hidden ? 'Göster' : 'Gizle'} onClick={() => setFlag({ hidden: !item.hidden })}>
          {item.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button className="icon-btn" title="Metni kopyala" onClick={() => copy(item.text, 'Metin')}>
          <Copy size={13} />
        </button>
        <button className="icon-btn" title="Görsel olarak kaydet" onClick={saveImage}>
          <ImageDown size={13} />
        </button>
        {item.mints[0] && (
          <button className="icon-btn" title="Token kontrol" onClick={() => actions.onCheck(item.mints[0])}>
            <ScanSearch size={13} />
          </button>
        )}
        <button className={`icon-btn ${item.pinned ? 'on' : ''}`} title={item.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} onClick={() => setFlag({ pinned: !item.pinned })}>
          {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <div className="post-foot-right">
          <span title={new Date(when).toLocaleString('tr-TR')}>{ago(when, now)} önce</span>
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer">
              Aç <ExternalLink size={11} />
            </a>
          )}
        </div>
      </footer>
    </article>
  )
})
