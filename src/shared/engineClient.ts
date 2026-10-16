import type { SupabaseClient } from '@supabase/supabase-js'
import { sealAad, sealJson, type Sealed } from './seal'
import { SEAL_PURPOSE, type CommandInput, type CommandKind, type CommandOutput } from './engine'

// Arayüzün motora komut gönderme yolu: engine_commands'a "pending" satır yaz, sonucu bekle.
// Hem arayüz hem entegrasyon testleri bu kodu kullanır.

export class EngineError extends Error {}

/** Motorun açık anahtarıyla mühürler (zarf sadece bu kullanıcı + komut türünde açılır). */
export async function sealFor(db: SupabaseClient, userId: string, kind: CommandKind, value: unknown): Promise<Sealed> {
  const { data, error } = await db.from('engine_status').select('public_key, heartbeat_at').eq('id', 'main').maybeSingle()
  if (error || !data?.public_key) throw new EngineError('Motor çalışmıyor: şifreleme anahtarı yok')
  const purpose = SEAL_PURPOSE[kind]
  if (!purpose) throw new EngineError(`${kind} şifreli veri almaz`)
  return sealJson(data.public_key as JsonWebKey, sealAad(userId, purpose), value)
}

export async function runCommand<K extends CommandKind>(
  db: SupabaseClient,
  userId: string,
  kind: K,
  payload: CommandInput<K>,
  timeoutMs = 20_000
): Promise<CommandOutput<K>> {
  const { data: row, error } = await db
    .from('engine_commands')
    .insert({ user_id: userId, kind, payload })
    .select('id')
    .single()
  if (error || !row) throw new EngineError(error?.message ?? 'Komut yazılamadı')

  // Sonucu kısa aralıklarla oku (gerçek zamanlı kanal kurmaktan daha basit ve yeterince hızlı)
  const end = Date.now() + timeoutMs
  let wait = 150
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(1_000, wait * 1.5)
    const { data } = await db.from('engine_commands').select('status, result, error').eq('id', row.id).single()
    if (data?.status === 'done') return data.result as CommandOutput<K>
    if (data?.status === 'failed') throw new EngineError(data.error ?? 'Komut başarısız')
  }
  throw new EngineError('Motor yanıt vermedi (çalışıyor mu? Ayarlar → Motor)')
}

/** Mühürlü girdili komut: değeri şifreleyip gönderir. */
export async function runSealed<K extends CommandKind>(db: SupabaseClient, userId: string, kind: K, value: unknown, timeoutMs?: number) {
  const sealed = await sealFor(db, userId, kind, value)
  return runCommand(db, userId, kind, { sealed } as CommandInput<K>, timeoutMs)
}
