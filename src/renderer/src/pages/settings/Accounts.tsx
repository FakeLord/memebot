import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { parseCsv, toCsv } from '../../../../shared/settings'

// Hesaplar: (1) Benim hesaplarım — izlediğim Telegram kanalları ve X hesapları (sessize al, bildirim, izle)
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

const PAGE = 20

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE))
  if (total <= PAGE) return null
  return (
    <div className="row faint" style={{ justifyContent: 'flex-end' }}>
      <button className="btn btn-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>
        ‹
      </button>
      {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}
      <button className="btn btn-xs" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
        ›
      </button>
    </div>
  )
}

export function AccountsSection() {
  return (
    <div className="stack">
      <MyAccounts />
      <SharedPool />
    </div>
  )
}

function MyAccounts() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<MySource[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

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

  const update = async (s: MySource, patch: Partial<MySource>) => {
    setRows((cur) => cur.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))
    await supabase.from('sources').update(patch).eq('id', s.id)
    if (patch.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }

  const filtered = useMemo(() => rows.filter((r) => r.title.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))), [rows, q])

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Benim hesaplarım ({rows.filter((r) => r.is_active).length} izleniyor)</h2>
        <button
          className="btn btn-sm"
          disabled={!rows.length}
          onClick={() =>
            download(
              'memebot-hesaplarim.csv',
              toCsv(rows.map((r) => ({ platform: r.type, handle: r.title.replace(/^@/, ''), id: r.chat_id, izleniyor: r.is_active ? 'evet' : 'hayır' })), ['platform', 'handle', 'id', 'izleniyor'])
            )
          }
        >
          CSV indir
        </button>
      </div>
      <p className="muted">
        Telegram kanalları ve X izleyicileri <b>Kaynaklar</b> ekranından eklenir. <b>Sessize al</b>: kartlar akışta görünmez ama içindeki adresler
        yine sinyal olarak işlenir. <b>Bildirim</b>: yeni gönderide masaüstü bildirimi.
      </p>
      <input value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Hesap ara" />
      {filtered.length === 0 ? (
        <p className="faint">Hesap yok.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hesap</th>
              <th>Platform</th>
              <th>İzle</th>
              <th>Sessiz</th>
              <th>Bildirim</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * PAGE, (page + 1) * PAGE).map((s) => (
              <tr key={s.id} style={!s.is_active ? { opacity: 0.55 } : undefined}>
                <td>{s.title}</td>
                <td className="muted">{s.type === 'x' ? 'X' : 'Telegram'}</td>
                <td>
                  <input type="checkbox" checked={s.is_active} onChange={(e) => update(s, { is_active: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" checked={s.muted} onChange={(e) => update(s, { muted: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" checked={s.notify} onChange={(e) => update(s, { notify: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={filtered.length} setPage={setPage} />
    </div>
  )
}

function SharedPool() {
  const { profile } = useAuth()
  const founder = profile?.role === 'founder'
  const [rows, setRows] = useState<Shared[]>([])
  const [form, setForm] = useState({ platform: 'x' as 'x' | 'telegram', handle: '', title: '', note: '' })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    const { data } = await supabase.from('shared_accounts').select('id, platform, handle, title, note').order('platform').order('handle')
    setRows((data as Shared[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async (e: FormEvent) => {
    e.preventDefault()
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
    () => rows.filter((r) => `${r.handle} ${r.title ?? ''} ${r.note ?? ''}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))),
    [rows, q]
  )

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Ortak havuz ({rows.length})</h2>
        <div className="row">
          {founder && (
            <label className="btn btn-sm" style={{ display: 'inline-block' }}>
              CSV içe aktar
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            </label>
          )}
          <button
            className="btn btn-sm"
            disabled={!rows.length}
            onClick={() => download('memebot-ortak-havuz.csv', toCsv(rows as unknown as Record<string, unknown>[], ['platform', 'handle', 'title', 'note']))}
          >
            CSV indir
          </button>
        </div>
      </div>
      <p className="muted">
        Founder'ın ekip için önerdiği hesaplar. Bir X hesabını izlemek için XFlux panelinde izleyici kurun; Telegram kanalı için kanala katılıp
        Kaynaklar'dan seçin.
      </p>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {founder && (
        <form className="row" onSubmit={add}>
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as 'x' | 'telegram' })}>
            <option value="x">X</option>
            <option value="telegram">Telegram</option>
          </select>
          <input style={{ flex: 1 }} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="@kullanıcı ya da kanal" required />
          <input style={{ flex: 1 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ad (isteğe bağlı)" />
          <input style={{ flex: 1 }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Not" />
          <button className="btn btn-primary">Ekle</button>
        </form>
      )}
      <input value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Havuzda ara" />
      {filtered.length === 0 ? (
        <p className="faint">Havuz boş.</p>
      ) : (
        <table>
          <tbody>
            {filtered.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
              <tr key={r.id}>
                <td>
                  <a
                    href={r.platform === 'x' ? `https://x.com/${r.handle}` : `https://t.me/${r.handle}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{r.handle}
                  </a>{' '}
                  <span className="muted">{r.title}</span>
                </td>
                <td className="muted">{r.platform === 'x' ? 'X' : 'Telegram'}</td>
                <td className="faint">{r.note}</td>
                <td style={{ textAlign: 'right' }}>
                  {founder && (
                    <button className="btn btn-xs btn-danger" onClick={() => supabase.from('shared_accounts').delete().eq('id', r.id).then(load)}>
                      Kaldır
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={filtered.length} setPage={setPage} />
    </div>
  )
}
