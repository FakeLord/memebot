import { useState, type FormEvent } from 'react'
import { Check, ExternalLink, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { errText, useEngine } from '../lib/engine'
import { XLogo } from '../components/FeedCard'
import { Section, SettingRow, Stat, StatusPill, since } from '../components/ui'
import { useSources } from './Sources'
import type { TweetStreamState } from '../../../shared/engine'

// Kaynaklar → X (TweetStream): gönderiler WebSocket ile anında gelir (yoklama yok).
// Anahtar mühürlü zarfla motora gider; izlenen hesaplar TweetStream'in kendi listesinde tutulur ve buradan eklenir.

const PLAN: Record<string, string> = { BASIC: 'Minimum', ELITE: 'Pro', ENTERPRISE: 'Scale' }

const STATE: Record<NonNullable<TweetStreamState['state']>, { label: string; tone: 'on' | 'off' | 'wait' }> = {
  live: { label: 'Canlı', tone: 'on' },
  connecting: { label: 'Bağlanıyor', tone: 'wait' },
  reconnecting: { label: 'Yeniden bağlanıyor', tone: 'wait' },
  error: { label: 'Hata', tone: 'off' },
  no_key: { label: 'Anahtar yok', tone: 'off' }
}

const RESULT: Record<string, string> = {
  added: 'eklendi',
  already_following: 'zaten izleniyor',
  invalid_input: 'geçersiz ad',
  duplicate: 'tekrar',
  not_found: 'X\'te bulunamadı',
  failed: 'eklenemedi'
}

/** Virgül, boşluk ya da satırla ayrılmış adlar */
export const splitHandles = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)

