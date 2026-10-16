// Supabase Edge Function — kullanıcı yönetimi (sadece founder)
// service_role anahtarı yalnızca burada, Supabase sunucusunda kullanılır; uygulamaya gömülmez.
// Dağıtım: npx supabase functions deploy manage-users
import { createClient } from 'npm:@supabase/supabase-js@2'

const ROLES = ['founder', 'developer', 'assistant'] as const

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: role, error: roleErr } = await caller.rpc('my_role')
  if (roleErr || role !== 'founder') return json({ error: 'forbidden' }, 403)

  const { data: me } = await caller.auth.getUser()
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({}))

  switch (body.action) {
    case 'create': {
      const { email, password, username, role: newRole } = body
      if (!email || !password || password.length < 10 || !username || !ROLES.includes(newRole)) {
        return json({ error: 'invalid_input' }, 400)
      }
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username }
      })
      if (error) return json({ error: error.message }, 400)
      const { error: upErr } = await admin
        .from('profiles')
        .update({ role: newRole, is_active: true })
        .eq('id', data.user.id)
      if (upErr) return json({ error: upErr.message }, 400)
      await admin.from('audit_log').insert({
        user_id: me.user?.id,
        action: 'user.create',
        detail: { target: data.user.id, username, role: newRole }
      })
      return json({ id: data.user.id })
    }
    case 'delete': {
      if (!body.id || body.id === me.user?.id) return json({ error: 'invalid_input' }, 400)
      const { error } = await admin.auth.admin.deleteUser(body.id)
      if (error) return json({ error: error.message }, 400)
      await admin.from('audit_log').insert({ user_id: me.user?.id, action: 'user.delete', detail: { target: body.id } })
      return json({ ok: true })
    }
    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
