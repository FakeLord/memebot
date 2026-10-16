import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { evaluateSafety, summarizeToken, withDefaults, type SafetyThresholds } from '../../../shared/safety'
import type { ConditionOrder } from '../../../shared/types'

// Karar motoru: yeni sinyal → GMGN güvenlik kontrolü → kullanıcının kuralına göre onay adayı.
// Onaylanan aday emir motorunda (lib/orders) alıma dönüşür.

export type TradeMode = 'watch' | 'manual' | 'auto'

export interface RuleLimits {
  allowWarn: boolean // UYARI alanları da onaya düşsün mü
  approvalTtlMin: number // onay bekleme süresi
  buyPresetsSol: number[]
  maxBuySol: number
  // --- işlem (Faz 4)
  liveTrading: boolean // false = deneme modu: sadece GMGN teklifi alınır, para harcanmaz
  slippage: number | 'auto'
  priorityFeeSol: number
  tipFeeSol: number
  antiMev: boolean
  dailyMaxSol: number // gün içinde harcanabilecek toplam SOL (deneme ve gerçek ayrı sayılır)
  maxOpenPositions: number
  // --- otomatik mod (Faz 5)
  autoBuySol: number // otomatik alım tutarı
  dailyLossLimitSol: number // bugünkü gerçekleşen zarar bunu aşarsa otomatik mod kendini kapatır
}

export interface Rule {
  mode: TradeMode
  thresholds: SafetyThresholds
  limits: RuleLimits
  tpSl: ConditionOrder[] // alımla birlikte GMGN'de kurulan TP/SL
}

export const DEFAULT_LIMITS: RuleLimits = {
  allowWarn: false,
  approvalTtlMin: 10,
  buyPresetsSol: [0.1, 0.25, 0.5],
  maxBuySol: 1,
  liveTrading: false,
  slippage: 30,
  priorityFeeSol: 0.0005,
  tipFeeSol: 0.001,
  antiMev: true,
  dailyMaxSol: 2,
  maxOpenPositions: 5,
  autoBuySol: 0.05,
  dailyLossLimitSol: 0.5
}

export const DEFAULT_TPSL: ConditionOrder[] = [
  { order_type: 'profit_stop', side: 'sell', price_scale: '100', sell_ratio: '50' },
  { order_type: 'loss_stop', side: 'sell', price_scale: '40', sell_ratio: '100' }
]

export const DEFAULT_RULE: Rule = { mode: 'manual', thresholds: withDefaults(null), limits: DEFAULT_LIMITS, tpSl: DEFAULT_TPSL }

const CACHE_MS = 3 * 60_000

export type PipelineState = 'idle' | 'no_key' | 'working'

interface PipelineCtx {
  rule: Rule
  saveRule: (r: Rule) => Promise<string | null>
  state: PipelineState
  lastError: string | null
  pendingCount: number
  processMint: (mint: string, signalId?: string) => Promise<void>
}

const Ctx = createContext<PipelineCtx | null>(null)

