import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { useEngine } from './engine'
import { DEFAULT_RULE, ruleFromRow, type Rule, type RuleRow } from '../../../shared/rules'

export { DEFAULT_RULE, DEFAULT_LIMITS, DEFAULT_TPSL } from '../../../shared/rules'
export type { Rule, RuleLimits, TradeMode } from '../../../shared/rules'

// Kullanıcının kuralı (mod, eşikler, limitler, TP/SL) ve bekleyen aday sayısı.
// Sinyalleri işleyen karar motoru artık motorda (src/engine/pipeline.ts); burada sadece durumu gösterilir.

export type PipelineState = 'idle' | 'no_key' | 'working'

interface PipelineCtx {
  rule: Rule
  saveRule: (r: Rule) => Promise<string | null>
  state: PipelineState
  lastError: string | null
  pendingCount: number
}

const Ctx = createContext<PipelineCtx | null>(null)

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { me } = useEngine()
  const [rule, setRule] = useState<Rule>(DEFAULT_RULE)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!profile) return
    const load = () =>
      supabase
        .from('rules')
        .select('mode, thresholds, limits, tp_sl_template')
        .eq('user_id', profile.id)
        .maybeSingle()
        .then(({ data }) => data && setRule(ruleFromRow(data as RuleRow)))
    load()
    // Motor otomatik modu kapatabilir (günlük zarar sınırı): kural değişikliği canlı izlenir
    const ch = supabase
      .channel('rule')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rules', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  const saveRule = useCallback(
    async (r: Rule) => {
      if (!profile) return 'Oturum yok'
      const { error } = await supabase
        .from('rules')
        .upsert(
          {
            user_id: profile.id,
            mode: r.mode,
            thresholds: r.thresholds,
            limits: r.limits,
            tp_sl_template: r.tpSl,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        )
      if (error) return error.message
      setRule(r)
      await supabase.from('audit_log').insert({ action: 'rule.update', detail: { mode: r.mode, live: r.limits.liveTrading } })
      return null
    },
    [profile?.id]
  )

  // --- bekleyen aday sayısı (menü rozeti)
  useEffect(() => {
    if (!profile) return
    const refresh = async () => {
      const { count } = await supabase
        .from('candidates')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
      setPendingCount(count ?? 0)
    }
    refresh()
    const ch = supabase
      .channel('pending-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candidates', filter: `user_id=eq.${profile.id}` }, refresh)
      .subscribe()
    const t = setInterval(refresh, 30_000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(t)
    }
  }, [profile?.id])

  const p = me?.pipeline ?? {}
  return (
    <Ctx.Provider value={{ rule, saveRule, state: p.state ?? 'idle', lastError: p.lastError ?? null, pendingCount }}>{children}</Ctx.Provider>
  )
}

export function usePipeline(): PipelineCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePipeline PipelineProvider dışında kullanıldı')
  return c
}
