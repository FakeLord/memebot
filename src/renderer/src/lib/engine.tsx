import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { runCommand, runSealed } from '../../../shared/engineClient'
import { engineOnline, type CommandInput, type CommandKind, type CommandOutput, type EngineStatusRow, type EngineUserState } from '../../../shared/engine'

// Motorla bağlantı: motorun genel durumu (çevrimiçi mi, sürüm, GMGN gecikmesi) ve giriş yapan
// kullanıcının motor durumu (GMGN anahtarı, Telegram, X, karar motoru) gerçek zamanlı izlenir.

interface EngineCtx {
  status: EngineStatusRow | null
  online: boolean
  me: EngineUserState | null
  run: <K extends CommandKind>(kind: K, payload: CommandInput<K>, timeoutMs?: number) => Promise<CommandOutput<K>>
  runSealed: <K extends CommandKind>(kind: K, value: unknown, timeoutMs?: number) => Promise<CommandOutput<K>>
}

const Ctx = createContext<EngineCtx | null>(null)

export function EngineProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [status, setStatus] = useState<EngineStatusRow | null>(null)
  const [me, setMe] = useState<EngineUserState | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!profile) return
    const loadStatus = () =>
      supabase
        .from('engine_status')
        .select('id, instance_id, version, host, started_at, heartbeat_at, public_key, gmgn_latency_ms')
        .eq('id', 'main')
        .maybeSingle()
        .then(({ data }) => setStatus((data as EngineStatusRow) ?? null))
    const loadMe = () =>
      supabase
        .from('engine_user_state')
        .select('*')
        .eq('user_id', profile.id)
        .maybeSingle()
        .then(({ data }) => setMe((data as EngineUserState) ?? null))
    loadStatus()
    loadMe()
    const ch = supabase
      .channel('engine-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engine_status' }, (p) => {
        if (p.new && (p.new as EngineStatusRow).id) setStatus(p.new as EngineStatusRow)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engine_user_state', filter: `user_id=eq.${profile.id}` }, (p) => {
        if (p.new && (p.new as EngineUserState).user_id) setMe(p.new as EngineUserState)
      })
      .subscribe()
    // Gerçek zamanlı kanal kopsa bile durum 15 sn'de bir tazelenir; "çevrimiçi" hesabı için saat
    const t = setInterval(() => {
      setNow(Date.now())
      loadStatus()
    }, 15_000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(t)
    }
  }, [profile?.id])

  const run = useCallback<EngineCtx['run']>(
    (kind, payload, timeoutMs) => runCommand(supabase, profile!.id, kind, payload, timeoutMs),
    [profile?.id]
  )
  const sealed = useCallback<EngineCtx['runSealed']>(
    (kind, value, timeoutMs) => runSealed(supabase, profile!.id, kind, value, timeoutMs),
    [profile?.id]
  )

  return (
    <Ctx.Provider value={{ status, online: engineOnline(status, now), me, run, runSealed: sealed }}>{children}</Ctx.Provider>
  )
}

export function useEngine(): EngineCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useEngine EngineProvider dışında kullanıldı')
  return c
}

/** Hata mesajını kullanıcıya gösterilecek metne çevirir. */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
