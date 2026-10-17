import type { EngineContext } from './context'
import type { OrderEngine } from './orders'
import type { Pipeline } from './pipeline'
import type { SourceHub } from './sources'
import type { DeployEngine } from './deploy'
import type { DeployForm } from '../shared/deploy'
import { assertSigningKey } from './gmgn/signer'
import { extractWallets } from './gmgn/trade'
import { pollMonitors } from './xflux/client'
import { isLikelyMint } from '../shared/extract'
import { openSealed, sealAad, type Sealed } from '../shared/seal'
import { SEAL_PURPOSE, type CommandKind } from '../shared/engine'
import type { XPollResult } from '../shared/types'

// Komut kuyruğu: arayüz engine_commands'a "pending" satır yazar, motor üstlenir (pending → running),
// çalıştırır ve sonucu (done/failed) aynı satıra yazar. Şifreli girdiler açıldıktan sonra silinir.

interface CommandRow {
  id: string
  user_id: string
  kind: string
  payload: Record<string, unknown> | null
  status: string
  created_at: string
}

const STALE_MS = 2 * 60_000 // motor kapalıyken birikmiş eski komutlar çalıştırılmaz
const TRADER_ONLY = new Set<string>(['positions.sell_all', 'deploy.submit'])

export class CommandError extends Error {}

type Handler = (userId: string, payload: Record<string, unknown>) => Promise<unknown>

export class Commands {
  private busy = new Set<string>()
  private readonly handlers: Record<CommandKind, Handler>

  constructor(
    private readonly ctx: EngineContext,
    deps: {
      orders: OrderEngine
      pipeline: Pipeline
      sources: SourceHub
      deploy: DeployEngine
      xPoll?: (apiKey: string, hitLimit?: number) => Promise<XPollResult>
    }
  ) {
    const { vault, state } = ctx
    const xPoll = deps.xPoll ?? pollMonitors
    const gmgnState = (userId: string) => {
      const g = vault.get(userId).gmgn
      state.patch(userId, { gmgn: { configured: !!g, plan: g?.plan ?? 'free', wallet: g?.wallet ?? null } })
    }
    const needGmgn = (userId: string) => {
      const g = ctx.gmgn(userId)
      if (!g) throw new CommandError('GMGN anahtarı girilmemiş (Ayarlar)')
      return g
    }

    this.handlers = {
      'gmgn.save': async (userId, p) => {
        const s = await this.open<{ apiKey?: string; privateKeyPem?: string }>(userId, 'gmgn.save', p)
        const apiKey = String(s.apiKey ?? '').trim()
        if (!apiKey) throw new CommandError('API anahtarı boş')
        const pem = String(s.privateKeyPem ?? '').replace(/\\n/g, '\n').trim() + '\n'
        try {
          assertSigningKey(pem)
        } catch (e) {
          throw new CommandError(`İmza anahtarı geçersiz: ${(e as Error).message}`)
        }
        const prev = vault.get(userId).gmgn
        // Cüzdan API anahtarına bağlı: anahtar değiştiyse seçimi sıfırla
        const wallet = prev?.apiKey === apiKey ? prev.wallet : undefined
        vault.set(userId, 'gmgn', { apiKey, privateKeyPem: pem, plan: prev?.plan, wallet })
        gmgnState(userId)
        await ctx.audit(userId, 'gmgn.key_saved')
        return { ok: true }
      },
      'gmgn.clear': async (userId) => {
        vault.set(userId, 'gmgn', undefined)
        gmgnState(userId)
        await ctx.audit(userId, 'gmgn.key_cleared')
        return { ok: true }
      },
      'gmgn.plan': async (userId, p) => {
        const plan = String(p.plan)
        if (!['free', 'plus', 'pro'].includes(plan)) throw new CommandError('Geçersiz plan')
        const g = vault.get(userId).gmgn
        if (!g) throw new CommandError('GMGN anahtarı girilmemiş')
        vault.set(userId, 'gmgn', { ...g, plan: plan as 'free' | 'plus' | 'pro' })
        gmgnState(userId)
        return { ok: true }
      },
      'gmgn.test': async (userId) => {
        const g = needGmgn(userId)
        const t0 = performance.now()
        const r = await g.client.userInfo()
        const ms = Math.round(performance.now() - t0)
        if (!r.ok) throw new CommandError(`GMGN: ${r.error}`)
        return { ok: true, ms }
      },
      'gmgn.wallets': async (userId) => {
        const g = needGmgn(userId)
        const r = await g.client.userInfo()
        if (!r.ok) throw new CommandError(`GMGN: ${r.error}`)
        return { wallets: extractWallets(r.data), selected: g.secret.wallet }
      },
      'gmgn.wallet': async (userId, p) => {
        const address = String(p.address ?? '')
        const g = vault.get(userId).gmgn
        if (!g) throw new CommandError('GMGN anahtarı girilmemiş')
        if (!isLikelyMint(address)) throw new CommandError('Geçersiz cüzdan adresi')
        vault.set(userId, 'gmgn', { ...g, wallet: address })
        gmgnState(userId)
        await ctx.audit(userId, 'gmgn.wallet_selected', { address })
        return { ok: true }
      },
      'token.check': async (userId, p) => {
        const mints = (Array.isArray(p.mints) ? p.mints : []).map(String).filter(isLikelyMint)
        if (!mints.length) throw new CommandError('Geçerli token adresi yok')
        return { results: await deps.pipeline.check(userId, mints, ctx.users.rule(userId).thresholds) }
      },
      'xflux.save': async (userId, p) => {
        const s = await this.open<{ apiKey?: string }>(userId, 'xflux.save', p)
        const key = String(s.apiKey ?? '').trim()
        if (!/^xflux_[\w-]{8,}$/.test(key)) throw new CommandError('Anahtar "xflux_" ile başlamalı')
        // Kaydetmeden önce dene: yanlış anahtar saklanmasın
        const test = await xPoll(key, 1)
        if (!test.ok && (test.status === 401 || test.status === 403)) throw new CommandError('XFlux anahtarı reddedildi')
        vault.set(userId, 'xflux', { apiKey: key })
        deps.sources.syncX(userId)
        await ctx.audit(userId, 'xflux.key_saved')
        return { ok: true }
      },
      'xflux.clear': async (userId) => {
        vault.set(userId, 'xflux', undefined)
        deps.sources.syncX(userId)
        return { ok: true }
      },
      'telegram.login': async (userId, p) => {
        const s = await this.open<{ apiId?: unknown; apiHash?: unknown; phone?: unknown }>(userId, 'telegram.login', p)
        try {
          await deps.sources.tg(userId).startLogin(Number(s.apiId), String(s.apiHash ?? '').trim(), String(s.phone ?? ''))
        } catch (e) {
          throw new CommandError((e as Error).message)
        }
        return { ok: true }
      },
      'telegram.code': async (userId, p) => {
        const s = await this.open<{ code?: unknown }>(userId, 'telegram.code', p)
        deps.sources.tg(userId).submitCode(String(s.code ?? ''))
        return { ok: true }
      },
      'telegram.password': async (userId, p) => {
        const s = await this.open<{ password?: unknown }>(userId, 'telegram.password', p)
        deps.sources.tg(userId).submitPassword(String(s.password ?? ''))
        return { ok: true }
      },
      'telegram.logout': async (userId) => {
        await deps.sources.tg(userId).logout()
        return { ok: true }
      },
      'telegram.chats': async (userId) => {
        try {
          return { chats: await deps.sources.tg(userId).listChats() }
        } catch (e) {
          throw new CommandError((e as Error).message)
        }
      },
      'positions.sell_all': async (userId) => deps.orders.sellAll(userId),
      'deploy.submit': async (userId, p) => {
        if (!p.form || typeof p.form !== 'object') throw new CommandError('Form eksik')
        return deps.deploy.submit(userId, p.form as DeployForm, String(p.key ?? ''))
      }
    }
  }

