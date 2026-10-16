import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import type { Profile, Role } from '../../../shared/types'

const ROLES: Role[] = ['founder', 'developer', 'assistant']

export function UsersPage() {
  const { profile: me } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({ email: '', username: '', password: '', role: 'assistant' as Role })
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'create', ...form } })
    setBusy(false)
    if (error || data?.error) {
      setMsg({ kind: 'error', text: `Oluşturulamadı: ${data?.error ?? error?.message}` })
      return
    }
    setMsg({ kind: 'ok', text: `${form.username} oluşturuldu. Giriş bilgilerini kendisine güvenli bir kanaldan iletin.` })
    setForm({ email: '', username: '', password: '', role: 'assistant' })
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

  return (
    <div className="stack">
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Kullanıcı</th>
              <th>Rol</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id}>
                  <td>
                    {u.username} {self && <span className="faint">(siz)</span>}
                  </td>
                  <td>
                    <select value={u.role} disabled={self} onChange={(e) => update(u.id, { role: e.target.value as Role })}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? 'pass' : ''}`}>{u.is_active ? 'Aktif' : 'Pasif'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!self && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={() => update(u.id, { is_active: !u.is_active })}>
                          {u.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>
                          Sil
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <form className="card stack" onSubmit={create} style={{ maxWidth: 720 }}>
        <h2>Yeni kullanıcı</h2>
        <div className="grid-2">
          <label>
            E-posta
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Kullanıcı adı
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Geçici parola (en az 10 karakter)
            <input
              type="password"
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label>
            Rol
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Oluşturuluyor…' : 'Oluştur'}
          </button>
        </div>
      </form>
    </div>
  )
}
