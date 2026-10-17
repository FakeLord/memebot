import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { useEngine } from './engine'
import { usePipeline } from './pipeline'
import type { DCandidate, DOrder, DPosition, DSignal, DSource, Mode } from '../../../shared/dashboard'
import { startOfDay } from '../../../shared/dashboard'
import type { DashGmgn } from '../../../shared/engine'

// Dashboard veri katmanı: pozisyonlar, emirler, sinyaller, adaylar, kaynaklar + motorun GMGN verisi.
// Kayıtlar değişince (gerçek zamanlı) ve 30 sn'de bir tazelenir. PostgREST 1000 satır sınırı için sayfalanır.

export interface PendingCandidate {
  id: string
  mint: string
  verdict: string
  summary: { symbol?: string; name?: string; mcapUsd?: number } | null
  created_at: string
  expires_at: string
}

export interface DashData {
  positions: DPosition[]
  orders: DOrder[]
  signals: DSignal[]
  candidates: DCandidate[]
  sources: DSource[]
  pending: PendingCandidate[]
  recentSignals: { id: string; mint: string; received_at: string; source_id: string | null }[]
  loaded: boolean
  error: string | null
  reload: () => void
}

const DAY = 86_400_000
const POS_COLS = 'id, mint, symbol, status, is_dry_run, cost_sol, proceeds_sol, amount_raw, amount_initial_raw, entry_price, last_price_usd, opened_at, closed_at, close_reason'

// Sayfalayarak hepsini oku (en çok `max` satır)
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, max = 5000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data as T[]) ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export function useDashboardData(): DashData {
  const { profile } = useAuth()
  const [state, setState] = useState<Omit<DashData, 'reload'>>({
    positions: [], orders: [], signals: [], candidates: [], sources: [], pending: [], recentSignals: [], loaded: false, error: null
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    if (!profile) return
    const uid = profile.id
    const since90 = new Date(Date.now() - 90 * DAY).toISOString()
    const since30 = new Date(Date.now() - 30 * DAY).toISOString()
    const today = new Date(startOfDay(new Date())).toISOString()
    try {
      const [open, closed, orders, signals, candidates, sources, pending, recent] = await Promise.all([
        fetchAll<DPosition>((a, b) => supabase.from('positions').select(POS_COLS).eq('user_id', uid).eq('status', 'open').order('opened_at', { ascending: false }).range(a, b)),
        fetchAll<DPosition>((a, b) => supabase.from('positions').select(POS_COLS).eq('user_id', uid).eq('status', 'closed').gte('closed_at', since90).order('closed_at', { ascending: false }).range(a, b)),
        fetchAll<DOrder>((a, b) => supabase.from('orders').select('side, status, is_dry_run, created_at, amount_in').eq('user_id', uid).gte('created_at', since90).order('created_at', { ascending: false }).range(a, b)),
        fetchAll<DSignal>((a, b) => supabase.from('signals').select('mint, source_id, received_at').eq('user_id', uid).gte('received_at', since90).order('received_at', { ascending: false }).range(a, b), 10_000),
        fetchAll<DCandidate>((a, b) => supabase.from('candidates').select('status, created_at').eq('user_id', uid).gte('created_at', today).order('created_at', { ascending: false }).range(a, b)),
        supabase.from('sources').select('id, title, type').eq('user_id', uid),
        supabase.from('candidates').select('id, mint, verdict, summary, created_at, expires_at').eq('user_id', uid).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(8),
        supabase.from('signals').select('id, mint, received_at, source_id').eq('user_id', uid).gte('received_at', since30).order('received_at', { ascending: false }).limit(8)
      ])
      if (!alive.current) return
      setState({
        positions: [...open, ...closed],
        orders,
        signals,
        candidates,
        sources: (sources.data as DSource[]) ?? [],
        pending: (pending.data as PendingCandidate[]) ?? [],
        recentSignals: (recent.data as DashData['recentSignals']) ?? [],
        loaded: true,
        error: null
      })
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loaded: true, error: (e as Error).message }))
    }
  }, [profile?.id])

  // Birden çok olay art arda gelirse tek tazeleme
  const soon = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      void load()
    }, 800)
  }, [load])

  useEffect(() => {
    alive.current = true
    if (!profile) return
    void load()
    const t = setInterval(() => void load(), 30_000)
    const ch = supabase.channel(`dashboard-${profile.id}`)
    for (const table of ['positions', 'orders', 'candidates', 'signals']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${profile.id}` }, soon)
    }
    ch.subscribe()
    return () => {
      alive.current = false
      clearInterval(t)
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      supabase.removeChannel(ch)
    }
  }, [profile?.id, load, soon])

  return { ...state, reload: load }
}

const MODE_KEY = 'memebot.dashMode'

/** Gerçek / Deneme / Tümü seçimi; ilk açılışta kuraldaki işlem moduna göre, sonra hatırlanır. */
export function useDashMode(): [Mode, (m: Mode) => void] {
  const { rule } = usePipeline()
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY)
      if (v === 'live' || v === 'dry' || v === 'all') return v
    } catch {
      /* depolama kapalı olabilir */
    }
    return rule.limits.liveTrading ? 'live' : 'dry'
  })
  const set = useCallback((m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* depolama kapalı olabilir */
    }
  }, [])
  return [mode, set]
}

/** Motorun topladığı GMGN verisi (yoksa null; at=0 ise henüz veri gelmemiştir); anahtar yoksa eski veri gösterilmez. */
export function useGmgnDash(): { dash: DashGmgn | null; configured: boolean } {
  const { me } = useEngine()
  const configured = me?.gmgn.configured === true
  const dash = useMemo(() => (configured && me?.gmgn.dash ? (me.gmgn.dash as DashGmgn) : null), [configured, me?.gmgn.dash])
  return { dash, configured }
}
