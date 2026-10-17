import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Filter, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { useEngine } from '../lib/engine'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
import { useKillSwitch } from '../lib/killswitch'
import { usePrefs } from '../lib/prefs'
import { useDeploy } from '../components/DeployPanel'
import { FeedCard, type CardActions } from '../components/FeedCard'
import { SignalsPanel } from './Signals'
import { LeftRail, RightRail, useRailData } from '../components/DashRails'
import { useSources } from './Sources'
import type { FeedItem, KeywordRule } from '../../../shared/feed'
import type { TelegramStatus } from '../../../shared/types'

// Canlı akış: izlenen hesap ve kanalların gönderileri kart kart; altta eşleşen token önerileri.

const PAGE = 60

export function FeedPage({ onCheck }: { onCheck: (mint: string) => void }) {
  const [tab, setTab] = useState<'feed' | 'signals'>('feed')
  const { keywords } = usePrefs()
  const { open } = useDeploy()
  const { profile } = useAuth()
  const onDeploy = canTrade(profile?.role) ? open : undefined
  const rail = useRailData()
  const tabs = (
    <div className="pills">
      <button className="pill" aria-selected={tab === 'feed'} onClick={() => setTab('feed')}>
        Akış
      </button>
      <button className="pill" aria-selected={tab === 'signals'} onClick={() => setTab('signals')}>
        Sinyaller
      </button>
    </div>
  )
  return tab === 'feed' ? (
    <div className="feed-layout">
      <LeftRail r={rail} />
      <FeedList onCheck={onCheck} onDeploy={onDeploy} keywords={keywords} tabs={tabs} />
      <RightRail r={rail} onCheck={onCheck} />
    </div>
  ) : (
    <div className="page stack">
      {tabs}
      <SignalsPanel onCheck={onCheck} />
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
    <div className="feed-status">
      <span>
        <span className={`dot ${tg.state === 'connected' ? 'on' : 'off'}`} />
        {tg.state === 'connected' ? `Telegram · ${tgCount} kanal` : 'Telegram bağlı değil'}
      </span>
      <span>
        <span className={`dot ${(x.ts?.state === 'live' || x.state === 'polling') && xCount > 0 ? 'on' : x.ts?.state === 'reconnecting' ? 'wait' : 'off'}`} />
        {x.ts?.state === 'live'
          ? `X · ${xCount} hesap · canlı`
          : x.ts?.configured
            ? `X · TweetStream ${x.ts.state === 'error' ? `hatası: ${x.ts.error ?? ''}` : 'bağlanıyor'}`
            : !x.configured
              ? 'X bağlı değil'
              : x.state === 'error'
                ? `X hatası: ${x.error ?? ''}`
                : `X · ${xCount} hesap`}
      </span>
    </div>
  )
}

function FeedList({
  onCheck,
  onDeploy,
  keywords,
  tabs
}: {
  onCheck: (mint: string) => void
  onDeploy?: CardActions['onDeploy']
  keywords: (KeywordRule & { color?: string | null })[]
  tabs: ReactNode
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
  const { sources: tgSources } = useSources('telegram')
  const { sources: xSources } = useSources('x')
  // Sessize alınan kaynakların kartları gösterilmez (sinyalleri yine işlenir)
  const muted = useMemo(() => new Set([...tgSources, ...xSources].filter((s) => s.muted).map((s) => s.id)), [tgSources, xSources])

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
        (showHidden || !i.source_id || !muted.has(i.source_id)) &&
        (platform === 'all' || i.platform === platform) &&
        (!withMint || i.mints.length > 0) &&
        (!ql ||
          i.text.toLocaleLowerCase('tr').includes(ql) ||
          (i.author.handle ?? '').toLocaleLowerCase('tr').includes(ql) ||
          (i.author.name ?? '').toLocaleLowerCase('tr').includes(ql))
    )
    // Sabitlenenler en üstte
    return [...list.filter((i) => i.pinned), ...list.filter((i) => !i.pinned)]
  }, [items, query, platform, withMint, showHidden, muted])

  return (
    <div className="feed">
      <div className="feed-toolbar">
        {tabs}
        <label className="search sm">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Akışta ara" />
        </label>
        <div className="pills">
          {(['all', 'x', 'telegram'] as const).map((p) => (
            <button key={p} className="pill" aria-selected={platform === p} onClick={() => setPlatform(p)}>
              {p === 'all' ? 'Tümü' : p === 'x' ? 'X' : 'Telegram'}
            </button>
          ))}
        </div>
        <button className={`icon-btn ${withMint ? 'on' : ''}`} title="Sadece adresliler" aria-pressed={withMint} onClick={() => setWithMint((v) => !v)} style={withMint ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}>
          <Filter size={14} />
        </button>
        <button className={`icon-btn ${showHidden ? 'on' : ''}`} title="Gizlenenleri göster" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)} style={showHidden ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}>
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
      <SourceChips />

      {loaded && visible.length === 0 ? (
        <div className="empty">
          {items.length ? 'Filtreye uyan gönderi yok.' : 'Henüz gönderi yok.'}
          <div className="faint" style={{ marginTop: 6 }}>
            Ayarlar → Kaynaklar'dan Telegram kanalı ya da X hesabı izlemeye başlayınca gönderiler burada kart kart akar.
          </div>
        </div>
      ) : (
        visible.map((item) => <FeedCard key={item.id} item={item} now={now} keywords={keywords} actions={actions} />)
      )}

      {items.length >= limit && (
        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Daha fazla
          </button>
        </div>
      )}
    </div>
  )
}
