import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { extractMints } from '../../../shared/extract'
import type { XMonitor } from '../../../shared/types'

// X/Twitter kaynağı (XFlux). İzleyiciler XFlux panelinde kurulur; burada:
//  - Aynı kullanıcı birden fazla bilgisayarda açıksa SADECE BİRİ yoklar (engine_leases) → kota iki kat erimez
//  - Yoklama aralığı kalan aylık kotaya göre ayarlanır
//  - Uygulama açılırken eski gönderiler sinyal sayılmaz (ilk yoklama = başlangıç noktası)

const LEASE_TTL_MS = 45_000
const MIN_INTERVAL_MS = 3_000
const DEFAULT_INTERVAL_MS = 15_000
const STALE_MS = 10 * 60_000 // 10 dk'dan eski gönderi sinyal değil
const FRESH_ON_START_MS = 2 * 60_000

export interface XSource {
  id: string
  chat_id: string // XFlux izleyici kimliği
  title: string
  is_active: boolean
}

export type XState = 'no_key' | 'starting' | 'polling' | 'other_machine' | 'error'

interface XCtx {
  state: XState
  error: string | null
  quotaRemaining?: number
  intervalMs: number
  lastPollAt: number | null
  monitors: XMonitor[]
  sources: XSource[]
  reload: () => Promise<void>
}

const Ctx = createContext<XCtx | null>(null)

function machineId(): string {
  try {
    let id = localStorage.getItem('memebot.machineId')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('memebot.machineId', id)
    }
    return id
  } catch {
    return 'unknown-' + Math.random().toString(36).slice(2)
  }
}

// Kalan kotayı ay sonuna kadar eşit yay; çok sık yoklama yapma
function intervalFor(quotaRemaining?: number): number {
  if (quotaRemaining === undefined || !Number.isFinite(quotaRemaining)) return DEFAULT_INTERVAL_MS
  const now = new Date()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  const minutesLeft = Math.max(1, (monthEnd - now.getTime()) / 60_000)
  const perMinute = (quotaRemaining * 0.9) / minutesLeft // %10 pay bırak
  if (perMinute <= 0) return 10 * 60_000
  return Math.min(10 * 60_000, Math.max(MIN_INTERVAL_MS, 60_000 / perMinute))
}

export function XSourceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [state, setState] = useState<XState>('starting')
  const [error, setError] = useState<string | null>(null)
  const [quotaRemaining, setQuota] = useState<number | undefined>()
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS)
  const [lastPollAt, setLastPollAt] = useState<number | null>(null)
  const [monitors, setMonitors] = useState<XMonitor[]>([])
  const [sources, setSources] = useState<XSource[]>([])
  const sourcesRef = useRef<XSource[]>([])
  const seen = useRef(new Set<string>())
  const firstPoll = useRef(true)
  const me = useRef(machineId())
  // setTimeout döngüsü eski state'i görmesin diye ref'ler
  const quotaRef = useRef<number | undefined>(undefined)
  const knowsMonitors = useRef(false)

  const reload = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('sources')
      .select('id, chat_id, title, is_active')
      .eq('user_id', profile.id)
      .eq('type', 'x')
      .order('title')
    const list = (data as XSource[]) ?? []
    sourcesRef.current = list
    setSources(list)
  }, [profile?.id])

  useEffect(() => {
    if (!profile) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    reload()

    const holdLease = async (): Promise<boolean> => {
      const { data } = await supabase.from('engine_leases').select('machine_id, heartbeat_at').eq('user_id', profile.id).maybeSingle()
      const fresh = data && Date.now() - new Date(data.heartbeat_at).getTime() < LEASE_TTL_MS
      if (data && fresh && data.machine_id !== me.current) return false
      await supabase
        .from('engine_leases')
        .upsert({ user_id: profile.id, machine_id: me.current, heartbeat_at: new Date().toISOString() }, { onConflict: 'user_id' })
      return true
    }

    const record = async (m: XMonitor) => {
      const source = sourcesRef.current.find((s) => s.is_active && s.chat_id === m.id)
      for (const h of m.hits) {
        const key = `${m.id}:${h.tweetId}`
        if (seen.current.has(key)) continue
        seen.current.add(key)
        const age = h.createdAt ? Date.now() - h.createdAt : undefined
        // İlk yoklamada zamanı bilinmeyen ya da eski gönderiler başlangıç noktası sayılır
        if (firstPoll.current && (age === undefined || age > FRESH_ON_START_MS)) continue
        if (age !== undefined && age > STALE_MS) continue
        if (!source) continue
        for (const mint of extractMints(h.text).slice(0, 5)) {
          const { error } = await supabase.rpc('record_signal', {
            p_source_id: source.id,
            p_msg_id: h.tweetId, // 19 haneli: JS sayısına çevirmeden metin olarak gönder
            p_mint: mint,
            p_raw_text: h.text,
            p_msg_ts: new Date(h.createdAt ?? Date.now()).toISOString()
          })
          if (error) console.error('record_signal (x)', error.message)
        }
      }
    }

    const tick = async () => {
      let next = intervalFor(quotaRef.current)
      try {
        if (!(await window.api.xflux.hasKey(profile.id))) {
          setState('no_key')
          next = 30_000
          return
        }
        // İzlenen izleyici yoksa kotayı harcama (listeyi bir kez almak yeterli; "İzle" sonrası 30 sn içinde başlar)
        if (!sourcesRef.current.some((s) => s.is_active) && knowsMonitors.current) {
          setState('polling')
          next = 30_000
          return
        }
        if (!(await holdLease())) {
          setState('other_machine')
          next = LEASE_TTL_MS
          return
        }
        const r = await window.api.xflux.poll(profile.id)
        setLastPollAt(Date.now())
        if (!r.ok) {
          setState('error')
          setError(r.error)
          if (r.quotaRemaining !== undefined) {
            quotaRef.current = r.quotaRemaining
            setQuota(r.quotaRemaining)
          }
          next = r.retryAfterSec ? r.retryAfterSec * 1000 : 60_000
          return
        }
        setError(null)
        setState('polling')
        setMonitors(r.monitors)
        knowsMonitors.current = true
        if (r.quotaRemaining !== undefined) {
          quotaRef.current = r.quotaRemaining
          setQuota(r.quotaRemaining)
          next = intervalFor(r.quotaRemaining)
        }
        for (const m of r.monitors) await record(m)
        firstPoll.current = false
      } catch (e) {
        setState('error')
        setError((e as Error).message)
        next = 60_000
      } finally {
        setIntervalMs(next)
        if (!stopped) timer = setTimeout(tick, next)
      }
    }

    tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, reload])

  return (
    <Ctx.Provider value={{ state, error, quotaRemaining, intervalMs, lastPollAt, monitors, sources, reload }}>{children}</Ctx.Provider>
  )
}

export function useXSource(): XCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useXSource XSourceProvider dışında kullanıldı')
  return c
}
