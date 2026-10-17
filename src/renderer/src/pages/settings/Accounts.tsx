import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Bell, BellOff, Check, Download, ExternalLink, Layers, Plus, Search, Send, Trash2, Upload, VolumeX } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useNav } from '../../lib/nav'
import { XLogo } from '../../components/FeedCard'
import { errText, useEngine } from '../../lib/engine'
import { splitHandles } from '../TweetStreamSection'
import { parseCsv, toCsv } from '../../../../shared/settings'

// Hesaplar: (1) Benim hesaplarım — izlediğim Telegram kanalları ve X hesapları (izle, sessize al, bildirim)
// (2) Ortak havuz — founder'ın herkesle paylaştığı önerilen hesap listesi (CSV içe/dışa aktarma).

interface MySource {
  id: string
  type: 'telegram' | 'x' | 'manual'
  chat_id: string
  title: string
  is_active: boolean
  muted: boolean
  notify: boolean
}

interface Shared {
  id: string
  platform: 'x' | 'telegram'
  handle: string
  title: string | null
  note: string | null
}

type Platform = 'all' | 'x' | 'telegram'

const PAGE = 20

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Pager({ page, total, setPage, size = PAGE }: { page: number; total: number; setPage: (p: number) => void; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total ? page * size + 1 : 0
  const to = Math.min(total, (page + 1) * size)
  // 1 2 … son: ilk, son ve etkin sayfanın komşuları
  const nums = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b)
  return (
    <div className="list-foot">
      <span>
        {from}–{to} / {total}
      </span>
      {pages > 1 && (
        <div className="pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          {nums.map((n, i) => (
            <span key={n} style={{ display: 'contents' }}>
              {i > 0 && n - nums[i - 1] > 1 && <span className="faint">…</span>}
              <button aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)}>
                {n + 1}
              </button>
            </span>
          ))}
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  )
}

function PlatformIcon({ p }: { p: string }) {
  return p === 'x' ? <XLogo size={12} /> : <Send size={12} />
}

export function AccountsSection() {
  const [tab, setTab] = useState<'mine' | 'pool'>('mine')
  const [platform, setPlatform] = useState<Platform>('all')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState({ mine: 0, pool: 0 })
  const setCount = useCallback((k: 'mine' | 'pool', n: number) => setCounts((c) => (c[k] === n ? c : { ...c, [k]: n })), [])

  // Sekme açılmadan da havuz sayısı görünsün
  useEffect(() => {
    supabase
      .from('shared_accounts')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => count != null && setCount('pool', count))
  }, [setCount])

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className="search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'mine' ? 'Hesaplarımda ara' : 'Ortak havuzda ara'} />
      </label>
      <div className="row" style={{ gap: 2 }}>
        {(['all', 'x', 'telegram'] as Platform[]).map((p) => (
          <button
            key={p}
            className={`icon-btn ${platform === p ? 'on' : ''}`}
            style={platform === p ? { background: 'var(--soft-2)' } : undefined}
            title={p === 'all' ? 'Tümü' : p === 'x' ? 'X' : 'Telegram'}
            onClick={() => setPlatform(p)}
          >
            {p === 'all' ? <Layers size={13} /> : <PlatformIcon p={p} />}
          </button>
        ))}
      </div>
      <div className="seg">
        <button className={`seg-btn ${tab === 'mine' ? 'on' : ''}`} onClick={() => setTab('mine')}>
          Benim hesaplarım <span className="faint">{counts.mine}</span>
        </button>
        <button className={`seg-btn ${tab === 'pool' ? 'on' : ''}`} onClick={() => setTab('pool')}>
          Ortak havuz <span className="faint">{counts.pool}</span>
        </button>
      </div>
      {tab === 'mine' ? (
        <MyAccounts q={q} platform={platform} setCount={(n) => setCount('mine', n)} />
      ) : (
        <SharedPool q={q} platform={platform} setCount={(n) => setCount('pool', n)} />
      )}
    </div>
  )
}

