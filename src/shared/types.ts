import type { FeedAuthor, FeedMedia } from './feed'

export type Role = 'founder' | 'developer' | 'assistant'

export interface Profile {
  id: string
  username: string
  role: Role
  is_active: boolean
  created_at: string
  display_name?: string | null
  avatar_emoji?: string | null
  avatar_color?: string | null
  status_text?: string | null
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
  text: string // mesaj + gizli bağlantılar + buton URL'leri (adres ayıklama için)
  body: string // sadece görünür mesaj metni (kart için)
  date: number // Unix saniye (Telegram zamanı)
  receivedAt: number // Unix ms (motor)
  edited: boolean
  photo?: Uint8Array // küçük önizleme (JPEG)
  mediaOnly?: boolean // aynı mesajın görsel güncellemesi (sinyal olarak tekrar işlenmez)
  replyText?: string
  channelUsername?: string // herkese açık kanalsa t.me bağlantısı için
  // Gruplarda mesajı yazan kişi (kanallarda ve anonim yöneticilerde yok)
  senderId?: string
  senderName?: string
  senderHandle?: string
}

export interface XHit {
  tweetId: string
  text: string // tüm metin alanları + bağlantılar (adres ayıklama için)
  body?: string // gönderinin kendi metni (kart için)
  createdAt?: number // Unix ms
  author?: FeedAuthor
  media?: FeedMedia[]
  kind?: 'post' | 'reply' | 'quote' | 'repost'
  ref?: { author?: FeedAuthor; text?: string }
}

export interface XMonitor {
  id: string
  username: string
  hits: XHit[]
}

export type XPollResult =
  | { ok: true; monitors: XMonitor[]; quotaRemaining?: number }
  | { ok: false; status: number; error: string; retryAfterSec?: number; quotaRemaining?: number }

export interface EngineHostStatus {
  enabled: boolean // bu bilgisayar motoru çalıştırsın mı
  hasServiceKey: boolean
  running: boolean
  logs: string[]
}

// Masaüstü kabuğunun arayüze açtığı küçük yüzey (tarayıcıda yoktur: window.desktop undefined).
// Alım-satım, GMGN, Telegram ve X artık motorda; arayüz onlarla Supabase üzerinden konuşur.
export interface DesktopApi {
  appVersion(): Promise<string>
  updater: {
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  engine: {
    status(): Promise<EngineHostStatus>
    configure(patch: { enabled?: boolean; serviceRoleKey?: string }): Promise<{ ok: true; status: EngineHostStatus } | { ok: false; error: string }>
  }
}
