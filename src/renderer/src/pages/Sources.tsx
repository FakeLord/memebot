import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { errText, useEngine } from '../lib/engine'
import type { TelegramChat, TelegramStatus } from '../../../shared/types'
import type { XState } from '../../../shared/engine'

// Kaynaklar: Telegram oturumu ve XFlux anahtarı motorda çalışır. Bu ekran girişleri mühürlü komutla motora
// iletir, izlenecek kanal/hesapları "sources" tablosuna yazar; motor değişikliği anında görür.

export interface SourceRow {
  id: string
  type: 'telegram' | 'x' | 'manual'
  chat_id: string
  title: string
  is_active: boolean
}

export function useSources(type: SourceRow['type']) {
  const { profile } = useAuth()
  const [sources, setSources] = useState<SourceRow[]>([])
  const reload = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('sources')
      .select('id, type, chat_id, title, is_active')
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

export function SourcesPage() {
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <ConnectionCard />
      <ChatsCard />
      <XCard />
    </div>
  )
}

function useTelegramStatus(): TelegramStatus {
  const { me } = useEngine()
  const t = me?.telegram as TelegramStatus | undefined
  return t && 'state' in t ? t : { state: 'needs_setup' }
}

function ConnectionCard() {
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

  return (
    <div className="card stack">
      <h2>Telegram bağlantısı</h2>
      {!online && <div className="notice">Motor çalışmıyor; Telegram bağlantısı motor açılınca kurulur.</div>}
      {error && <div className="notice error">{error}</div>}

      {status.state === 'connected' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row">
            <span className="dot on" /> Bağlı: <span className="mono">{status.me}</span>
          </span>
          <button
            className="btn btn-sm btn-danger"
            disabled={busy || !online}
            onClick={() => confirm('Telegram bağlantısı kaldırılsın mı? Oturum kapatılır.') && act(() => run('telegram.logout', {}))}
          >
            Bağlantıyı kaldır
          </button>
        </div>
      )}

      {status.state === 'connecting' && <p className="muted">Bağlanıyor…</p>}

      {status.state === 'code' && (
        <form className="stack" onSubmit={sendCode}>
          <p className="muted">
            {status.viaApp ? 'Telegram uygulamanıza bir giriş kodu gönderildi.' : 'Telefonunuza SMS ile bir giriş kodu gönderildi.'}
          </p>
          {status.error && <div className="notice error">{status.error}</div>}
          <div className="row">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Kod" autoFocus inputMode="numeric" />
            <button className="btn btn-primary" disabled={!code || busy}>
              Doğrula
            </button>
          </div>
        </form>
      )}

      {status.state === 'password' && (
        <form className="stack" onSubmit={sendPassword}>
          <p className="muted">İki adımlı doğrulama şifrenizi girin{status.hint ? ` (ipucu: ${status.hint})` : ''}.</p>
          {status.error && <div className="notice error">{status.error}</div>}
          <div className="row">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <button className="btn btn-primary" disabled={!password || busy}>
              Giriş
            </button>
          </div>
        </form>
      )}

      {(status.state === 'needs_setup' || status.state === 'disconnected') && (
        <form className="stack" onSubmit={start}>
          <p className="muted">
            Motor Telegram'a <b>sizin hesabınızla, sadece okumak için</b> bağlanır; mesaj göndermez. Ana hesabınız yerine ayrı bir hesap
            kullanmanız önerilir. API ID ve API Hash'i <span className="mono">my.telegram.org → API development tools</span> sayfasından alın.
            Bilgiler şifrelenerek motora gider; oturum motorun kasasında saklanır.
          </p>
          {status.state === 'disconnected' && status.reason && <div className="notice error">{status.reason}</div>}
          <div className="grid-2">
            <label>
              API ID
              <input value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" required />
            </label>
            <label>
              API Hash
              <input value={apiHash} onChange={(e) => setApiHash(e.target.value)} spellCheck={false} required />
            </label>
            <label>
              Telefon numarası
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+905..." required />
            </label>
          </div>
          <div>
            <button className="btn btn-primary" disabled={busy || !online}>
              Kod gönder
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function ChatsCard() {
  const { profile } = useAuth()
  const status = useTelegramStatus()
  const { run } = useEngine()
  const { sources, reload } = useSources('telegram')
  const [chats, setChats] = useState<TelegramChat[] | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const watchedIds = useMemo(() => new Set(sources.filter((s) => s.is_active).map((s) => s.chat_id)), [sources])

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

  const watched = sources.filter((s) => s.is_active)
  const visible = (chats ?? []).filter((c) => c.title.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr')))

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>İzlenen kanallar ({watched.length})</h2>
        <button className="btn btn-sm" disabled={status.state !== 'connected' || busy} onClick={load}>
          {busy ? 'Yükleniyor…' : chats ? 'Listeyi yenile' : 'Kanal ekle'}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}

      {watched.length === 0 && !chats && <p className="muted">Henüz izlenen kanal yok.</p>}
      {watched.length > 0 && (
        <table>
          <tbody>
            {watched.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-sm" onClick={() => stop(s.chat_id)}>
                    İzlemeyi bırak
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {chats && (
        <div className="stack">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kanal ya da grup ara" />
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            <table>
              <tbody>
                {visible.map((c) => {
                  const on = watchedIds.has(c.id)
                  return (
                    <tr key={c.id}>
                      <td>
                        {c.title} <span className="faint">{c.kind === 'channel' ? 'kanal' : 'grup'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => toggle(c)}>
                          {on ? 'İzleniyor' : 'İzle'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const X_STATE: Record<XState, string> = {
  no_key: 'XFlux anahtarı yok',
  starting: 'Başlıyor…',
  polling: 'Çalışıyor',
  error: 'Hata'
}

function XCard() {
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

  return (
    <div className="card stack">
      <h2>X / Twitter (XFlux)</h2>
      <div className="row">
        <span className={`dot ${state === 'polling' ? 'on' : 'off'}`} />
        <span>{X_STATE[state]}</span>
        {state === 'polling' && x.intervalMs && <span className="faint">· {Math.round(x.intervalMs / 1000)} sn'de bir</span>}
        {x.quotaRemaining !== undefined && <span className="faint">· kalan aylık kota {x.quotaRemaining.toLocaleString('tr-TR')}</span>}
      </div>
      {x.error && <div className="notice error">{x.error}</div>}
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      {state === 'no_key' ? (
        <form className="stack" onSubmit={save}>
          <p className="muted">
            İzlemek istediğiniz hesaplar için <b>XFlux paneli → Monitors</b> bölümünde izleyici kurun (anahtar kelime boş bırakılırsa tüm
            gönderiler gelir). <b>Ücretsiz plan</b> 1 izleyiciyi 5 dakikada bir kontrol eder: akışta X gönderilerini görmek için yeterli, token
            yakalamak için yavaş. Anahtar şifrelenip motora gider.
          </p>
          <div className="row">
            <input style={{ flex: 1 }} value={key} onChange={(e) => setKey(e.target.value)} placeholder="xflux_..." spellCheck={false} autoComplete="off" />
            <button className="btn btn-primary" disabled={busy || !online || !key.trim()}>
              {busy ? 'Kontrol ediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {!x.monitors?.length ? (
            <p className="muted">XFlux'ta izleyici bulunamadı. Panelden bir hesap için izleyici kurun; liste birkaç dakika içinde kendiliğinden güncellenir.</p>
          ) : (
            <table>
              <tbody>
                {x.monitors.map((m) => {
                  const on = watched.has(m.id)
                  return (
                    <tr key={m.id}>
                      <td>@{m.username}</td>
                      <td className="faint">{m.hits ? `son ${m.hits} gönderi` : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => toggle(m.id, m.username)}>
                          {on ? 'İzleniyor' : 'İzle'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div>
            <button
              className="btn btn-sm btn-danger"
              disabled={!online}
              onClick={async () => {
                try {
                  await run('xflux.clear', {})
                  setMsg({ kind: 'ok', text: 'XFlux anahtarı motordan silindi.' })
                } catch (e) {
                  setMsg({ kind: 'error', text: errText(e) })
                }
              }}
            >
              Anahtarı sil
            </button>
          </div>
        </>
      )}
    </div>
  )
}
