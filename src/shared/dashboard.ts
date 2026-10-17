// Dashboard hesapları (saf fonksiyonlar; arayüz ve testler ortak kullanır).
// Birimler: pozisyon maliyet/gelir SOL; GMGN cüzdan verisi USD (ayrı gösterilir, karıştırılmaz).

export interface DPosition {
  id: string
  mint: string
  symbol: string | null
  status: 'open' | 'closed'
  is_dry_run: boolean
  cost_sol: number | null
  proceeds_sol: number | null
  amount_raw: string | null
  amount_initial_raw: string | null
  entry_price: number | null
  last_price_usd: number | null
  opened_at: string
  closed_at: string | null
  close_reason?: string | null
}

export interface DOrder {
  side: 'buy' | 'sell'
  status: string
  is_dry_run: boolean
  created_at: string
  amount_in: string
}

export interface DSignal {
  mint: string
  source_id: string | null
  received_at: string
  /** Telegram grubunda mesajı yazan kişi (kanal/X/elle sinyalde yok) */
  sender_id?: string | null
}

export interface DCandidate {
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  created_at: string
}

export interface DSource {
  id: string
  title: string
  type: string
}

export type Mode = 'live' | 'dry' | 'all'

const LAMPORTS = 1e9

export const inMode = (mode: Mode, dry: boolean) => mode === 'all' || (mode === 'dry' ? dry : !dry)

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Elde kalan miktarın tahmini SOL değeri: kalan oran × maliyet × (güncel fiyat / giriş fiyatı). Fiyat yoksa undefined. */
export function heldValueSol(p: DPosition): number | undefined {
  const price = p.last_price_usd
  if (price == null || !p.entry_price || !p.cost_sol) return undefined
  const cur = p.amount_raw && /^\d+$/.test(p.amount_raw) ? Number(p.amount_raw) : undefined
  const init = p.amount_initial_raw && /^\d+$/.test(p.amount_initial_raw) ? Number(p.amount_initial_raw) : cur
  const frac = cur !== undefined && init ? cur / init : 1
  return n(p.cost_sol) * frac * (Number(price) / Number(p.entry_price))
}

/** Pozisyonun kâr/zararı (SOL): kapalıysa gelen − maliyet; açıksa kalan değer + gelen − maliyet (fiyat yoksa null). */
export function positionPnl(p: DPosition): number | null {
  const cost = n(p.cost_sol)
  if (p.status === 'closed') return n(p.proceeds_sol) - cost
  const held = heldValueSol(p)
  return held === undefined ? null : held + n(p.proceeds_sol) - cost
}