function MyAccounts({ q, platform, setCount }: { q: string; platform: Platform; setCount: (n: number) => void }) {
  const { profile } = useAuth()
  const { go } = useNav()
  const { me, online, run } = useEngine()
  const [rows, setRows] = useState<MySource[]>([])
  const [page, setPage] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const [addMsg, setAddMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const tsReady = me?.x?.ts?.configured === true

  // TweetStream bağlıysa X hesabı doğrudan @kullanıcı adıyla eklenir; değilse Kaynaklar'a yönlendirilir
  const addX = async (e: FormEvent) => {
    e.preventDefault()
    const list = splitHandles(adding ?? '')
    if (!list.length) return
    try {
      const r = await run('tweetstream.add', { handles: list })
      const ok = r.results.filter((x) => x.state === 'added' || x.state === 'already_following').length
      setAddMsg({ kind: ok ? 'ok' : 'error', text: r.results.map((x) => `${x.input}: ${x.state === 'added' ? 'eklendi' : x.state === 'already_following' ? 'zaten izleniyor' : x.state === 'not_found' ? "X'te bulunamadı" : x.message ?? 'eklenemedi'}`).join(' · ') })
      if (ok) setAdding(null)
      load()
    } catch (err) {
      setAddMsg({ kind: 'error', text: errText(err) })
    }
  }

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sources')
      .select('id, type, chat_id, title, is_active, muted, notify')
      .eq('user_id', profile!.id)
      .neq('type', 'manual')
      .order('title')
    setRows((data as MySource[]) ?? [])
  }, [profile?.id])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => setCount(rows.length), [rows.length, setCount])
  useEffect(() => setPage(0), [q, platform])

  const update = async (s: MySource, patch: Partial<MySource>) => {
    setRows((cur) => cur.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))
    await supabase.from('sources').update(patch).eq('id', s.id)
    if (patch.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }

  const filtered = useMemo(
    () => rows.filter((r) => (platform === 'all' || r.type === platform) && r.title.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))),
    [rows, q, platform]
  )

  return (
    <>
      {filtered.length === 0 ? (
        <div className="empty">{rows.length ? 'Aramaya uyan hesap yok.' : 'Henüz izlenen hesap yok.'}</div>
      ) : (
        <div className="list">
          {filtered.slice(page * PAGE, (page + 1) * PAGE).map((s) => (
            <div key={s.id} className={`list-row ${s.is_active ? '' : 'dim'}`}>
              <button
                className="circle"
                role="checkbox"
                aria-checked={s.is_active}
                title={s.is_active ? 'İzleniyor — durdurmak için tıklayın' : 'İzlenmiyor — başlatmak için tıklayın'}
                onClick={() => update(s, { is_active: !s.is_active })}
              >
                {s.is_active && <Check size={10} strokeWidth={4} />}
              </button>
              <span className="faint">
                <PlatformIcon p={s.type} />
              </span>
              <div className="list-row-main">
                <span className="list-row-title ellipsis">{s.title}</span>
              </div>
              <button
                className={`muted-pill ${s.muted ? 'on' : ''}`}
                title="Sessize alınan hesabın kartları akışta görünmez; adresleri yine sinyal olarak işlenir"
                onClick={() => update(s, { muted: !s.muted })}
              >
                <VolumeX size={11} /> {s.muted ? 'Sessiz' : 'Sesli'}
              </button>
              <div className="list-row-actions">
                <button className={`icon-btn ${s.notify ? 'on' : ''}`} title={s.notify ? 'Bildirim açık' : 'Bildirim kapalı'} onClick={() => update(s, { notify: !s.notify })}>
                  {s.notify ? <Bell size={13} /> : <BellOff size={13} />}
                </button>
                {s.type === 'x' && (
                  <a className="icon-btn" title="X'te aç" href={`https://x.com/${s.title.replace(/^@/, '')}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={filtered.length} setPage={setPage} />
      <div className="row">
        <button
          className="btn btn-sm"
          disabled={!rows.length}
          onClick={() =>
            download(
              'memebot-hesaplarim.csv',
              toCsv(
                rows.map((r) => ({ platform: r.type, handle: r.title.replace(/^@/, ''), id: r.chat_id, izleniyor: r.is_active ? 'evet' : 'hayır' })),
                ['platform', 'handle', 'id', 'izleniyor']
              )
            )
          }
        >
          <Download size={13} /> Dışa aktar
        </button>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => (tsReady ? setAdding(adding === null ? '' : null) : go('settings', 'sources'))} title={tsReady ? 'X hesabı ekle (TweetStream)' : 'Kaynaklar: Telegram ve X bağlantıları'}>
          <Plus size={13} /> Hesap ekle
        </button>
      </div>
      {addMsg && <div className={`notice ${addMsg.kind}`}>{addMsg.text}</div>}
      {adding !== null && (
        <form className="row card" style={{ padding: 10, flexWrap: 'nowrap' }} onSubmit={addX}>
          <XLogo size={12} />
          <input style={{ flex: 1 }} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="@kullanici, @ikinci" autoFocus spellCheck={false} />
          <button className="btn btn-primary" disabled={!online || !splitHandles(adding).length}>
            Ekle
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>
            Kapat
          </button>
        </form>
      )}
    </>
  )
}

function SharedPool({ q, platform, setCount }: { q: string; platform: Platform; setCount: (n: number) => void }) {
  const { profile } = useAuth()
  const founder = profile?.role === 'founder'
  const [rows, setRows] = useState<Shared[]>([])
  const [form, setForm] = useState<{ platform: 'x' | 'telegram'; handle: string; title: string; note: string } | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    const { data } = await supabase.from('shared_accounts').select('id, platform, handle, title, note').order('platform').order('handle')
    setRows((data as Shared[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => setCount(rows.length), [rows.length, setCount])
  useEffect(() => setPage(0), [q, platform])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const handle = form.handle.trim().replace(/^@/, '').replace(/^https?:\/\/(x\.com|twitter\.com|t\.me)\//, '')
    const { error } = await supabase
      .from('shared_accounts')
      .insert({ platform: form.platform, handle, title: form.title.trim() || null, note: form.note.trim() || null })
    if (error) return setMsg({ kind: 'error', text: error.code === '23505' ? 'Bu hesap havuzda zaten var.' : error.message })
    setForm({ ...form, handle: '', title: '', note: '' })
    setMsg(null)
    load()
  }

  const importCsv = async (file: File) => {
    const items = parseCsv(await file.text())
      .map((r) => ({
        platform: (r.platform ?? '').toLowerCase().startsWith('t') ? 'telegram' : 'x',
        handle: (r.handle ?? r.hesap ?? '').replace(/^@/, '').trim(),
        title: (r.title ?? r.ad ?? '') || null,
        note: (r.note ?? r.not ?? '') || null
      }))
      .filter((r) => r.handle)
    if (!items.length) return setMsg({ kind: 'error', text: 'CSV\'de "platform,handle" sütunları bulunamadı.' })
    const { error } = await supabase.from('shared_accounts').upsert(items, { onConflict: 'platform,handle', ignoreDuplicates: true })
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: `${items.length} satır içe aktarıldı (var olanlar atlandı).` })
    load()
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (platform === 'all' || r.platform === platform) && `${r.handle} ${r.title ?? ''} ${r.note ?? ''}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))
      ),
    [rows, q, platform]
  )

  return (
    <>
      <p className="faint" style={{ fontSize: 12 }}>
        Founder'ın ekip için önerdiği hesaplar. X hesabını izlemek için XFlux panelinde izleyici kurun; Telegram kanalı için kanala katılıp Kaynaklar'dan seçin.
      </p>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {founder && form && (
        <form className="row card" style={{ padding: 10 }} onSubmit={add}>
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as 'x' | 'telegram' })}>
            <option value="x">X</option>
            <option value="telegram">Telegram</option>
          </select>
          <input style={{ flex: 1 }} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="@kullanıcı ya da kanal" required autoFocus />
          <input style={{ flex: 1 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ad (isteğe bağlı)" />
          <input style={{ flex: 1 }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Not" />
          <button className="btn btn-primary">Ekle</button>
          <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>
            Kapat
          </button>
        </form>
      )}
      {filtered.length === 0 ? (
        <div className="empty">{rows.length ? 'Aramaya uyan hesap yok.' : 'Havuz boş.'}</div>
      ) : (
        <div className="list">
          {filtered.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
            <div key={r.id} className="list-row">
              <span className="faint">
                <PlatformIcon p={r.platform} />
              </span>
              <div className="list-row-main">
                <span className="list-row-title ellipsis">
                  @{r.handle} {r.title && <span className="muted" style={{ fontWeight: 400 }}>{r.title}</span>}
                </span>
                {r.note && <span className="list-row-sub ellipsis">{r.note}</span>}
              </div>
              <div className="list-row-actions">
                <a
                  className="icon-btn"
                  title="Aç"
                  href={r.platform === 'x' ? `https://x.com/${r.handle}` : `https://t.me/${r.handle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                </a>
                {founder && (
                  <button className="icon-btn danger" title="Havuzdan kaldır" onClick={() => supabase.from('shared_accounts').delete().eq('id', r.id).then(load)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={filtered.length} setPage={setPage} />
      <div className="row">
        {founder && (
          <label className="btn btn-sm" style={{ display: 'inline-flex', flexDirection: 'row', fontSize: 11.5, color: 'var(--text)' }}>
            <Upload size={13} /> İçe aktar
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
        )}
        <button
          className="btn btn-sm"
          disabled={!rows.length}
          onClick={() => download('memebot-ortak-havuz.csv', toCsv(rows as unknown as Record<string, unknown>[], ['platform', 'handle', 'title', 'note']))}
        >
          <Download size={13} /> Dışa aktar
        </button>
        <span className="spacer" />
        {founder && (
          <button className="btn btn-sm btn-primary" onClick={() => setForm({ platform: 'x', handle: '', title: '', note: '' })}>
            <Plus size={13} /> Hesap ekle
          </button>
        )}
      </div>
    </>
  )
}
