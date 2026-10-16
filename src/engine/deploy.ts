import type { EngineContext } from './context'
import { CommandError } from './commands'
import { normStatus } from './orders'
import { buildCreateToken, redactRequest, validateDeploy, type DeployForm } from '../shared/deploy'
import { isLikelyMint } from '../shared/extract'
import { presetFromRow, resolvePreset, type FeePresetRow } from '../shared/settings'

// Token deploy motoru. Kurallar emirlerle aynı:
//  - Sadece founder/developer, kill switch açıkken deploy yok (deploy SOL harcar)
//  - Deneme modunda (kural: liveTrading=false) istek sadece hazırlanıp kaydedilir, GMGN'e GÖNDERİLMEZ
//  - Aynı form tek deploy (idempotency_key), başarısız deploy otomatik tekrar denenmez
//  - Token adresi GMGN emir sorgusunda report.output_token ile gelir

const TRACK_MAX = 30 // ~1 dk (3 sn aralıkla)

type Obj = Record<string, unknown>
const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Obj)[k] : undefined)
const now = () => new Date().toISOString()

export interface DeployResult {
  id: string
  status: string
  dryRun: boolean
  request: Record<string, unknown>
}

export class DeployEngine {
  constructor(private readonly ctx: EngineContext) {}

  async submit(userId: string, form: DeployForm, key: string): Promise<DeployResult> {
    const ctx = this.ctx
    if (!/^[\w:-]{8,100}$/.test(key)) throw new CommandError('Geçersiz form anahtarı')
    const { rule, canTrade } = await ctx.users.fresh(userId)
    if (!canTrade) throw new CommandError('Bu rol deploy yapamaz')
    if (await ctx.killSwitch()) throw new CommandError('İşlemler founder tarafından durduruldu')
    const errors = validateDeploy(form)
    if (errors.length) throw new CommandError(errors.join(' · '))
    const live = rule.limits.liveTrading
    if (form.buySol > rule.limits.maxBuySol + 1e-9) throw new CommandError(`Geliştirici alımı en fazla ${rule.limits.maxBuySol} SOL (Kurallar)`)

    const g = ctx.gmgn(userId)
    if (live && !g) throw new CommandError('GMGN anahtarı girilmemiş (Ayarlar)')
    if (live && !g?.secret.wallet) throw new CommandError('İşlem cüzdanı seçilmemiş (Ayarlar → GMGN)')
    const wallet = g?.secret.wallet ?? '<cüzdan seçilmedi>'

    const { data: rows } = await ctx.db.from('fee_presets').select('slot, kind, priority_sol, tip_sol, slippage, anti_mev').eq('user_id', userId)
    const fees = resolvePreset(((rows as FeePresetRow[]) ?? []).map(presetFromRow), form.preset, 'deploy', rule.limits)
    const params = buildCreateToken(form, wallet, fees)
    const request = redactRequest(params)

    const { data: row, error } = await ctx.db
      .from('deploys')
      .insert({
        user_id: userId,
        idempotency_key: `deploy:${userId}:${key}`,
        feed_item_id: form.feedItemId ?? null,
        platform: form.platform,
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        is_dry_run: !live,
        status: live ? 'sending' : 'simulated',
        request
      })
      .select('id')
      .single()
    if (error) throw new CommandError(error.code === '23505' ? 'Bu form zaten gönderildi' : error.message)
    await ctx.audit(userId, live ? 'deploy.submit' : 'deploy.simulate', { platform: form.platform, symbol: form.symbol, buySol: form.buySol })
    if (!live) return { id: row.id, status: 'simulated', dryRun: true, request }

    const res = await g!.client.createToken(params)
    if (!res.ok) {
      await this.update(row.id, { status: 'failed', error: res.error }, ['sending'])
      throw new CommandError(`GMGN: ${res.error}`)
    }
    const orderId = get(res.data, 'order_id')
    const st = normStatus(get(res.data, 'status'))
    await this.update(
      row.id,
      { status: 'submitted', gmgn_order_id: orderId ? String(orderId) : null, tx_hash: (get(res.data, 'hash') as string) || null },
      ['sending']
    )
    if (st === 'failed' || st === 'expired') await this.update(row.id, { status: 'failed', error: String(get(res.data, 'error_status') ?? st) }, ['submitted'])
    else if (orderId) void this.track(userId, row.id, String(orderId))
    return { id: row.id, status: 'submitted', dryRun: false, request }
  }

  private async update(id: string, patch: Obj, from: string[]) {
    await this.ctx.db.from('deploys').update({ ...patch, updated_at: now() }).eq('id', id).in('status', from)
  }

  private async track(userId: string, id: string, orderId: string): Promise<void> {
    for (let i = 0; i < TRACK_MAX; i++) {
      await new Promise((r) => setTimeout(r, this.ctx.trackOrderMs))
      const g = this.ctx.gmgn(userId)
      if (!g) return
      const r = await g.client.queryOrder(orderId)
      if (!r.ok) continue
      const st = normStatus(get(r.data, 'status'))
      if (st === 'confirmed') {
        const mint = get(get(r.data, 'report'), 'output_token')
        await this.update(
          id,
          { status: 'confirmed', mint: typeof mint === 'string' && isLikelyMint(mint) ? mint : null, tx_hash: (get(r.data, 'hash') as string) || null },
          ['submitted']
        )
        return
      }
      if (st === 'failed' || st === 'expired') {
        await this.update(id, { status: 'failed', error: String(get(r.data, 'error_status') ?? get(r.data, 'error_code') ?? st) }, ['submitted'])
        return
      }
    }
  }

  /** Açılışta: 'sending' kalanlar başarısız (tekrar yok), 'submitted' olanlar izlenir. */
  async recover(): Promise<void> {
    await this.ctx.db
      .from('deploys')
      .update({ status: 'failed', error: 'Motor gönderim sırasında durdu — GMGN üzerinden kontrol edin', updated_at: now() })
      .eq('status', 'sending')
    const { data } = await this.ctx.db.from('deploys').select('id, user_id, gmgn_order_id').eq('status', 'submitted').not('gmgn_order_id', 'is', null)
    for (const d of (data as { id: string; user_id: string; gmgn_order_id: string }[]) ?? []) void this.track(d.user_id, d.id, d.gmgn_order_id)
  }
}
