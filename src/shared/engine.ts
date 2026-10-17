// Arayüz ↔ motor sözleşmesi. Arayüz komutu engine_commands'a yazar, motor çalıştırıp sonucu aynı satıra yazar.
// Motorun kullanıcı başına durumu engine_user_state'te, motorun kendisi engine_status'ta durur.

import type { SafetyReport, TokenSummary } from './safety'
import type { Sealed } from './seal'
import type { TelegramChat, TelegramStatus, WalletInfo } from './types'
import type { DeployForm } from './deploy'

export type GmgnPlan = 'free' | 'plus' | 'pro'

// Komut türü → [girdi, çıktı]. "sealed" alanları mühürlü zarftır (shared/seal.ts).
export interface EngineCommands {
  'gmgn.save': [{ sealed: Sealed }, { ok: true }]
  'gmgn.clear': [Record<string, never>, { ok: true }]
  'gmgn.plan': [{ plan: GmgnPlan }, { ok: true }]
  'gmgn.test': [Record<string, never>, { ok: true; ms: number }] // ms: motor → GMGN → motor süresi
  'gmgn.wallets': [Record<string, never>, { wallets: WalletInfo[]; selected?: string }]
  'gmgn.wallet': [{ address: string }, { ok: true }]
  'token.check': [{ mints: string[] }, { results: TokenCheckResult[] }]
  'xflux.save': [{ sealed: Sealed }, { ok: true }]
  'xflux.clear': [Record<string, never>, { ok: true }]
  'telegram.login': [{ sealed: Sealed }, { ok: true }]
  'telegram.code': [{ sealed: Sealed }, { ok: true }]
  'telegram.password': [{ sealed: Sealed }, { ok: true }]
  'telegram.logout': [Record<string, never>, { ok: true }]
  'telegram.chats': [Record<string, never>, { chats: TelegramChat[] }]
  'positions.sell_all': [Record<string, never>, { orders: number; errors: string[] }]
  'deploy.submit': [{ form: DeployForm; key: string }, { id: string; status: string; dryRun: boolean; request: Record<string, unknown> }]
}

export type CommandKind = keyof EngineCommands
export type CommandInput<K extends CommandKind> = EngineCommands[K][0]
export type CommandOutput<K extends CommandKind> = EngineCommands[K][1]

// Mühürlü zarfların amacı (aad): zarf sadece bu komut türünde açılır
export const SEAL_PURPOSE: Partial<Record<CommandKind, string>> = {
  'gmgn.save': 'gmgn',
  'xflux.save': 'xflux',
  'telegram.login': 'telegram.login',
  'telegram.code': 'telegram.code',
  'telegram.password': 'telegram.password'
}

export interface TokenCheckResult {
  mint: string
  summary?: TokenSummary
  report?: SafetyReport
  error?: string
}

export interface XMonitorState {
  id: string
  username: string
  hits: number
}

export type XState = 'no_key' | 'starting' | 'polling' | 'error'

export interface EngineUserState {
  user_id: string
  gmgn: { configured?: boolean; plan?: GmgnPlan; wallet?: string | null }
  telegram: TelegramStatus | Record<string, never>
  x: {
    configured?: boolean
    state?: XState
    error?: string | null
    quotaRemaining?: number
    intervalMs?: number
    lastPollAt?: number
    monitors?: XMonitorState[]
  }
  pipeline: { state?: 'idle' | 'no_key' | 'working'; lastError?: string | null }
  notice: string | null
  updated_at: string
}

export interface EngineStatusRow {
  id: string
  instance_id: string
  version: string | null
  host: string | null
  started_at: string | null
  heartbeat_at: string
  public_key: JsonWebKey | null
  gmgn_latency_ms: number | null
}

export const ENGINE_STALE_MS = 30_000

export function engineOnline(s: Pick<EngineStatusRow, 'heartbeat_at'> | null | undefined, now = Date.now()): boolean {
  return !!s && now - new Date(s.heartbeat_at).getTime() < ENGINE_STALE_MS
}