// ---------------------------------------------------------------- günler (yerel saat)
export const dayKey = (d: Date | string | number) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export const startOfDay = (now: Date, back = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime()

export interface PnlSummary {
  /** bugün kapanan pozisyonların kâr/zararı */
  today: number
  /** son 7 / 30 gün kapananlar (bugün dahil) */
  d7: number
  d30: number
  /** tüm kapananlar */
  allClosed: number
  /** açık pozisyonların tahmini kâr/zararı; fiyatı bilinmeyen sayısı ayrı */
  openUnrealized: number
  openUnknown: number
  openCount: number
  openCost: number
  closedCount: number
  wins: number
  losses: number
  winrate: number | null // 0–1; kapanan işlem yoksa null
  avgWin: number | null
  avgLoss: number | null // negatif
  bestPnl: number | null
  worstPnl: number | null
}

export function summarize(positions: DPosition[], mode: Mode, now = new Date()): PnlSummary {
  const t0 = startOfDay(now)
  const t7 = startOfDay(now, 6)
  const t30 = startOfDay(now, 29)
  const s: PnlSummary = {
    today: 0, d7: 0, d30: 0, allClosed: 0, openUnrealized: 0, openUnknown: 0, openCount: 0, openCost: 0,
    closedCount: 0, wins: 0, losses: 0, winrate: null, avgWin: null, avgLoss: null, bestPnl: null, worstPnl: null
  }
  let winSum = 0
  let lossSum = 0
  for (const p of positions) {
    if (!inMode(mode, p.is_dry_run)) continue
    if (p.status === 'open') {
      s.openCount++
      s.openCost += n(p.cost_sol)
      const pnl = positionPnl(p)
      if (pnl === null) s.openUnknown++
      else s.openUnrealized += pnl
      continue
    }
    const pnl = positionPnl(p) as number
    const at = p.closed_at ? new Date(p.closed_at).getTime() : 0
    s.allClosed += pnl
    s.closedCount++
    if (at >= t0) s.today += pnl
    if (at >= t7) s.d7 += pnl
    if (at >= t30) s.d30 += pnl
    if (pnl > 0) {
      s.wins++
      winSum += pnl
    } else if (pnl < 0) {
      s.losses++
      lossSum += pnl
    }
    s.bestPnl = s.bestPnl === null ? pnl : Math.max(s.bestPnl, pnl)
    s.worstPnl = s.worstPnl === null ? pnl : Math.min(s.worstPnl, pnl)
  }
  const decided = s.wins + s.losses
  s.winrate = decided ? s.wins / decided : null
  s.avgWin = s.wins ? winSum / s.wins : null
  s.avgLoss = s.losses ? lossSum / s.losses : null
  return s
}

export interface DayPoint {
  day: string // YYYY-AA-GG
  pnl: number // o gün kapananların toplamı
  cum: number // dönem başından birikimli
  trades: number
}

/** Son `days` gün için günlük kapanan kâr/zarar ve birikimli eğri (boş günler 0). */
export function dailySeries(positions: DPosition[], mode: Mode, days: number, now = new Date()): DayPoint[] {
  const out: DayPoint[] = []
  const idx = new Map<string, DayPoint>()
  for (let i = days - 1; i >= 0; i--) {
    const pt: DayPoint = { day: dayKey(startOfDay(now, i)), pnl: 0, cum: 0, trades: 0 }
    out.push(pt)
    idx.set(pt.day, pt)
  }
  for (const p of positions) {
    if (p.status !== 'closed' || !p.closed_at || !inMode(mode, p.is_dry_run)) continue
    const pt = idx.get(dayKey(p.closed_at))
    if (!pt) continue
    pt.pnl += positionPnl(p) as number
    pt.trades++
  }
  let cum = 0
  for (const pt of out) {
    cum += pt.pnl
    pt.cum = cum
  }
  return out
}

export interface Funnel {
  signals: number
  candidates: number
  approved: number
  rejected: number
  expired: number
  bought: number
}

export function funnel(signals: DSignal[], candidates: DCandidate[], orders: DOrder[], mode: Mode, now = new Date(), back = 0): Funnel {
  const t0 = startOfDay(now, back)
  const today = (iso: string) => new Date(iso).getTime() >= t0
  const f: Funnel = { signals: 0, candidates: 0, approved: 0, rejected: 0, expired: 0, bought: 0 }
  for (const s of signals) if (today(s.received_at)) f.signals++
  for (const c of candidates) {
    if (!today(c.created_at)) continue
    f.candidates++
    if (c.status === 'approved') f.approved++
    else if (c.status === 'rejected') f.rejected++
    else if (c.status === 'expired') f.expired++
  }
  for (const o of orders) if (o.side === 'buy' && o.status === 'confirmed' && inMode(mode, o.is_dry_run) && today(o.created_at)) f.bought++
  return f
}

/** Bugün harcanan SOL (başarısız olmayan alım emirleri). */
export function spentToday(orders: DOrder[], mode: Mode, now = new Date()): number {
  const t0 = startOfDay(now)
  let sum = 0
  for (const o of orders) {
    if (o.side !== 'buy' || o.status === 'failed' || o.status === 'expired' || !inMode(mode, o.is_dry_run)) continue
    if (new Date(o.created_at).getTime() >= t0) sum += n(o.amount_in) / LAMPORTS
  }
  return sum
}

// ---------------------------------------------------------------- kaynak performansı
export interface SourceRow {
  sourceId: string | null
  title: string
  type: string
  signals: number // dönemde gelen sinyal
  trades: number // bu kaynaktan açılan pozisyon
  closed: number
  wins: number
  winrate: number | null
  pnl: number // kapananlar + fiyatı bilinen açıklar
  cost: number
  roi: number | null // pnl / cost
}

/**
 * Pozisyon → kaynak: pozisyonun token'ı için, pozisyon açılmadan önce gelen en son sinyalin kaynağı;
 * öncesinde sinyal yoksa en erken sinyal. Hiç sinyal yoksa (elle alım) "Elle / bilinmeyen".
 */
export function sourcePerformance(positions: DPosition[], signals: DSignal[], sources: DSource[], mode: Mode, sinceMs: number): SourceRow[] {
  const byMint = new Map<string, DSignal[]>()
  for (const s of signals) byMint.set(s.mint, [...(byMint.get(s.mint) ?? []), s])
  for (const list of byMint.values()) list.sort((a, b) => a.received_at.localeCompare(b.received_at))
  const meta = new Map(sources.map((s) => [s.id, s]))
  const rows = new Map<string | null, SourceRow>()
  const row = (id: string | null): SourceRow => {
    let r = rows.get(id)
    if (!r) {
      const m = id ? meta.get(id) : undefined
      r = { sourceId: id, title: id ? (m?.title ?? 'Silinmiş kaynak') : 'Elle / bilinmeyen', type: m?.type ?? 'manual', signals: 0, trades: 0, closed: 0, wins: 0, winrate: null, pnl: 0, cost: 0, roi: null }
      rows.set(id, r)
    }
    return r
  }
  for (const s of signals) if (new Date(s.received_at).getTime() >= sinceMs) row(s.source_id).signals++
  for (const p of positions) {
    if (!inMode(mode, p.is_dry_run) || new Date(p.opened_at).getTime() < sinceMs) continue
    const list = byMint.get(p.mint) ?? []
    const before = list.filter((s) => s.received_at <= p.opened_at)
    const sig = before.length ? before[before.length - 1] : list[0]
    const r = row(sig?.source_id ?? null)
    r.trades++
    const pnl = positionPnl(p)
    if (pnl === null) continue
    r.pnl += pnl
    r.cost += n(p.cost_sol)
    if (p.status === 'closed') {
      r.closed++
      if (pnl > 0) r.wins++
    }
  }
  const out = [...rows.values()]
  for (const r of out) {
    r.winrate = r.closed ? r.wins / r.closed : null
    r.roi = r.cost > 0 ? r.pnl / r.cost : null
  }
  return out.sort((a, b) => b.pnl - a.pnl || b.trades - a.trades || b.signals - a.signals)
}


// ---------------------------------------------------------------- çağrıcılar (Telegram grup üyeleri)
export type CallerRule = 'normal' | 'trusted' | 'blocked'

export interface DCaller {
  sender_id: string
  name: string | null
  handle: string | null
  rule: CallerRule
}

export type Period = 'day' | 'week' | 'month'
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 }
export const PERIOD_LABEL: Record<Period, string> = { day: 'Bugün', week: 'Son 7 gün', month: 'Son 30 gün' }