export function TweetStreamSection() {
  const { me, online, run, runSealed } = useEngine()
  const { sources, reload } = useSources('x')
  const ts: TweetStreamState = me?.x?.ts ?? {}
  const configured = ts.configured === true
  const st = STATE[ts.state ?? 'no_key']
  const [key, setKey] = useState('')
  const [region, setRegion] = useState<'global' | 'usa'>('global')
  const [handles, setHandles] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, ok?: (r: never) => string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if (ok) setMsg({ kind: 'ok', text: ok(r as never) })
      return true
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (
      await act(
        () => runSealed('tweetstream.save', { apiKey: key.trim(), region }),
        (r: { plan?: string; count: number; limit?: number }) =>
          `Anahtar doğrulandı ve motora şifreli kaydedildi · plan ${PLAN[r.plan ?? ''] ?? r.plan ?? '—'} · ${r.count}${r.limit ? `/${r.limit}` : ''} hesap`
      )
    )
      setKey('')
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const list = splitHandles(handles)
    if (!list.length) return
    const ok = await act(
      () => run('tweetstream.add', { handles: list }),
      (r: { results: { input: string; state: string; message?: string }[] }) =>
        r.results.map((x) => `${x.input}: ${RESULT[x.state] ?? x.state}${x.message ? ` (${x.message})` : ''}`).join(' · ')
    )
    if (ok) {
      setHandles('')
      reload()
    }
  }

  const tsRows = sources.filter((s) => s.chat_id.startsWith('ts:'))
  // TweetStream listesinde olup henüz kaynak satırı olmayanlar da görünsün
  const known = new Set(tsRows.map((s) => s.chat_id.slice(3)))
  const extra = (ts.handles ?? []).filter((h) => !known.has(h))

  const toggle = async (id: string, on: boolean) => {
    await supabase.from('sources').update({ is_active: on }).eq('id', id)
    reload()
  }

  return (
    <Section
      icon={() => <XLogo size={11} />}
      title="X / Twitter (TweetStream)"
      count={configured ? tsRows.length + extra.length : undefined}
      actions={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
      note={
        configured ? (
          <>
            Gönderiler WebSocket ile anında itilir; motor bağlantı koparsa kendiliğinden yeniden bağlanır. Hesap eklemek TweetStream'deki izleme listenize
            yazar (plan sınırı geçerli). Burada izlemeden çıkarılan hesap TweetStream'de kalır ama gönderileri işlenmez; tamamen bırakmak için ×.
          </>
        ) : (
          <>
            <a href="https://tweetstream.io/dashboard" target="_blank" rel="noreferrer">
              tweetstream.io/dashboard
            </a>{' '}
            adresinden API anahtarınızı alın. WebSocket erişimi için deneme ya da ücretli plan gerekir. Anahtar şifrelenip motora gider; arayüzde saklanmaz.
          </>
        )
      }
    >
      {msg && <div className={`notice ${msg.kind}`} style={{ marginBottom: 6 }}>{msg.text}</div>}
      {ts.error && ts.state !== 'live' && <div className="notice error" style={{ marginBottom: 6 }}>{ts.error}</div>}

      {!configured ? (
        <form onSubmit={save}>
          <SettingRow title="TweetStream API anahtarı" desc="Kaydetmeden önce motor anahtarı ve aboneliği dener">
            <input
              className="input-sm mono"
              type="password"
              style={{ width: 240 }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="API anahtarı"
              autoComplete="off"
              spellCheck={false}
            />
          </SettingRow>
          <SettingRow title="Sunucu bölgesi" desc="Türkiye ve Avrupa için Global; ABD'de çalışan motor için ABD">
            <select className="input-sm" value={region} onChange={(e) => setRegion(e.target.value as 'global' | 'usa')}>
              <option value="global">Global</option>
              <option value="usa">ABD (Virginia)</option>
            </select>
          </SettingRow>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={busy || !online || key.trim().length < 8}>
              <Zap size={13} /> {busy ? 'Deneniyor…' : 'Doğrula ve kaydet'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 8 }}>
            <Stat label="Plan" value={PLAN[ts.plan ?? ''] ?? ts.plan ?? '—'} />
            <Stat label="Hesap" value={`${ts.count ?? 0}${ts.limit ? ` / ${ts.limit}` : ''}`} />
            <Stat label="Son gecikme" value={ts.lastLatencyMs != null ? `${ts.lastLatencyMs} ms` : '—'} tone={ts.lastLatencyMs == null ? undefined : ts.lastLatencyMs < 1500 ? 'pos' : 'warn'} />
            <Stat label="Son gönderi" value={ts.lastEventAt ? since(new Date(ts.lastEventAt).toISOString()) : '—'} />
          </div>

          <form className="row" style={{ flexWrap: 'nowrap', marginBottom: 8 }} onSubmit={add}>
            <input
              style={{ flex: 1 }}
              value={handles}
              onChange={(e) => setHandles(e.target.value)}
              placeholder="@kullanici, @ikinci ya da x.com/kullanici"
              spellCheck={false}
            />
            <button className="btn btn-primary" disabled={busy || !online || !splitHandles(handles).length}>
              <Plus size={13} /> Hesap ekle
            </button>
          </form>

          {tsRows.length + extra.length === 0 ? (
            <div className="empty">Henüz izlenen hesap yok. Yukarıdan @kullanıcı adıyla ekleyin.</div>
          ) : (
            <div className="list">
              {tsRows.map((s) => {
                const h = s.chat_id.slice(3)
                return (
                  <div key={s.id} className={`list-row ${s.is_active ? '' : 'dim'}`}>
                    <button className="circle" role="checkbox" aria-checked={s.is_active} title={s.is_active ? 'İzlemeyi duraklat' : 'İzle'} onClick={() => toggle(s.id, !s.is_active)}>
                      {s.is_active && <Check size={10} strokeWidth={4} />}
                    </button>
                    <span className="faint">
                      <XLogo size={11} />
                    </span>
                    <div className="list-row-main">
                      <span className="list-row-title">@{h}</span>
                    </div>
                    {s.is_active && <StatusPill tone="on">İzleniyor</StatusPill>}
                    <a className="icon-btn" title="X'te aç" href={`https://x.com/${h}`} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} />
                    </a>
                    <button
                      className="icon-btn danger"
                      title="TweetStream'den tamamen çıkar"
                      disabled={busy || !online}
                      onClick={() => act(() => run('tweetstream.remove', { handle: h }), () => `@${h} çıkarıldı`).then(reload)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
              {extra.map((h) => (
                <div key={h} className="list-row dim">
                  <span className="faint">
                    <XLogo size={11} />
                  </span>
                  <div className="list-row-main">
                    <span className="list-row-title">@{h}</span>
                    <span className="list-row-sub">Kaynak kaydı bekleniyor</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <select
              className="input-sm"
              value={ts.region ?? 'global'}
              disabled={busy || !online}
              title="Sunucu bölgesi"
              onChange={(e) => act(() => run('tweetstream.region', { region: e.target.value as 'global' | 'usa' }), () => 'Bölge değişti, akış yeniden bağlanıyor')}
            >
              <option value="global">Global</option>
              <option value="usa">ABD (Virginia)</option>
            </select>
            <button className="btn btn-sm btn-ghost" disabled={busy || !online} onClick={() => act(() => run('tweetstream.refresh', {}), () => 'Plan ve hesap listesi yenilendi')}>
              <RefreshCw size={13} /> Yenile
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || !online}
              onClick={() => confirm('TweetStream anahtarı motordan silinsin mi? Akış durur; TweetStream\'deki izleme listeniz silinmez.') && act(() => run('tweetstream.clear', {}), () => 'Anahtar silindi')}
            >
              <Trash2 size={13} /> Anahtarı sil
            </button>
          </div>
        </>
      )}
    </Section>
  )
}
