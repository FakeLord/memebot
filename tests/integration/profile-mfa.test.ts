import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { localSupabase, makeUser, service } from './helpers'

// Profil özelleştirme RPC'si ve 2FA zorunluluğu (yerel Supabase gerekir; yoksa atlanır).

const env = localSupabase()
const d = env ? describe : describe.skip

function base32(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0')
  const out: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}

// RFC 6238, 30 sn, 6 hane
function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const h = createHmac('sha1', base32(secret)).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(n).padStart(6, '0')
}

d('profil ve 2FA', () => {
  const e = env!
  const tag = `pm${Date.now() % 1_000_000}`

  it('update_my_profile yalnız görünüm alanlarını değiştirir, rolü değiştiremez', async () => {
    const u = await makeUser(e, 'assistant', `${tag}a`)
    const { error } = await u.client.rpc('update_my_profile', { p_display_name: ' Meme Usta ', p_avatar_emoji: '🐸', p_avatar_color: '#22c55e', p_status_text: 'nöbetteyim' })
    expect(error).toBeNull()
    const { data } = await u.client.from('profiles').select('display_name, avatar_emoji, avatar_color, status_text, role').eq('id', u.id).single()
    expect(data).toMatchObject({ display_name: 'Meme Usta', avatar_emoji: '🐸', avatar_color: '#22c55e', status_text: 'nöbetteyim', role: 'assistant' })

    // Doğrudan güncelleme (rol yükseltme) hâlâ engelli: RLS yalnız founder'a izin verir
    await u.client.from('profiles').update({ role: 'founder' }).eq('id', u.id)
    const { data: after } = await service(e).from('profiles').select('role').eq('id', u.id).single()
    expect(after?.role).toBe('assistant')

    // Geçersiz renk reddedilir
    const bad = await u.client.rpc('update_my_profile', { p_display_name: 'x', p_avatar_emoji: '', p_avatar_color: 'kırmızı', p_status_text: '' })
    expect(bad.error).not.toBeNull()
  })

  it('2FA açıkken kodsuz oturum yetkisiz, kodla doğrulanan oturum yetkili', async () => {
    const u = await makeUser(e, 'founder', `${tag}b`)
    const email = `founder-${tag}b@test.local`
    const password = `Test-${tag}b-founder-123456`

    // 2FA öncesi yetkili
    expect((await u.client.rpc('my_role')).data).toBe('founder')

    const enroll = await u.client.auth.mfa.enroll({ factorType: 'totp' })
    expect(enroll.error).toBeNull()
    const factorId = enroll.data!.id
    const secret = enroll.data!.totp.secret
    const ver = await u.client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) })
    expect(ver.error).toBeNull()
    expect((await u.client.rpc('my_role')).data).toBe('founder') // aal2 oturum

    // Yeni giriş: parola doğru ama ikinci adım yok → aal1
    const c2 = createClient(e.url, e.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await c2.auth.signInWithPassword({ email, password })).error).toBeNull()
    const aal = await c2.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(aal.data).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal2' })
    expect((await c2.rpc('my_role')).data).toBeNull()
    const src = await c2.from('sources').select('id').limit(1)
    expect(src.data ?? []).toHaveLength(0)

    // Kod girilince yetki gelir
    const factors = await c2.auth.mfa.listFactors()
    const v2 = await c2.auth.mfa.challengeAndVerify({ factorId: factors.data!.totp[0].id, code: totp(secret, Date.now() + 30_000) })
    expect(v2.error).toBeNull()
    expect((await c2.rpc('my_role')).data).toBe('founder')

    // Kapatınca kodsuz giriş yine yetkili
    expect((await c2.auth.mfa.unenroll({ factorId })).error).toBeNull()
    const c3 = createClient(e.url, e.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    await c3.auth.signInWithPassword({ email, password })
    expect((await c3.rpc('my_role')).data).toBe('founder')
  })
})
