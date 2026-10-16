import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useTelegram } from '../lib/telegram'
import { useAuth } from '../lib/auth'
import type { TelegramChat } from '../../../shared/types'

export function SourcesPage() {
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <ConnectionCard />
      <ChatsCard />
    </div>
  )
}

function ConnectionCard() {
  const { status } = useTelegram()
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const start = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await window.api.telegram.startLogin(Number(apiId), apiHash, phone)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const sendCode = (e: FormEvent) => {
    e.preventDefault()
    window.api.telegram.submitCode(code)
    setCode('')
  }

  const sendPassword = (e: FormEvent) => {
    e.preventDefault()
    window.api.telegram.submitPassword(password)
    setPassword('')
  }

  return (
    <div className="card stack">
      <h2>Telegram bağlantısı</h2>

      {status.state === 'connected' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row">
            <span className="dot on" /> Bağlı: <span className="mono">{status.me}</span>
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => window.api.telegram.logout()}>
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
            <button className="btn btn-primary" disabled={!code}>
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
            <button className="btn btn-primary" disabled={!password}>
              Giriş
            </button>
          </div>
        </form>
      )}

      {(status.state === 'needs_setup' || status.state === 'disconnected') && (
        <form className="stack" onSubmit={start}>
          <p className="muted">
            Uygulama Telegram'a <b>sizin hesabınızla, sadece okumak için</b> bağlanır; mesaj göndermez. Ana hesabınız yerine ayrı bir
            hesap kullanmanız önerilir. API ID ve API Hash'i <span className="mono">my.telegram.org → API development tools</span>{' '}
            sayfasından alın. Oturum sadece bu bilgisayarda şifreli saklanır.
          </p>
          {status.state === 'disconnected' && status.reason && <div className="notice error">{status.reason}</div>}
          {error && <div className="notice error">{error}</div>}
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
            <button className="btn btn-primary">Kod gönder</button>
          </div>
        </form>
      )}
    </div>
  )
}

function ChatsCard() {
  const { profile } = useAuth()
  const { status, sources, reloadSources } = useTelegram()
  const [chats, setChats] = useState<TelegramChat[] | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const watchedIds = useMemo(() => new Set(sources.filter((s) => s.is_active).map((s) => s.chat_id)), [sources])

  const load = async () => {
    setBusy(true)
    setError(null)
    const r = await window.api.telegram.listChats()
    setBusy(false)
    if (r.ok) setChats(r.chats)
    else setError(r.error)
  }

  const toggle = async (chat: TelegramChat) => {
    const on = !watchedIds.has(chat.id)
    const { error } = await supabase
      .from('sources')
      .upsert(
        { user_id: profile!.id, type: 'telegram', chat_id: chat.id, title: chat.title, is_active: on },
        { onConflict: 'user_id,type,chat_id' }
      )
    if (error) setError(error.message)
    await reloadSources()
  }

  const stop = async (chatId: string) => {
    await supabase.from('sources').update({ is_active: false }).eq('user_id', profile!.id).eq('type', 'telegram').eq('chat_id', chatId)
    await reloadSources()
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
