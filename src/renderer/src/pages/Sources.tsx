import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, KeyRound, LogOut, Plus, RefreshCw, Search, Send, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { errText, useEngine } from '../lib/engine'
import { XLogo } from '../components/FeedCard'
import { Section, SettingRow, Stat, StatusPill } from '../components/ui'
import type { TelegramChat, TelegramStatus } from '../../../shared/types'
import type { XState } from '../../../shared/engine'
import { TweetStreamSection } from './TweetStreamSection'

// Kaynaklar: Telegram oturumu ve XFlux anahtarı motorda çalışır. Bu ekran girişleri mühürlü komutla motora
// iletir, izlenecek kanal/hesapları "sources" tablosuna yazar; motor değişikliği anında görür.

export interface SourceRow {
  id: string
  type: 'telegram' | 'x' | 'manual'
  chat_id: string
  title: string
  is_active: boolean
  muted: boolean
}

export function useSources(type: SourceRow['type']) {
  const { profile } = useAuth()
  const [sources, setSources] = useState<SourceRow[]>([])
  const reload = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('sources')
      .select('id, type, chat_id, title, is_active, muted')
      .eq('user_id', profile.id)
      .eq('type', type)
      .order('title')
    setSources((data as SourceRow[]) ?? [])
  }, [profile?.id, type])
  useEffect(() => {
    reload()
  }, [reload])
  return { sources, reload }
}

function useTelegramStatus(): TelegramStatus {
  const { me } = useEngine()
  const t = me?.telegram as TelegramStatus | undefined
  return t && 'state' in t ? t : { state: 'needs_setup' }
}

const X_STATE: Record<XState, string> = {
  no_key: 'Anahtar yok',
  starting: 'Başlıyor',
  polling: 'Çalışıyor',
  error: 'Hata'
}

export function SourcesPage() {
  const tg = useTelegramStatus()
  const { me } = useEngine()
  const { sources: tgSources } = useSources('telegram')
  const { sources: xSources } = useSources('x')
  const x = me?.x ?? {}
  const xState: XState = x.configured ? (x.state ?? 'starting') : 'no_key'
  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Stat label="Telegram" value={tg.state === 'connected' ? 'Bağlı' : 'Bağlı değil'} tone={tg.state === 'connected' ? 'pos' : 'neg'} />
        <Stat label="İzlenen kanal" value={tgSources.filter((s) => s.is_active).length} />
        <Stat
          label="X (TweetStream)"
          value={x.ts?.state === 'live' ? 'Canlı' : x.ts?.configured ? 'Bağlanıyor' : 'Anahtar yok'}
          tone={x.ts?.state === 'live' ? 'pos' : x.ts?.configured ? 'warn' : 'neg'}
        />
        <Stat label="X (XFlux)" value={X_STATE[xState]} tone={xState === 'polling' ? 'pos' : xState === 'starting' ? 'warn' : 'neg'} />
        <Stat label="İzlenen X hesabı" value={xSources.filter((s) => s.is_active).length} />
      </div>
      <TelegramSection />
      <ChatsSection />
      <TweetStreamSection />
      <XSection />
    </div>
  )
}

