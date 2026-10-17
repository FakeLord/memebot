import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Filter, Pin, Search, Star, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { useEngine } from '../lib/engine'
import { usePipeline } from '../lib/pipeline'
import { useOrders } from '../lib/orders'
import { useKillSwitch } from '../lib/killswitch'
import { usePrefs } from '../lib/prefs'
import { useDeploy } from '../components/DeployPanel'
import { FeedCard, type CardActions } from '../components/FeedCard'
import { SignalLine, SignalsPanel, signalMatches, useSignalData } from './Signals'
import { LeftRail, RightRail, useRailData, useRails } from '../components/DashRails'
import { activeFilterCount, useFeedFilters } from '../lib/feedFilters'
import { useSources } from './Sources'
import { keywordRegex, type FeedItem, type KeywordRule } from '../../../shared/feed'
import type { TelegramStatus } from '../../../shared/types'

// Canlı akış: izlenen hesap ve kanalların gönderileri kart kart; altta eşleşen token önerileri.

const PAGE = 60

export function FeedPage({ onCheck }: { onCheck: (mint: string) => void }) {
  const { keywords } = usePrefs()
  const { open } = useDeploy()
  const { profile } = useAuth()
  const onDeploy = canTrade(profile?.role) ? open : undefined
  const rail = useRailData()
  const { rails, move } = useRails()
  const [f] = useFeedFilters()
  // Sadece sinyal tablosu geniş alan ister; gönderi kartları (tek ya da birleşik) dar sütunda kalır
  const wide = f.showSignals && !f.showFeed
  return (
    <div className={`feed-layout${wide ? ' wide-center' : ''}`}>
      <LeftRail r={rail} onCheck={onCheck} rails={rails} move={move} />
      <FeedList onCheck={onCheck} onDeploy={onDeploy} keywords={keywords} />
      <RightRail r={rail} onCheck={onCheck} rails={rails} move={move} />
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
  keywords
}: {
  onCheck: (mint: string) => void
  onDeploy?: CardActions['onDeploy']
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
  // Filtreler sayfalar arasında korunur (lib/feedFilters)
  const [f, setF, resetF] = useFeedFilters()
  const { query, platform, withMint, showHidden, keywordOnly, pinnedOnly, source } = f
  const signalData = useSignalData(f.showSignals)
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

  // Anahtar kelime filtresi: sessize alınmamış kelimelerden biri metinde geçiyor mu (String.search, 'g' bayrağından etkilenmez)
  const kwRes = useMemo(() => keywords.filter((k) => !(k as { muted?: boolean }).muted).map((k) => keywordRegex(k)).filter((x): x is RegExp => !!x), [keywords])

  const base = useMemo(() => {
    const ql = query.trim().toLocaleLowerCase('tr')
    return items.filter(
      (i) =>
        (showHidden || !i.hidden) &&
        (showHidden || !i.source_id || !muted.has(i.source_id)) &&
        (source === 'all' || i.source_id === source) &&
        (!withMint || i.mints.length > 0) &&
        (!pinnedOnly || i.pinned) &&
        (!keywordOnly || kwRes.some((re) => i.text.search(re) !== -1)) &&
        (!ql ||
          i.text.toLocaleLowerCase('tr').includes(ql) ||
          (i.author.handle ?? '').toLocaleLowerCase('tr').includes(ql) ||
          (i.author.name ?? '').toLocaleLowerCase('tr').includes(ql))
    )
  }, [items, query, withMint, showHidden, muted, source, pinnedOnly, keywordOnly, kwRes])

  // Platform sayıları (diğer filtreler uygulanmış halde): düğmenin yanında görünür
  const counts = useMemo(() => ({ all: base.length, x: base.filter((i) => i.platform === 'x').length, telegram: base.filter((i) => i.platform === 'telegram').length }), [base])

  const cards = useMemo(() => {
    const list = base.filter((i) => platform === 'all' || i.platform === platform)
    // Sabitlenenler en üstte
    return [...list.filter((i) => i.pinned), ...list.filter((i) => !i.pinned)]
  }, [base, platform])

  const signals = useMemo(
    () => signalData.rows.filter((r) => signalMatches(r, { platform, source, query }) && !pinnedOnly && (!keywordOnly || (r.raw_text !== null && kwRes.some((re) => r.raw_text!.search(re) !== -1)))),
    [signalData.rows, platform, source, query, pinnedOnly, keywordOnly, kwRes]
  )

  // Birleşik görünüm: sabitlenmiş kartlar üstte, kalanı zamana göre (kart ve sinyal karışık)
  type Entry = { kind: 'card'; item: FeedItem; t: number } | { kind: 'signal'; row: (typeof signals)[number]; t: number }
  const timeline = useMemo<Entry[]>(() => {
    const e: Entry[] = [
      ...cards.map((item): Entry => ({ kind: 'card', item, t: new Date(item.received_at).getTime() })),
      ...(f.showSignals ? signals.map((row): Entry => ({ kind: 'signal', row, t: new Date(row.received_at).getTime() })) : [])
    ]
    const pinned = e.filter((x) => x.kind === 'card' && x.item.pinned)
    const rest = e.filter((x) => !(x.kind === 'card' && x.item.pinned)).sort((a, b) => b.t - a.t)
    return [...pinned, ...rest]
  }, [cards, signals, f.showSignals])

  const sourceOptions = useMemo(
    () =>
      [...xSources, ...tgSources]
        .filter((s) => platform === 'all' || s.type === platform)
        .map((s) => ({ id: s.id, label: `${s.type === 'x' ? 'X' : 'TG'} · ${s.title ?? s.chat_id}` })),
    [xSources, tgSources, platform]
  )
  const nActive = activeFilterCount(f)
  const on = (v: boolean) => (v ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined)
  const showCards = f.showFeed
  const empty = timeline.length === 0

  return (
    <div className={`feed${f.showSignals && !f.showFeed ? ' wide' : ''}`}>
      <div className="feed-toolbar">
        <div className="pills" title="İkisi de açıkken gönderiler ve sinyaller aynı akışta karışık gelir">
          <button className="pill" aria-selected={f.showFeed} onClick={() => setF({ showFeed: !f.showFeed })}>
            Akış
          </button>
          <button className="pill" aria-selected={f.showSignals} onClick={() => setF({ showSignals: !f.showSignals })}>
            Sinyaller
          </button>
        </div>
        <label className="search sm">
          <Search size={13} />
          <input value={query} onChange={(e) => setF({ query: e.target.value })} placeholder="Akışta ara" />
        </label>
        <div className="pills">
          {(['all', 'x', 'telegram'] as const).map((p) => (
            <button key={p} className="pill" aria-selected={platform === p} onClick={() => setF({ platform: p })}>
              {p === 'all' ? 'Tümü' : p === 'x' ? 'X' : 'Telegram'}
              {f.showFeed && <span className="pill-n">{counts[p]}</span>}
            </button>
          ))}
        </div>
        <button className="icon-btn" title="Sadece adresliler" aria-pressed={withMint} onClick={() => setF({ withMint: !withMint })} style={on(withMint)}>
          <Filter size={14} />
        </button>
        <button className="icon-btn" title="Sadece anahtar kelime eşleşenler" aria-pressed={keywordOnly} onClick={() => setF({ keywordOnly: !keywordOnly })} style={on(keywordOnly)}>
          <Star size={14} />
        </button>
        <button className="icon-btn" title="Sadece sabitlenenler" aria-pressed={pinnedOnly} onClick={() => setF({ pinnedOnly: !pinnedOnly })} style={on(pinnedOnly)}>
          <Pin size={14} />
        </button>
        <button className="icon-btn" title={showHidden ? 'Gizlenenler gösteriliyor' : 'Gizlenenleri göster'} aria-pressed={showHidden} onClick={() => setF({ showHidden: !showHidden })} style={on(showHidden)}>
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        {sourceOptions.length > 0 && (
          <select className="input-sm feed-source" value={source} onChange={(e) => setF({ source: e.target.value })} title="Tek bir hesap ya da kanal">
            <option value="all">Tüm kaynaklar</option>
            {sourceOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {nActive > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={resetF} title="Filtreleri temizle">
            <X size={12} /> Temizle ({nActive})
          </button>
        )}
      </div>
      <SourceChips />

      {!showCards ? (
        <SignalsPanel onCheck={onCheck} filter={{ platform, source, query }} />
      ) : (
        <>
          {loaded && empty ? (
            <div className="empty">
              {platform !== 'all' && counts[platform] === 0
                ? `Henüz ${platform === 'x' ? 'X' : 'Telegram'} gönderisi yok.`
                : nActive > 0 && items.length
                  ? 'Filtreye uyan kayıt yok.'
                  : 'Henüz gönderi yok.'}
              <div className="faint" style={{ marginTop: 6 }}>
                {nActive > 0 ? (
                  <button className="link" onClick={resetF}>
                    Filtreleri temizle
                  </button>
                ) : (
                  "Ayarlar → Kaynaklar'dan Telegram kanalı ya da X hesabı izlemeye başlayınca gönderiler burada kart kart akar."
                )}
              </div>
            </div>
          ) : (
            timeline.map((e) =>
              e.kind === 'card' ? (
                <FeedCard key={e.item.id} item={e.item} now={now} keywords={keywords} actions={actions} />
              ) : (
                <SignalLine key={`s-${e.row.id}`} row={e.row} hits={signalData.hits[e.row.mint]} verdict={signalData.verdictOf(e.row.mint)} onCheck={onCheck} />
              )
            )
          )}

          {items.length >= limit && (
            <div style={{ textAlign: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Daha fazla
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
