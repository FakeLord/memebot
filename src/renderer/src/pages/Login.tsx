import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Kayıt ekranı yok: hesapları sadece founder oluşturur.
export function LoginPage() {
  const { inactive, mfaRequired, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError('E-posta ya da parola hatalı.')
    setBusy(false)
  }

  // İkinci adım: kimlik doğrulayıcı uygulamadaki 6 haneli kod
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data: factors, error: fe } = await supabase.auth.mfa.listFactors()
    const factor = factors?.totp.find((f) => f.status === 'verified')
    if (fe || !factor) {
      setError('Doğrulama yöntemi bulunamadı. Çıkış yapıp tekrar deneyin.')
      setBusy(false)
      return
    }
    const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') })
    if (ve) {
      setError('Kod hatalı ya da süresi geçti. Uygulamadaki güncel kodu girin.')
      setCode('')
    }
    setBusy(false)
  }

  if (mfaRequired) {
    return (
      <div className="login-wrap">
        <form className="login" onSubmit={verify}>
          <div>
            <h1>İki adımlı doğrulama</h1>
            <p className="muted">Kimlik doğrulayıcı uygulamanızdaki 6 haneli kodu girin.</p>
          </div>
          {error && <div className="notice error">{error}</div>}
          <label>
            Kod
            <input
              className="mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              autoFocus
              required
            />
          </label>
          <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, '').length !== 6}>
            {busy ? 'Doğrulanıyor…' : 'Doğrula'}
          </button>
          <button type="button" className="link faint" onClick={() => signOut()}>
            Vazgeç ve çıkış yap
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div>
          <h1>MemeBot</h1>
          <p className="muted">Hesabınız yoksa founder'dan isteyin.</p>
        </div>
        {inactive && !error && <div className="notice error">Bu hesap aktif değil.</div>}
        {error && <div className="notice error">{error}</div>}
        <label>
          E-posta
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label>
          Parola
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
    </div>
  )
}
