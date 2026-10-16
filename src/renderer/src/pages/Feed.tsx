import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { useEngine } from '../lib/engine'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
import { useKillSwitch } from '../lib/killswitch'
import { FeedCard, type CardActions } from '../components/FeedCard'
import { SignalsPanel } from './Signals'
import { useSources } from './Sources'
import type { FeedItem, KeywordRule } from '../../../shared/feed'
import type { TelegramStatus } from '../../../shared/types'

// Canlı akış: izlenen hesap ve kanalların gönderileri kart kart; altta eşleşen token önerileri.

const PAGE = 60

export function FeedPage({
  onCheck,
  onDeploy,
  keywords = []
}: {
  onCheck: (mint: string) => void
  onDeploy?: (item: FeedItem) => void
  keywords?: (KeywordRule & { color?: string | null })[]
}) {
  const [tab, setTab] = useState<'feed' | 'signals'>('feed')
  return (
    <div className="stack">
      <div className="tabs">
        <button className="tab" aria-selected={tab === 'feed'} onClick={() => setTab('feed')}>
          Akış
        </button>
        <button className="tab" aria-selected={tab === 'signals'} onClick={() => setTab('signals')}>
          Sinyaller
        </button>
      </div>
      {tab === 'feed' ? <FeedList onCheck={onCheck} onDeploy={onDeploy} keywords={keywords} /> : <SignalsPanel onCheck={onCheck} />}
    </div>
  )
}

function SourceChips() {
  const { me } = useEngine()
  const tg = (me?.telegram && 'state' in me.telegram ? me.telegram : { state: 'needs_setup' }) as TelegramStatus
  const x = me?.x ?? {}
  const { sources } = useSources('telegram')
  const { sources: xs } = useSources('x')
  const tgCount = sources.filter((s) => s.is_active).length
  const xCount = xs.filter((s) => s.is_active).length
  return (
    <span className="row muted" style={{ gap: 14 }}>
      <span className="row" style={{ gap: 6 }}>
        <span className={`dot ${tg.state === 'connected' ? 'on' : 'off'}`} />
        {tg.state === 'connected' ? `Telegram · ${tgCount} kanal` : 'Telegram bağlı değil'}
      </span>
      <span className="row" style={{ gap: 6 }}>
        <span className={`dot ${x.state === 'polling' && xCount > 0 ? 'on' : 'off'}`} />
        {!x.configured ? 'X bağlı değil' : x.state === 'error' ? `X hatası: ${x.error ?? ''}` : `X · ${xCount} hesap`}
      </span>
    </span>
  )
}

function FeedList({
  onCheck,
  onDeploy,
  keywords
}: {
  onCheck: (mint: string) => void
  onDeploy?: (item: FeedItem) => void
  keywords: (KeywordRule & { color?: string | null })[]
}) {
  const { profile } = useAuth()
  const { rule } = usePipeline()
  const { buy } = useOrders()
  const { online } = useEngine()
  const killSwitch = useKillSwitch()
  const [items, setItems] = useState<FeedItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<'all' | 'x' | 'telegram'>('all')
  const [withMint, setWithMint] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    let q = supabase.from('feed_items').select('*').eq('user_id', profile.id).order('received_at', { ascending: false }).limit(limit)
    if (!showHidden) q = q.eq('hidden', false)
    const { data } = await q
    setItems((data as FeedItem[]) ?? [])
    setLoaded(true)
  }, [profile?.id, limit, showHidden])

  useEffect(() => {
    if (!profile) return
    load()
    // Yeni kart en üste eklenir; öneri/görsel güncellemesi yerinde
    const ch = supabase
      .channel('feed-items')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feed_items', filter: `user_id=eq.${profile.id}` }, (p) =>
        setItems((cur) => [p.new as FeedItem, ...cur.filter((x) => x.id !== (p.new as FeedItem).id)])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'feed_items', filter: `user_id=eq.${profile.id}` }, (p) =>
        setItems((cur) => cur.map((x) => (x.id === (p.new as FeedItem).id ? (p.new as FeedItem) : x)))
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'feed_items' }, (p) =>
        setItems((cur) => cur.filter((x) => x.id !== (p.old as { id: string }).id))
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id, load])

  const amount = rule.limits.buyPresetsSol[0] ?? 0.1
  const live = rule.limits.liveTrading
  const actions = useMemo<CardActions>(
    () => ({
      buyLabel: `${live ? 'Al' : 'Dene'} · ${amount}`,
      canBuy: canTrade(profile?.role) && !killSwitch && online,
      onCheck,
      onDeploy,
      quickBuy: async (mint, symbol) => {
        if (live && !confirm(`${symbol ?? mint.slice(0, 6)} için ${amount} SOL GERÇEK alım yapılacak. Devam?`)) return 'İptal edildi'
        return buy({ mint, amountSol: amount, symbol })
      }
    }),
    [live, amount, profile?.role, killSwitch, online, onCheck, onDeploy, buy]
  )

  const visible = useMemo(() => {
    const ql = query.trim().toLocaleLowerCase('tr')
    const list = items.filter(
      (i) =>
        (showHidden || !i.hidden) &&
        (platform === 'all' || i.platform === platform) &&
        (!withMint || i.mints.length > 0) &&
        (!ql ||
          i.text.toLocaleLowerCase('tr').includes(ql) ||
          (i.author.handle ?? '').toLocaleLowerCase('tr').includes(ql) ||
          (i.author.name ?? '').toLocaleLowerCase('tr').includes(ql))
    )
    // Sabitlenenler en üstte
    return [...list.filter((i) => i.pinned), ...list.filter((i) => !i.pinned)]
  }, [items, query, platform, withMint, showHidden])

  return (
    <div className="feed">
      <div className="feed-toolbar">
        <SourceChips />
        <div className="row" style={{ gap: 6 }}>
          <input className="input-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Akışta ara" style={{ width: 180 }} />
          <select className="input-sm" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            <option value="all">Tümü</option>
            <option value="x">X</option>
            <option value="telegram">Telegram</option>
          </select>
          <label className="row check">
            <input type="checkbox" checked={withMint} onChange={(e) => setWithMint(e.target.checked)} />
            Sadece adresliler
          </label>
          <label className="row check">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Gizlenenler
          </label>
        </div>
      </div>

      {loaded && visible.length === 0 ? (
        <div className="empty">
          {items.length ? 'Filtreye uyan gönderi yok.' : 'Henüz gönderi yok.'}
          <div className="faint" style={{ marginTop: 6 }}>
            Kaynaklar ekranından Telegram kanalı ya da X hesabı izlemeye başlayınca gönderiler burada kart kart akar.
          </div>
        </div>
      ) : (
        visible.map((item) => <FeedCard key={item.id} item={item} now={now} keywords={keywords} actions={actions} />)
      )}

      {items.length >= limit && (
        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
            Daha fazla
          </button>
        </div>
      )}
    </div>
  )
}
