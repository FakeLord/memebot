export type Role = 'founder' | 'developer' | 'assistant'

export interface Profile {
  id: string
  username: string
  role: Role
  is_active: boolean
  created_at: string
}

export type GmgnResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: number | string; resetAt?: string }

export interface ConditionOrder {
  order_type: 'profit_stop' | 'loss_stop' | 'profit_stop_trace' | 'loss_stop_trace'
  side: 'sell'
  price_scale?: string
  sell_ratio: string
  drawdown_rate?: string
}

export interface SwapParams {
  chain: string
  from_address: string
  input_token: string
  output_token: string
  input_amount: string
  input_amount_bps?: string
  slippage?: number
  auto_slippage?: boolean
  is_anti_mev?: boolean
  priority_fee?: string
  tip_fee?: string
  condition_orders?: ConditionOrder[]
  sell_ratio_type?: 'buy_amount' | 'hold_amount'
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'none' }
  | { state: 'error'; message: string }

export interface MemeBotApi {
  appVersion(): Promise<string>
  gmgn: {
    saveCredentials(userId: string, apiKey: string, privateKeyPem: string): Promise<{ ok: boolean; error?: string }>
    hasCredentials(userId: string): Promise<boolean>
    clearCredentials(userId: string): Promise<void>
    userInfo(userId: string): Promise<GmgnResult>
    tokenInfo(userId: string, mint: string): Promise<GmgnResult>
    tokenSecurity(userId: string, mint: string): Promise<GmgnResult>
  }
  updater: {
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
}