export interface CallerRow {
  senderId: string
  name: string
  handle: string | null
  rule: CallerRule
  /** kişinin çağrılarının geldiği gruplar */
  groups: string[]
  /** dönemde KAPANAN işlemler */
  trades: number
  wins: number
  losses: number
  winrate: number | null
  /** dönemde kapanan işlemlerin toplam kâr/zararı (SOL) */
  pnl: number
  cost: number
  roi: number | null
}

/** Pozisyonu açan sinyal: açılıştan önceki son sinyal; yoksa en erken sinyal (kaynak performansıyla aynı kural). */
function signalOf(p: DPosition, byMint: Map<string, DSignal[]>): DSignal | undefined {
  const list = byMint.get(p.mint) ?? []
  const before = list.filter((s) => s.received_at <= p.opened_at)
  return before.length ? before[before.length - 1] : list[0]
}

function signalsByMint(signals: DSignal[]): Map<string, DSignal[]> {
  const byMint = new Map<string, DSignal[]>()
  for (const s of signals) byMint.set(s.mint, [...(byMint.get(s.mint) ?? []), s])
  for (const list of byMint.values()) list.sort((a, b) => a.received_at.localeCompare(b.received_at))
  return byMint
}

/**
 * Çağrıcı tablosu: dönemde (bugün / son 7 / son 30 gün) KAPANAN işlemlerin kâr/zararı, işlemi açan sinyali
 * paylaşan kişiye yazılır. Gönderenin bilinmediği işlemler (kanal, X, elle alım) tabloya girmez.
 * Sıralama: en çok kazandıran ilk.
 */
