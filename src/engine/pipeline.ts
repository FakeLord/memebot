import type { EngineContext } from './context'
import type { OrderEngine } from './orders'
import { ORDER_COLS, type OrderRow } from './orders'
import { evaluateSafety, summarizeToken, type SafetyThresholds } from '../shared/safety'
import type { TokenCheckResult } from '../shared/engine'
import { startOfDay } from './time'

// Karar motoru: yeni sinyal → GMGN güvenlik kontrolü → kullanıcının kuralına göre onay adayı.
// Otomatik modda aday beklemeden emre dönüşür (günlük zarar sınırı aşılırsa mod Manuel'e çekilir).

const CACHE_MS = 3 * 60_000
const SIGNAL_MAX_AGE_MS = 10 * 60_000 // motor kapalıyken gelen eski sinyaller işlenmez

type Raw = { info: unknown; security: unknown }

export class Pipeline {
  private inFlight = new Set<string>()

  constructor(
    private readonly ctx: EngineContext,
    private readonly orders: OrderEngine
  ) {}

  /** İşlenmemiş sinyalleri sırayla üstlenip işler. */
  async processPending(): Promise<void> {
    const db = this.ctx.db
    const { data } = await db
      .from('signals')
      .select('id, user_id, mint, received_at')
      .is('processed_at', null)
      .order('received_at')
      .limit(25)
    for (const s of (data as { id: string; user_id: string; mint: string; received_at: string }[]) ?? []) {
      const { data: won } = await db.from('signals').update({ processed_at: new Date().toISOString() }).eq('id', s.id).is('processed_at', null).select('id')
      if (!won?.length) continue
      if (Date.now() - new Date(s.received_at).getTime() > SIGNAL_MAX_AGE_MS) continue
      await this.processMint(s.user_id, s.mint, s.id)
    }
  }

  /** GMGN'den (ya da 3 dk'lık ortak önbellekten) ham güvenlik verisi. */
  async safetyRaw(userId: string, mint: string): Promise<{ raw: Raw; checkId?: string } | { error: string; noKey?: boolean }> {
    const db = this.ctx.db
    const since = new Date(Date.now() - CACHE_MS).toISOString()
    const { data: cached } = await db
      .from('safety_checks')
      .select('id, raw')
      .eq('mint', mint)
      .gte('checked_at', since)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cached?.raw) return { raw: cached.raw as Raw, checkId: cached.id }

