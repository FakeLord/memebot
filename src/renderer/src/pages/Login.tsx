import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Kayıt ekranı yok: hesapları sadece founder oluşturur.
export function LoginPage() {
  const { inactive } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