export function callerLeaderboard(
  positions: DPosition[],
  signals: DSignal[],
  callers: DCaller[],
  sources: DSource[],
  mode: Mode,
  period: Period,
  now = new Date()
): CallerRow[] {
  const since = startOfDay(now, PERIOD_DAYS[period] - 1)
  const byMint = signalsByMint(signals)
  const meta = new Map(callers.map((c) => [c.sender_id, c]))
  const titles = new Map(sources.map((s) => [s.id, s.title]))
  const rows = new Map<string, CallerRow>()
  for (const p of positions) {
    if (p.status !== 'closed' || !p.closed_at || !inMode(mode, p.is_dry_run)) continue
    if (new Date(p.closed_at).getTime() < since) continue
    const sig = signalOf(p, byMint)
    if (!sig?.sender_id) continue
    const c = meta.get(sig.sender_id)
    let r = rows.get(sig.sender_id)
    if (!r) {
      r = { senderId: sig.sender_id, name: c?.name || c?.handle || 'Bilinmeyen', handle: c?.handle ?? null, rule: c?.rule ?? 'normal', groups: [], trades: 0, wins: 0, losses: 0, winrate: null, pnl: 0, cost: 0, roi: null }
      rows.set(sig.sender_id, r)
    }
    const pnl = positionPnl(p) ?? 0
    r.trades++
    r.pnl += pnl
    r.cost += n(p.cost_sol)
    if (pnl > 0) r.wins++
    else if (pnl < 0) r.losses++
    const g = sig.source_id ? titles.get(sig.source_id) : undefined
    if (g && !r.groups.includes(g)) r.groups.push(g)
  }
  const out = [...rows.values()]
  for (const r of out) {
    r.winrate = r.trades ? r.wins / r.trades : null
    r.roi = r.cost > 0 ? r.pnl / r.cost : null
  }
  return out.sort((a, b) => b.pnl - a.pnl || b.trades - a.trades)
}

/** "En çok kazandıran 10": yalnız kâr getirenler. */
export const topEarners = (rows: CallerRow[], limit = 10) => rows.filter((r) => r.pnl > 0).slice(0, limit)

export interface CallerSuggestion {
  senderId: string
  name: string
  suggest: 'trusted' | 'blocked'
  trades: number
  winrate: number
  pnl: number
}

// Öneri eşikleri: son 30 günde en az bu kadar kapanan işlem olmadan öneri verilmez
export const SUGGEST_MIN_TRADES = 5
export const SUGGEST_TRUST_WINRATE = 0.6
export const SUGGEST_BLOCK_WINRATE = 0.3

/** Son 30 günlük performansa göre "güvenilir yap" / "engelle" önerileri. Hiçbir şey kendiliğinden değişmez; kullanıcı onaylar. */
export function callerSuggestions(positions: DPosition[], signals: DSignal[], callers: DCaller[], sources: DSource[], mode: Mode, now = new Date()): CallerSuggestion[] {
  const out: CallerSuggestion[] = []
  for (const r of callerLeaderboard(positions, signals, callers, sources, mode, 'month', now)) {
    if (r.rule !== 'normal' || r.trades < SUGGEST_MIN_TRADES || r.winrate === null) continue
    if (r.pnl > 0 && r.winrate >= SUGGEST_TRUST_WINRATE) out.push({ senderId: r.senderId, name: r.name, suggest: 'trusted', trades: r.trades, winrate: r.winrate, pnl: r.pnl })
    else if (r.pnl < 0 && r.winrate <= SUGGEST_BLOCK_WINRATE) out.push({ senderId: r.senderId, name: r.name, suggest: 'blocked', trades: r.trades, winrate: r.winrate, pnl: r.pnl })
  }
  return out
}
