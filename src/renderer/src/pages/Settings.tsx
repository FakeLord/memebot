import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'

type Plan = 'free' | 'plus' | 'pro'

export function SettingsPage() {
  const { profile } = useAuth()
  const userId = profile!.id
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [pem, setPem] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState('')
  const [plan, setPlan] = useState<Plan>('free')

  useEffect(() => {
    window.api.gmgn.hasCredentials(userId).then(setHasKey)
    window.api.gmgn.getPlan(userId).then(setPlan)
    window.api.appVersion().then(setVersion)
  }, [userId])

  const save = async () => {
    setBusy(true)
    const r = await window.api.gmgn.saveCredentials(userId, apiKey, pem)
    setBusy(false)
    if (r.ok) {
      setApiKey('')
      setPem('')
      setHasKey(true)
      setMsg({ kind: 'ok', text: 'Anahtar bu bilgisayarda şifreli olarak kaydedildi.' })
    } else {
      setMsg({ kind: 'error', text: r.error ?? 'Kaydedilemedi' })
    }
  }

  const test = async () => {
    setBusy(true)
    const r = await window.api.gmgn.userInfo(userId)
    setBusy(false)
    setMsg(r.ok ? { kind: 'ok', text: 'GMGN bağlantısı çalışıyor.' } : { kind: 'error', text: `GMGN: ${r.error}` })
  }

  const clear = async () => {
    await window.api.gmgn.clearCredentials(userId)
    setHasKey(false)
    setMsg({ kind: 'ok', text: 'Anahtar bu bilgisayardan silindi.' })
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <h2>GMGN API</h2>
        <p className="muted">
          Anahtarınızı <span className="mono">gmgn.ai/ai</span> adresinden alın. Anahtar Supabase'e gönderilmez; sadece bu bilgisayarda,
          Windows tarafından şifrelenmiş olarak saklanır. Başka bir bilgisayarda yeniden girmeniz gerekir.
        </p>
        <div className="row">
          <span className={`dot ${hasKey ? 'on' : 'off'}`} />
          <span>{hasKey === null ? '…' : hasKey ? 'Anahtar kayıtlı' : 'Anahtar yok'}</span>
        </div>
        {hasKey && (
          <label style={{ maxWidth: 320 }}>
            GMGN planı (istek hızı sınırı)
            <select
              value={plan}
              onChange={async (e) => {
                const p = e.target.value as Plan
                if (await window.api.gmgn.setPlan(userId, p)) setPlan(p)
              }}
            >
              <option value="free">Free — 5 istek/sn</option>
              <option value="plus">Plus — 20 istek/sn</option>
              <option value="pro">Pro — 50 istek/sn</option>
            </select>
          </label>
        )}
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <label>
          API Key
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          İmza anahtarı (Ed25519 PEM — cüzdan anahtarı DEĞİL)
          <textarea
            rows={4}
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            spellCheck={false}
            placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !apiKey || !pem} onClick={save}>
            Kaydet
          </button>
          <button className="btn" disabled={busy || !hasKey} onClick={test}>
            Bağlantıyı test et
          </button>
          <button className="btn btn-danger" disabled={busy || !hasKey} onClick={clear}>
            Anahtarı sil
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Uygulama</h2>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">
            Sürüm <span className="mono">{version}</span>
          </span>
          <button className="btn btn-sm" onClick={() => window.api.updater.check()}>
            Güncellemeleri denetle
          </button>
        </div>
      </div>
    </div>
  )
}