    const client = this.ctx.gmgnRead(userId)
    if (!client) return { error: 'GMGN anahtarı girilmemiş', noKey: true }
    const [info, security] = await Promise.all([client.tokenInfo(mint), client.tokenSecurity(mint)])
    if (!info.ok || !security.ok) return { error: `GMGN: ${(!info.ok && info.error) || (!security.ok && security.error)}` }
    const raw = { info: info.data, security: security.data }
    // Önbellekteki karar varsayılan eşiklerle; her kullanıcı kendi eşikleriyle yeniden değerlendirir
    const report = evaluateSafety(raw.security, raw.info, null)
    const { data: inserted } = await db
      .from('safety_checks')
      .insert({ mint, result: report.result, reasons: report.items.filter((i) => i.verdict !== 'pass'), raw, checked_by: userId })
      .select('id')
      .single()
    return { raw, checkId: inserted?.id }
  }

  /** Token Kontrol ekranı: önbelleğe bakmadan taze kontrol. */
  async check(userId: string, mints: string[], thresholds: SafetyThresholds): Promise<TokenCheckResult[]> {
    const client = this.ctx.gmgnRead(userId)
    if (!client) return mints.map((mint) => ({ mint, error: 'GMGN anahtarı girilmemiş (Ayarlar)' }))
    const out: TokenCheckResult[] = []
    for (const mint of mints.slice(0, 5)) {
      const [info, security] = await Promise.all([client.tokenInfo(mint), client.tokenSecurity(mint)])
      if (!info.ok || !security.ok) {
        out.push({ mint, error: (!info.ok && info.error) || (!security.ok && security.error) || 'Bilinmeyen hata' })
        continue
      }
      const report = evaluateSafety(security.data, info.data, thresholds)
      out.push({ mint, summary: summarizeToken(info.data), report })
      await this.ctx.db.from('safety_checks').insert({
        mint,
        result: report.result,
        reasons: report.items.filter((i) => i.verdict !== 'pass'),
        raw: { info: info.data, security: security.data },
        checked_by: userId
      })
    }
    return out
  }

  async processMint(userId: string, mint: string, signalId?: string): Promise<void> {
    const ctx = this.ctx
    const key = `${userId}:${mint}`
    if (this.inFlight.has(key) || !ctx.users.active(userId)) return
    this.inFlight.add(key)
    ctx.state.patch(userId, { pipeline: { state: 'working' } })
    try {
      const got = await this.safetyRaw(userId, mint)
      if ('error' in got) {
        ctx.state.patch(userId, { pipeline: got.noKey ? { state: 'no_key' } : { state: 'idle', lastError: got.error } })
        return
      }
      const rule = ctx.users.rule(userId)
      const report = evaluateSafety(got.raw.security, got.raw.info, rule.thresholds)
      ctx.state.patch(userId, { pipeline: { state: 'idle', lastError: null } })
      if (rule.mode === 'watch') return
      if (report.result === 'fail') return
      if (report.result === 'warn' && !rule.limits.allowWarn) return

      // Onay adayı (aynı token için tek bekleyen aday — tekrar eklenirse yok sayılır)
      const summary = summarizeToken(got.raw.info)
      const { data: cand, error } = await ctx.db
        .from('candidates')
        .insert({
          user_id: userId,
          mint,
          signal_id: signalId ?? null,
          safety_check_id: got.checkId ?? null,
          verdict: report.result,
          reasons: report.items.filter((i) => i.verdict !== 'pass'),
          summary,
          expires_at: new Date(Date.now() + rule.limits.approvalTtlMin * 60_000).toISOString()
        })
        .select('id')
        .single()
      if (error) {
        if (error.code !== '23505') ctx.state.patch(userId, { pipeline: { lastError: error.message } })
        return
      }
      if (rule.mode === 'auto') await this.autoBuy(userId, cand.id, mint, summary.symbol)
    } finally {
      this.inFlight.delete(key)
    }
  }

  // Otomatik mod: aday "bekliyor → onaylandı" geçişini kazanan motor alır
  private async autoBuy(userId: string, candidateId: string, mint: string, symbol?: string): Promise<void> {
    const ctx = this.ctx
    const { rule, canTrade } = await ctx.users.fresh(userId)
    if (rule.mode !== 'auto' || !canTrade) return
    const live = rule.limits.liveTrading

    const { data: closed } = await ctx.db
      .from('positions')
      .select('cost_sol, proceeds_sol')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .eq('is_dry_run', !live)
      .gte('closed_at', startOfDay(ctx.timeZone).toISOString())
    const pnl = ((closed as { cost_sol: number | null; proceeds_sol: number }[]) ?? []).reduce(
      (a, p) => a + (Number(p.proceeds_sol) || 0) - (Number(p.cost_sol) || 0),
      0
    )
    if (pnl <= -rule.limits.dailyLossLimitSol) {
      const msg = `Otomatik mod kapatıldı: bugünkü zarar ${pnl.toFixed(3)} SOL, sınır -${rule.limits.dailyLossLimitSol} SOL.`
      await ctx.db.from('rules').update({ mode: 'manual', updated_at: new Date().toISOString() }).eq('user_id', userId)
      await ctx.users.fresh(userId)
      await ctx.audit(userId, 'auto.disabled', { reason: 'daily_loss', pnl })
      ctx.state.patch(userId, { notice: msg })
      return
    }

    const amount = Math.min(rule.limits.autoBuySol, rule.limits.maxBuySol)
    const { data: won } = await ctx.db
      .from('candidates')
      .update({ status: 'approved', amount_sol: amount, auto: true, decided_at: new Date().toISOString() })
      .eq('id', candidateId)
      .eq('status', 'pending')
      .select('id')
    if (!won?.length) return // kullanıcı ya da başka bir yoklama karar verdi

    const { data: row, error } = await ctx.db
      .from('orders')
      .insert({
        user_id: userId,
        idempotency_key: `buy:${candidateId}`,
        side: 'buy',
        mint,
        amount_in: String(Math.round(amount * 1e9)),
        is_dry_run: !live,
        candidate_id: candidateId,
        symbol: symbol ?? null
      })
      .select(ORDER_COLS)
      .single()
    if (error) {
      ctx.state.patch(userId, { notice: `Otomatik alım yapılamadı (${symbol ?? mint.slice(0, 6)}): ${error.message}` })
      return
    }
    await this.orders.execute(row as OrderRow)
    const { data: after } = await ctx.db.from('orders').select('status, error_code').eq('id', (row as OrderRow).id).single()
    if (after?.status === 'failed') {
      await ctx.audit(userId, 'auto.buy_failed', { mint, error: after.error_code })
      ctx.state.patch(userId, { notice: `Otomatik alım yapılamadı (${symbol ?? mint.slice(0, 6)}): ${after.error_code}` })
    } else {
      ctx.state.patch(userId, { notice: null })
    }
  }

  /** Süresi dolan bekleyen adayları kapatır (tüm kullanıcılar). */
  async expireCandidates(): Promise<void> {
    await this.ctx.db
      .from('candidates')
      .update({ status: 'expired', decided_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
  }
}