  private async open<T>(userId: string, kind: CommandKind, p: Record<string, unknown>): Promise<T> {
    try {
      return await openSealed<T>(this.ctx.vault.sealKey, sealAad(userId, SEAL_PURPOSE[kind]!), p.sealed as Sealed)
    } catch {
      throw new CommandError('Şifreli veri açılamadı (motor anahtarı değişmiş olabilir; sayfayı yenileyip tekrar deneyin)')
    }
  }

  async processPending(): Promise<void> {
    const { data, error } = await this.ctx.db
      .from('engine_commands')
      .select('id, user_id, kind, payload, status, created_at')
      .eq('status', 'pending')
      .order('created_at')
      .limit(20)
    if (error) return this.ctx.log.warn('komutlar alınamadı', { error: error.message })
    // Telegram kodu gibi komutlar sırayla gelmeli; kullanıcı başına sırayla, kullanıcılar arası paralel
    const byUser = new Map<string, CommandRow[]>()
    for (const c of (data as CommandRow[]) ?? []) byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c])
    await Promise.all([...byUser.values()].map(async (list) => {
      for (const c of list) await this.run(c)
    }))
  }

  async run(c: CommandRow): Promise<void> {
    if (this.busy.has(c.id)) return
    this.busy.add(c.id)
    const db = this.ctx.db
    try {
      // Şifreli girdi üstlenme anında silinir: veritabanında kalmasın
      const { data: won } = await db
        .from('engine_commands')
        .update({ status: 'running', payload: null })
        .eq('id', c.id)
        .eq('status', 'pending')
        .select('id')
      if (!won?.length) return
      const finish = (patch: Record<string, unknown>) =>
        db.from('engine_commands').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', c.id)

      const handler = this.handlers[c.kind as CommandKind]
      if (!handler) return void (await finish({ status: 'failed', error: 'Motor bu komutu tanımıyor — motor eski sürüm olabilir, güncelleyin' }))
      if (Date.now() - new Date(c.created_at).getTime() > STALE_MS) {
        return void (await finish({ status: 'failed', error: 'Komut zamanında işlenemedi (motor kapalıydı)' }))
      }
      if (!this.ctx.users.active(c.user_id)) await this.ctx.users.fresh(c.user_id)
      if (!this.ctx.users.active(c.user_id)) return void (await finish({ status: 'failed', error: 'Hesap aktif değil' }))
      if (TRADER_ONLY.has(c.kind) && !this.ctx.users.canTrade(c.user_id)) {
        return void (await finish({ status: 'failed', error: 'Bu rol işlem yapamaz' }))
      }
      try {
        const result = await handler(c.user_id, c.payload ?? {})
        await finish({ status: 'done', result: result ?? null })
      } catch (e) {
        const msg = e instanceof CommandError ? e.message : `Motor hatası: ${(e as Error).message}`
        if (!(e instanceof CommandError)) this.ctx.log.error('komut hatası', { kind: c.kind, error: (e as Error).message })
        await finish({ status: 'failed', error: msg })
      }
    } finally {
      this.busy.delete(c.id)
    }
  }
}