type Raw = { info: unknown; security: unknown }

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [rule, setRule] = useState<Rule>(DEFAULT_RULE)
  const [state, setState] = useState<PipelineState>('idle')
  const [lastError, setLastError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const ruleRef = useRef(rule)
  ruleRef.current = rule
  const inFlight = useRef(new Set<string>())

  // --- kural
  useEffect(() => {
    if (!profile) return
    supabase
      .from('rules')
      .select('mode, thresholds, limits, tp_sl_template')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setRule({
          mode: data.mode as TradeMode,
          thresholds: withDefaults(data.thresholds as Partial<SafetyThresholds>),
          limits: { ...DEFAULT_LIMITS, ...((data.limits as Partial<RuleLimits>) ?? {}) },
          tpSl: Array.isArray(data.tp_sl_template) && data.tp_sl_template.length ? (data.tp_sl_template as ConditionOrder[]) : DEFAULT_TPSL
        })
      })
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
  const refreshPending = useCallback(async () => {
    if (!profile) return
    const { count } = await supabase
      .from('candidates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('status', 'pending')
    setPendingCount(count ?? 0)
  }, [profile?.id])

  // --- bir mint için güvenlik + karar
  const processMint = useCallback(
    async (mint: string, signalId?: string) => {
      if (!profile || inFlight.current.has(mint)) return
      inFlight.current.add(mint)
      setState('working')
      try {
        // 1) Son 3 dk içinde (herhangi bir kullanıcı tarafından) kontrol edildiyse GMGN'e tekrar gitme
        const since = new Date(Date.now() - CACHE_MS).toISOString()
        const { data: cached } = await supabase
          .from('safety_checks')
          .select('id, raw')
          .eq('mint', mint)
          .gte('checked_at', since)
          .order('checked_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        let checkId: string | undefined = cached?.id
        let raw = cached?.raw as Raw | undefined
        const t = ruleRef.current.thresholds

        if (!raw) {
          if (!(await window.api.gmgn.hasCredentials(profile.id))) {
            setState('no_key')
            return
          }
          const [info, security] = await Promise.all([
            window.api.gmgn.tokenInfo(profile.id, mint),
            window.api.gmgn.tokenSecurity(profile.id, mint)
          ])
          if (!info.ok || !security.ok) {
            setLastError(`GMGN: ${(!info.ok && info.error) || (!security.ok && security.error)}`)
            return
          }
          raw = { info: info.data, security: security.data }
          const report = evaluateSafety(raw.security, raw.info, t)
          const { data: inserted } = await supabase
            .from('safety_checks')
            .insert({ mint, result: report.result, reasons: report.items.filter((i) => i.verdict !== 'pass'), raw })
            .select('id')
            .single()
          checkId = inserted?.id
        }

        // 2) Kullanıcının kendi eşikleriyle karar
        const report = evaluateSafety(raw.security, raw.info, t)
        const r = ruleRef.current
        if (r.mode === 'watch') return
        if (report.result === 'fail') return
        if (report.result === 'warn' && !r.limits.allowWarn) return

        // 3) Onay adayı (aynı token için tek bekleyen aday — tekrar eklenirse yok sayılır)
        const { error } = await supabase.from('candidates').insert({
          user_id: profile.id,
          mint,
          signal_id: signalId ?? null,
          safety_check_id: checkId ?? null,
          verdict: report.result,
          reasons: report.items.filter((i) => i.verdict !== 'pass'),
          summary: summarizeToken(raw.info),
          expires_at: new Date(Date.now() + r.limits.approvalTtlMin * 60_000).toISOString()
        })
        if (error && error.code !== '23505') setLastError(error.message)
        else setLastError(null)
        refreshPending()
      } finally {
        inFlight.current.delete(mint)
        if (inFlight.current.size === 0) setState((s) => (s === 'working' ? 'idle' : s))
      }
    },
    [profile?.id, refreshPending]
  )

  // --- canlı: yeni sinyaller ve adaylar
  useEffect(() => {
    if (!profile) return
    refreshPending()
    const ch = supabase
      .channel('pipeline')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `user_id=eq.${profile.id}` }, (p) => {
        const row = p.new as { id: string; mint: string }
        processMint(row.mint, row.id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candidates', filter: `user_id=eq.${profile.id}` }, refreshPending)
      .subscribe()
    // Süresi dolan adayları kapat
    const timer = setInterval(async () => {
      const { data } = await supabase.rpc('expire_candidates')
      if (data) refreshPending()
    }, 30_000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(timer)
    }
  }, [profile?.id, processMint, refreshPending])

  return <Ctx.Provider value={{ rule, saveRule, state, lastError, pendingCount, processMint }}>{children}</Ctx.Provider>
}

export function usePipeline(): PipelineCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePipeline PipelineProvider dışında kullanıldı')
  return c
}
