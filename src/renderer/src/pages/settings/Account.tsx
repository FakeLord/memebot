import { useEffect, useState, type FormEvent } from 'react'
import { Check, ShieldCheck, ShieldOff, UserRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ROLE_LABEL, useAuth } from '../../lib/auth'
import { Avatar, Section, SettingRow, StatusPill } from '../../components/ui'

// Hesabım: profil özelleştirme (görünen ad, avatar, durum notu) ve iki adımlı doğrulama (TOTP).

const EMOJIS = ['🐸', '🐶', '🐱', '🦊', '🐻', '🦁', '🐺', '🦄', '🐙', '🦈', '🚀', '🔥', '💎', '👑', '⚡', '🎯', '🌙', '🧠', '🤖', '👾']
const COLORS = ['#5865f2', '#22c55e', '#ef4444', '#eab308', '#f97316', '#ec4899', '#06b6d4', '#a855f7', '#8b9bb4']

type Msg = { kind: 'ok' | 'error'; text: string }

export function AccountSection() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <ProfileCard />
      <SecurityCard />
    </div>
  )
}

function ProfileCard() {
  const { profile, reloadProfile } = useAuth()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [emoji, setEmoji] = useState(profile?.avatar_emoji ?? '')
  const [color, setColor] = useState(profile?.avatar_color ?? '')
  const [status, setStatus] = useState(profile?.status_text ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('update_my_profile', {
      p_display_name: name,
      p_avatar_emoji: emoji,
      p_avatar_color: color,
      p_status_text: status
    })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: `Kaydedilemedi: ${error.message}` })
    await reloadProfile()
    setMsg({ kind: 'ok', text: 'Profil güncellendi.' })
  }

  const preview = { username: profile?.username, display_name: name, avatar_emoji: emoji, avatar_color: color }

  return (
    <Section icon={UserRound} title="Profil" note="Görünen ad ve avatar üst menüde ve kullanıcı listesinde görünür. Kullanıcı adınız ve rolünüz değişmez.">
      <form className="stack" onSubmit={save}>
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <SettingRow title="Önizleme" desc={`${profile?.username} · ${profile ? ROLE_LABEL[profile.role] : ''}`}>
          <div className="row" style={{ gap: 10 }}>
            <Avatar profile={preview} size={40} />
            <div>
              <div style={{ fontWeight: 600 }}>{name || profile?.username}</div>
              {status && <div className="faint" style={{ fontSize: 12 }}>{status}</div>}
            </div>
          </div>
        </SettingRow>
        <SettingRow title="Görünen ad" desc="Boş bırakırsanız kullanıcı adınız görünür." stacked>
          <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder={profile?.username} />
        </SettingRow>
        <SettingRow title="Avatar" desc="Bir emoji seçin; seçmezseniz baş harfiniz görünür." stacked>
          <div className="avatar-pick">
            <button type="button" aria-pressed={emoji === ''} title="Baş harf" onClick={() => setEmoji('')}>
              A
            </button>
            {EMOJIS.map((em) => (
              <button type="button" key={em} aria-pressed={emoji === em} onClick={() => setEmoji(em)}>
                {em}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Renk" stacked>
          <div className="swatch-row">
            <button type="button" className="swatch" aria-pressed={color === ''} title="Varsayılan" style={{ background: 'var(--surface-2)', borderColor: color === '' ? 'var(--text)' : 'var(--border)' }} onClick={() => setColor('')} />
            {COLORS.map((c) => (
              <button type="button" key={c} className="swatch" aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Durum notu" desc="Tek satır, en fazla 80 karakter." stacked>
          <input value={status} maxLength={80} onChange={(e) => setStatus(e.target.value)} placeholder="Örn. Gece nöbetindeyim" />
        </SettingRow>
        <div>
          <button className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Section>
  )
}

interface Enroll {
  factorId: string
  qr: string
  secret: string
}

function SecurityCard() {
  const { reloadAal } = useAuth()
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined) // undefined: yükleniyor, null: kapalı
  const [enroll, setEnroll] = useState<Enroll | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactorId(data?.totp.find((f) => f.status === 'verified')?.id ?? null)
  }
  useEffect(() => {
    load()
  }, [])

  const start = async () => {
    setBusy(true)
    setMsg(null)
    // Yarım kalmış eski kurulum denemelerini temizle
    const { data: list } = await supabase.auth.mfa.listFactors()
    for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `MemeBot ${new Date().toLocaleDateString('tr-TR')}` })
    setBusy(false)
    if (error || !data) return setMsg({ kind: 'error', text: `Başlatılamadı: ${error?.message ?? 'bilinmeyen hata'}` })
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!enroll) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.replace(/\s/g, '') })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: 'Kod hatalı. Uygulamadaki güncel kodu girin.' })
    setEnroll(null)
    setMsg({ kind: 'ok', text: 'İki adımlı doğrulama açıldı. Bundan sonra girişte kod istenecek.' })
    await supabase.from('audit_log').insert({ action: 'mfa.enable' })
    await load()
    await reloadAal()
  }

  const cancel = async () => {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.factorId })
    setEnroll(null)
  }

  const disable = async () => {
    if (!factorId || !window.confirm('İki adımlı doğrulama kapatılsın mı? Hesabınız yalnız parolayla korunur.')) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: `Kapatılamadı: ${error.message}` })
    await supabase.from('audit_log').insert({ action: 'mfa.disable' })
    setMsg({ kind: 'ok', text: 'İki adımlı doğrulama kapatıldı.' })
    await load()
    await reloadAal()
  }

  const on = !!factorId
  return (
    <Section
      icon={on ? ShieldCheck : ShieldOff}
      title="İki adımlı doğrulama (2FA)"
      actions={factorId === undefined ? null : <StatusPill tone={on ? 'on' : 'off'}>{on ? 'Açık' : 'Kapalı'}</StatusPill>}
      note="Google Authenticator, Microsoft Authenticator, Authy, 1Password gibi bir kimlik doğrulayıcı uygulama gerekir. Telefonunuzu kaybederseniz founder (Kullanıcılar → anahtar simgesi) 2FA'nızı sıfırlayabilir; founder'ın kendisi için Supabase panelinde Authentication → Users üzerinden faktör silinir."
    >
      <div className="stack">
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        {enroll ? (
          <form className="mfa-steps" onSubmit={confirm}>
            <SettingRow title="1. QR kodu okutun" desc="Uygulamada “hesap ekle” → QR kodu tara. Okutamazsanız aşağıdaki anahtarı elle girin." stacked>
              <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                <img className="mfa-qr" src={enroll.qr} alt="2FA QR kodu" />
                <div style={{ display: 'grid', gap: 4 }}>
                  <span className="faint" style={{ fontSize: 11 }}>Elle giriş anahtarı</span>
                  <code className="mono" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{enroll.secret}</code>
                </div>
              </div>
            </SettingRow>
            <SettingRow title="2. Kodu doğrulayın" desc="Uygulamanın gösterdiği 6 haneli kodu girin." stacked>
              <div className="row">
                <input
                  className="mono"
                  style={{ width: 130 }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                  placeholder="000000"
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" disabled={busy || code.replace(/\s/g, '').length !== 6}>
                  <Check size={13} /> Etkinleştir
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={cancel}>
                  Vazgeç
                </button>
              </div>
            </SettingRow>
          </form>
        ) : on ? (
          <SettingRow title="Girişte kod istenir" desc="Hesabınız parola + uygulamadaki kodla korunuyor.">
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={disable}>
              Kapat
            </button>
          </SettingRow>
        ) : factorId === null ? (
          <SettingRow title="Hesabınızı ikinci bir adımla koruyun" desc="Parolanız çalınsa bile kod olmadan kimse giremez; veriler de kodsuz oturuma kapalıdır.">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={start}>
              Etkinleştir
            </button>
          </SettingRow>
        ) : (
          <p className="faint">Yükleniyor…</p>
        )}
      </div>
    </Section>
  )
}