// ---------------------------------------------------------------- Telegram bağlantısı
function TelegramSection() {
  const status = useTelegramStatus()
  const { online, run, runSealed } = useEngine()
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault()
    act(() => runSealed('telegram.login', { apiId: Number(apiId), apiHash, phone }))
  }
  const sendCode = (e: FormEvent) => {
    e.preventDefault()
    act(() => runSealed('telegram.code', { code })).then(() => setCode(''))
  }
  const sendPassword = (e: FormEvent) => {
    e.preventDefault()
    act(() => runSealed('telegram.password', { password })).then(() => setPassword(''))
  }

  const pill =
    status.state === 'connected' ? (
      <StatusPill tone="on">Bağlı</StatusPill>
    ) : status.state === 'connecting' || status.state === 'code' || status.state === 'password' ? (
      <StatusPill tone="wait">Giriş sürüyor</StatusPill>
    ) : (
      <StatusPill tone="off">Bağlı değil</StatusPill>
    )

  return (
    <Section
      icon={Send}
      title="Telegram bağlantısı"
      actions={pill}
      note={
        <>
          Motor Telegram'a <b>sizin hesabınızla, sadece okumak için</b> bağlanır; mesaj göndermez. Ana hesabınız yerine ayrı bir hesap kullanmanız önerilir.
          Bilgiler şifrelenerek motora gider; oturum motorun kasasında saklanır.
        </>
      }
    >
      {!online && <div className="notice" style={{ marginBottom: 6 }}>Motor çalışmıyor; Telegram bağlantısı motor açılınca kurulur.</div>}
      {error && <div className="notice error" style={{ marginBottom: 6 }}>{error}</div>}

      {status.state === 'connected' && (
        <SettingRow title={<span className="mono">{status.me}</span>} desc="Bu hesapla izlenen kanallar okunuyor">
          <button
            className="btn btn-sm btn-danger"
            disabled={busy || !online}
            onClick={() => confirm('Telegram bağlantısı kaldırılsın mı? Oturum kapatılır.') && act(() => run('telegram.logout', {}))}
          >
            <LogOut size={13} /> Bağlantıyı kaldır
          </button>
        </SettingRow>
      )}

      {status.state === 'connecting' && <SettingRow title="Bağlanıyor…" desc="Motor Telegram sunucusuna bağlanıyor" />}

      {status.state === 'code' && (
        <form onSubmit={sendCode}>
          <SettingRow
            title="Giriş kodu"
            desc={status.error ?? (status.viaApp ? 'Telegram uygulamanıza gelen kodu girin' : 'Telefonunuza SMS ile gelen kodu girin')}
          >
            <input className="input-sm" style={{ width: 140 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Kod" autoFocus inputMode="numeric" />
            <button className="btn btn-sm btn-primary" disabled={!code || busy}>
              Doğrula
            </button>
          </SettingRow>
        </form>
      )}

      {status.state === 'password' && (
        <form onSubmit={sendPassword}>
          <SettingRow title="İki adımlı doğrulama" desc={status.error ?? (status.hint ? `İpucu: ${status.hint}` : 'Hesabınızın bulut şifresi')}>
            <input className="input-sm" style={{ width: 180 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <button className="btn btn-sm btn-primary" disabled={!password || busy}>
              Giriş
            </button>
          </SettingRow>
        </form>
      )}

      {(status.state === 'needs_setup' || status.state === 'disconnected') && (
        <form onSubmit={start}>
          {status.state === 'disconnected' && status.reason && <div className="notice error" style={{ marginBottom: 6 }}>{status.reason}</div>}
          <SettingRow title="API ID" desc={<>my.telegram.org → API development tools</>}>
            <input className="input-sm" style={{ width: 220 }} value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" required />
          </SettingRow>
          <SettingRow title="API Hash" desc="Aynı sayfadaki 32 karakterlik anahtar">
            <input className="input-sm mono" style={{ width: 220 }} value={apiHash} onChange={(e) => setApiHash(e.target.value)} spellCheck={false} required />
          </SettingRow>
          <SettingRow title="Telefon numarası" desc="Ülke koduyla birlikte">
            <input className="input-sm" style={{ width: 220 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+905..." required />
          </SettingRow>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={busy || !online}>
              <KeyRound size={13} /> Kod gönder
            </button>
          </div>
        </form>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- izlenen Telegram kanalları
function ChatsSection() {
  const { profile } = useAuth()
  const status = useTelegramStatus()
  const { run } = useEngine()
  const { sources, reload } = useSources('telegram')
  const [chats, setChats] = useState<TelegramChat[] | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const watchedIds = useMemo(() => new Set(sources.filter((s) => s.is_active).map((s) => s.chat_id)), [sources])
  const watched = sources.filter((s) => s.is_active)

  const load = async () => {
    setBusy(true)
    setError(null)
    try {
      setChats((await run('telegram.chats', {}, 60_000)).chats)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (chat: TelegramChat) => {
    const on = !watchedIds.has(chat.id)
    const { error } = await supabase
      .from('sources')
      .upsert({ user_id: profile!.id, type: 'telegram', chat_id: chat.id, title: chat.title, is_active: on }, { onConflict: 'user_id,type,chat_id' })
    if (error) setError(error.message)
    await reload()
  }

  const stop = async (chatId: string) => {
    await supabase.from('sources').update({ is_active: false }).eq('user_id', profile!.id).eq('type', 'telegram').eq('chat_id', chatId)
    await reload()
  }

  const visible = (chats ?? []).filter((c) => c.title.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr')))

  return (
    <Section
      icon={Send}
      title="İzlenen kanallar"
      count={watched.length}
      actions={
        <button className="btn btn-sm" disabled={status.state !== 'connected' || busy} onClick={load}>
          {chats ? <RefreshCw size={13} className={busy ? 'spin' : undefined} /> : <Plus size={13} />}
          {busy ? 'Yükleniyor…' : chats ? 'Listeyi yenile' : 'Kanal ekle'}
        </button>
      }
    >
      {error && <div className="notice error" style={{ marginBottom: 6 }}>{error}</div>}
      {watched.length === 0 ? (
        <div className="empty">{status.state === 'connected' ? 'Henüz izlenen kanal yok. "Kanal ekle" ile sohbetlerinizden seçin.' : 'Kanal eklemek için önce Telegram bağlantısını kurun.'}</div>
      ) : (
        <div className="list">
          {watched.map((s) => (
            <div key={s.id} className="list-row">
              <span className="faint">
                <Send size={12} />
              </span>
              <div className="list-row-main">
                <span className="list-row-title ellipsis">{s.title}</span>
              </div>
              <StatusPill tone="on">İzleniyor</StatusPill>
              <button className="icon-btn danger" title="İzlemeyi bırak" onClick={() => stop(s.chat_id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {chats && (
        <div style={{ marginTop: 14 }}>
          <div className="section-head">
            <div className="section-label">Sohbetleriniz {chats.length}</div>
            <button className="icon-btn sm" title="Listeyi kapat" onClick={() => setChats(null)}>
              <X size={13} />
            </button>
          </div>
          <label className="search" style={{ marginBottom: 6 }}>
            <Search size={13} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kanal ya da grup ara" autoFocus />
          </label>
          <div className="list" style={{ maxHeight: 360, overflow: 'auto' }}>
            {visible.map((c) => {
              const on = watchedIds.has(c.id)
              return (
                <div key={c.id} className="list-row" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => toggle(c)} onKeyDown={(e) => e.key === 'Enter' && toggle(c)}>
                  <span className="circle" role="checkbox" aria-checked={on}>
                    {on && <Check size={10} strokeWidth={4} />}
                  </span>
                  <span className="list-row-main">
                    <span className="list-row-title ellipsis">{c.title}</span>
                    <span className="list-row-sub">{c.kind === 'channel' ? 'Kanal' : 'Grup'}</span>
                  </span>
                </div>
              )
            })}
            {visible.length === 0 && <p className="faint" style={{ fontSize: 12, padding: 8 }}>Eşleşen sohbet yok.</p>}
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- X (XFlux)
function XSection() {
  const { profile } = useAuth()
  const { me, online, run, runSealed } = useEngine()
  const { sources, reload } = useSources('x')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const x = me?.x ?? {}
  const state: XState = x.configured ? (x.state ?? 'starting') : 'no_key'
  const watched = new Set(sources.filter((s) => s.is_active).map((s) => s.chat_id))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await runSealed('xflux.save', { apiKey: key })
      setKey('')
      setMsg({ kind: 'ok', text: 'Anahtar motora şifreli kaydedildi. İzleyiciler birkaç saniye içinde listelenecek.' })
    } catch (err) {
      setMsg({ kind: 'error', text: errText(err) })
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (id: string, username: string) => {
    const on = !watched.has(id)
    const { error } = await supabase
      .from('sources')
      .upsert({ user_id: profile!.id, type: 'x', chat_id: id, title: `@${username}`, is_active: on }, { onConflict: 'user_id,type,chat_id' })
    if (error) setMsg({ kind: 'error', text: error.message })
    await reload()
  }

  const clear = async () => {
    if (!confirm('XFlux anahtarı motordan silinsin mi?')) return
    try {
      await run('xflux.clear', {})
      setMsg({ kind: 'ok', text: 'XFlux anahtarı motordan silindi.' })
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
    }
  }

  const tone = state === 'polling' ? 'on' : state === 'starting' ? 'wait' : 'off'

  return (
    <Section
      icon={() => <XLogo size={11} />}
      title="X / Twitter (XFlux · yedek)"
      count={x.monitors?.length}
      actions={<StatusPill tone={tone}>{X_STATE[state]}</StatusPill>}
      note={
        state === 'no_key' ? (
          <>
            İzlemek istediğiniz hesaplar için <b>XFlux paneli → Monitors</b> bölümünde izleyici kurun (anahtar kelime boş bırakılırsa tüm gönderiler gelir).
            Ücretsiz plan 1 izleyiciyi 5 dakikada bir kontrol eder: akış için yeterli, token yakalamak için yavaş.
          </>
        ) : (
          <>
            {state === 'polling' && x.intervalMs ? `${Math.round(x.intervalMs / 1000)} sn'de bir kontrol ediliyor` : 'Kontrol başlatılıyor'}
            {x.quotaRemaining !== undefined && ` · kalan aylık kota ${x.quotaRemaining.toLocaleString('tr-TR')}`}. Yeni izleyiciler XFlux panelinde kurulur; liste
            birkaç dakika içinde güncellenir.
          </>
        )
      }
    >
      {x.error && <div className="notice error" style={{ marginBottom: 6 }}>{x.error}</div>}
      {msg && <div className={`notice ${msg.kind}`} style={{ marginBottom: 6 }}>{msg.text}</div>}

      {state === 'no_key' ? (
        <form onSubmit={save}>
          <SettingRow title="XFlux API anahtarı" desc="Şifrelenip motora gider, arayüzde saklanmaz">
            <input
              className="input-sm mono"
              style={{ width: 240 }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="xflux_..."
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn btn-sm btn-primary" disabled={busy || !online || !key.trim()}>
              {busy ? 'Kontrol ediliyor…' : 'Kaydet'}
            </button>
          </SettingRow>
        </form>
      ) : (
        <>
          {!x.monitors?.length ? (
            <div className="empty">XFlux'ta izleyici bulunamadı. Panelden bir hesap için izleyici kurun.</div>
          ) : (
            <div className="list">
              {x.monitors.map((m) => {
                const on = watched.has(m.id)
                return (
                  <div key={m.id} className={`list-row ${on ? '' : 'dim'}`}>
                    <button className="circle" role="checkbox" aria-checked={on} title={on ? 'İzlemeyi bırak' : 'İzle'} onClick={() => toggle(m.id, m.username)}>
                      {on && <Check size={10} strokeWidth={4} />}
                    </button>
                    <span className="faint">
                      <XLogo size={11} />
                    </span>
                    <div className="list-row-main">
                      <span className="list-row-title">@{m.username}</span>
                      {m.hits ? <span className="list-row-sub">son {m.hits} gönderi</span> : null}
                    </div>
                    {on && <StatusPill tone="on">İzleniyor</StatusPill>}
                  </div>
                )
              })}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-sm btn-ghost" disabled={!online} onClick={clear}>
              <Trash2 size={13} /> Anahtarı sil
            </button>
          </div>
        </>
      )}
    </Section>
  )
}
