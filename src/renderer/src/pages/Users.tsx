import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { KeyRound, Search, Trash2, UserPlus, Users as UsersIcon, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { Avatar, Section, SettingRow, Stat, StatusPill } from '../components/ui'
import type { Profile, Role } from '../../../shared/types'

// Kullanıcılar (sadece founder): ekip üyeleri, rolleri, aktiflik; yeni hesap "manage-users" fonksiyonuyla açılır.

const ROLES: Role[] = ['founder', 'developer', 'assistant']
const ROLE_DESC: Record<Role, string> = {
  founder: 'Her şeyi yönetir, kill switch',
  developer: 'İşlem yapar, kuralları değiştirir',
  assistant: 'Görüntüler, işlem yapamaz'
}

export function UsersPage() {
  const { profile: me } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState<{ email: string; username: string; password: string; role: Role } | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  const load = () =>
    supabase
      .from('profiles')
      .select('*')
      .order('created_at')
      .then(({ data }) => setUsers((data as Profile[]) ?? []))

  useEffect(() => {
    load()
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'create', ...form } })
    setBusy(false)
    if (error || data?.error) {
      setMsg({ kind: 'error', text: `Oluşturulamadı: ${data?.error ?? error?.message}` })
      return
    }
    setMsg({ kind: 'ok', text: `${form.username} oluşturuldu. Giriş bilgilerini kendisine güvenli bir kanaldan iletin.` })
    setForm(null)
    load()
  }

  const update = async (id: string, patch: Partial<Pick<Profile, 'role' | 'is_active'>>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setMsg({ kind: 'error', text: error.message })
    else await supabase.from('audit_log').insert({ action: 'user.update', detail: { target: id, ...patch } })
    load()
  }

  const remove = async (u: Profile) => {
    if (!confirm(`${u.username} kalıcı olarak silinsin mi?`)) return
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'delete', id: u.id } })
    if (error || data?.error) setMsg({ kind: 'error', text: `Silinemedi: ${data?.error ?? error?.message}` })
    load()
  }

  const resetMfa = async (u: Profile) => {
    if (!confirm(`${u.username} için iki adımlı doğrulama kaldırılsın mı? Kullanıcı yalnız parolayla girer, isterse yeniden kurar.`)) return
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'reset-mfa', id: u.id } })
    if (error || data?.error) setMsg({ kind: 'error', text: `Sıfırlanamadı: ${data?.error ?? error?.message}` })
    else setMsg({ kind: 'ok', text: data.removed ? `${u.username} için 2FA kaldırıldı.` : `${u.username} için kayıtlı 2FA yoktu.` })
  }

  const filtered = useMemo(() => users.filter((u) => u.username.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))), [users, q])

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Stat label="Toplam" value={users.length} />
        <Stat label="Aktif" value={users.filter((u) => u.is_active).length} tone="pos" />
        {ROLES.map((r) => (
          <Stat key={r} label={ROLE_LABEL[r]} value={users.filter((u) => u.role === r).length} />
        ))}
      </div>

      {msg && <div className={`notice ${msg.kind}`} style={{ marginBottom: 14 }}>{msg.text}</div>}

      {form && (
        <Section
          icon={UserPlus}
          title="Yeni kullanıcı"
          actions={
            <button className="icon-btn sm" title="Kapat" onClick={() => setForm(null)}>
              <X size={13} />
            </button>
          }
          note="Kayıt ekranı yok: hesapları sadece founder açar. Kullanıcı ilk girişten sonra parolasını değiştirebilir."
        >
          <form onSubmit={create}>
            <div className="setting-grid">
              <SettingRow title="E-posta">
                <input className="input-sm" style={{ width: 220 }} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
              </SettingRow>
              <SettingRow title="Kullanıcı adı">
                <input className="input-sm" style={{ width: 220 }} required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </SettingRow>
              <SettingRow title="Geçici parola" desc="En az 10 karakter">
                <input
                  className="input-sm"
                  style={{ width: 220 }}
                  type="password"
                  required
                  minLength={10}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </SettingRow>
              <SettingRow title="Rol" desc={ROLE_DESC[form.role]}>
                <select className="input-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </SettingRow>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>
                Vazgeç
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy}>
                {busy ? 'Oluşturuluyor…' : 'Oluştur'}
              </button>
            </div>
          </form>
        </Section>
      )}

      <Section
        icon={UsersIcon}
        title="Ekip"
        count={users.length}
        actions={
          <>
            <label className="search sm" style={{ width: 180 }}>
              <Search size={12} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara" />
            </label>
            {!form && (
              <button className="btn btn-sm btn-primary" onClick={() => setForm({ email: '', username: '', password: '', role: 'assistant' })}>
                <UserPlus size={13} /> Kullanıcı ekle
              </button>
            )}
          </>
        }
      >
        <div className="list">
          {filtered.map((u) => {
            const self = u.id === me?.id
            return (
              <div key={u.id} className={`list-row ${u.is_active ? '' : 'dim'}`}>
                <Avatar profile={u} size={28} />
                <div className="list-row-main">
                  <span className="list-row-title">
                    {u.display_name || u.username} {u.display_name && <span className="faint" style={{ fontWeight: 400 }}>@{u.username}</span>} {self && <span className="faint" style={{ fontWeight: 400 }}>(siz)</span>}
                  </span>
                  <span className="list-row-sub">
                    {u.status_text ? `${u.status_text} · ` : ''}
                    {ROLE_DESC[u.role]} · {new Date(u.created_at).toLocaleDateString('tr-TR')}
                  </span>
                </div>
                <select className="input-sm" value={u.role} disabled={self} onChange={(e) => update(u.id, { role: e.target.value as Role })} title="Rol">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button
                  className="muted-pill"
                  disabled={self}
                  title={self ? 'Kendi hesabınızı pasifleştiremezsiniz' : u.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                  onClick={() => update(u.id, { is_active: !u.is_active })}
                  style={{ padding: 0, background: 'none' }}
                >
                  <StatusPill tone={u.is_active ? 'on' : 'off'}>{u.is_active ? 'Aktif' : 'Pasif'}</StatusPill>
                </button>
                <button className="icon-btn" title="İki adımlı doğrulamayı sıfırla (telefonunu kaybeden üye için)" disabled={self} onClick={() => resetMfa(u)}>
                  <KeyRound size={13} />
                </button>
                <button className="icon-btn danger" title="Kalıcı olarak sil" disabled={self} onClick={() => remove(u)}>
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
