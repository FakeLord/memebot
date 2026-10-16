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

export interface HoldingInfo {
  mint: string
  balance: number // okunabilir birim
  priceUsd?: number
}

export interface WalletInfo {
  address: string
  balance?: number
}

export interface ExecParams {
  dryRun: boolean
  slippage: number | 'auto' // yüzde (30 = %30)
  priorityFeeSol: number
  tipFeeSol: number
  antiMev: boolean
}

export interface BuyRequest extends ExecParams {
  mint: string
  amountSol: number
  conditionOrders: ConditionOrder[]
}

export interface SellRequest extends ExecParams {
  mint: string
  percent: number // 1–100
  amountRaw?: string // deneme modunda teklif için eldeki miktar
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'none' }
  | { state: 'error'; message: string }

export type TelegramStatus =
  | { state: 'needs_setup' }
  | { state: 'connecting' }
  | { state: 'code'; viaApp: boolean; error?: string }
  | { state: 'password'; hint?: string; error?: string }
  | { state: 'connected'; me: string }
  | { state: 'disconnected'; reason?: string }

export interface TelegramChat {
  id: string
  title: string
  kind: 'channel' | 'group'
}

export interface TelegramMessage {
  chatId: string
  msgId: number
  text: string
  date: number // Unix saniye (Telegram zamanı)
  receivedAt: number // Unix ms (bu bilgisayar)
  edited: boolean
}

export interface MemeBotApi {
  appVersion(): Promise<string>
  gmgn: {
    saveCredentials(userId: string, apiKey: string, privateKeyPem: string): Promise<{ ok: boolean; error?: string }>
    hasCredentials(userId: string): Promise<boolean>
    getPlan(userId: string): Promise<'free' | 'plus' | 'pro'>
    setPlan(userId: string, plan: 'free' | 'plus' | 'pro'): Promise<boolean>
    clearCredentials(userId: string): Promise<void>
    userInfo(userId: string): Promise<GmgnResult>
    tokenInfo(userId: string, mint: string): Promise<GmgnResult>
    tokenSecurity(userId: string, mint: string): Promise<GmgnResult>
  }
  trade: {
    wallets(userId: string): Promise<{ ok: true; wallets: WalletInfo[]; selected?: string } | { ok: false; error: string }>
    setWallet(userId: string, address: string): Promise<boolean>
    selectedWallet(userId: string): Promise<string | null>
    buy(userId: string, r: BuyRequest): Promise<GmgnResult>
    sell(userId: string, r: SellRequest): Promise<GmgnResult>
    queryOrder(userId: string, orderId: string): Promise<GmgnResult>
    holdings(userId: string): Promise<{ ok: true; items: HoldingInfo[]; complete: boolean } | { ok: false; error: string }>
    tokenPrice(userId: string, mint: string): Promise<GmgnResult>
  }
  telegram: {
    attach(userId: string): Promise<TelegramStatus>
    detach(): Promise<void>
    startLogin(apiId: number, apiHash: string, phone: string): Promise<void>
    submitCode(code: string): Promise<void>
    submitPassword(password: string): Promise<void>
    logout(): Promise<void>
    listChats(): Promise<{ ok: true; chats: TelegramChat[] } | { ok: false; error: string }>
    setWatched(chatIds: string[]): Promise<void>
    onStatus(cb: (s: TelegramStatus) => void): () => void
    onMessage(cb: (m: TelegramMessage) => void): () => void
  }
  updater: {
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
}
