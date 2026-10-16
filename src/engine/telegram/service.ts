import { Api, TelegramClient } from 'telegram'
import { NewMessage, type NewMessageEvent } from 'telegram/events'
import { EditedMessage, type EditedMessageEvent } from 'telegram/events/EditedMessage'
import { LogLevel } from 'telegram/extensions/Logger'
import { StringSession } from 'telegram/sessions'
import type { TelegramSecret } from '../vault'
import type { TelegramChat, TelegramMessage, TelegramStatus } from '../../shared/types'

// Telegram "userbot": kullanıcının kendi hesabıyla, SADECE OKUMA amaçlı bağlanır.
// Mesaj göndermez, gruba katılmaz. Oturum dizesi motorun kasasında şifreli saklanır.
// Motor her kullanıcı için ayrı bir TelegramService çalıştırır.

class Deferred<T> {
  promise: Promise<T>
  resolve!: (v: T) => void
  reject!: (e: Error) => void
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res
      this.reject = rej
    })
  }
}

const NO_ACCOUNT = 'NO_ACCOUNT'

function translateError(err: Error & { errorMessage?: string }): string {
  const code = err.errorMessage ?? err.message
  const map: Record<string, string> = {
    PHONE_CODE_INVALID: 'Kod hatalı.',
    PHONE_CODE_EXPIRED: 'Kodun süresi doldu, girişi yeniden başlatın.',
    PASSWORD_HASH_INVALID: 'İki adımlı doğrulama şifresi hatalı.',
    PHONE_NUMBER_INVALID: 'Telefon numarası geçersiz. Ülke koduyla yazın: +90...',
    PHONE_NUMBER_BANNED: 'Bu numara Telegram tarafından engellenmiş.',
    API_ID_INVALID: 'API ID / API Hash geçersiz (my.telegram.org).',
    FLOOD_WAIT: 'Çok fazla deneme yapıldı, bir süre bekleyin.'
  }
  const key = Object.keys(map).find((k) => code.startsWith(k))
  return key ? map[key] : code
}

type Emit = {
  status: (s: TelegramStatus) => void
  message: (m: TelegramMessage) => void
}

export interface TelegramStore {
  load(): TelegramSecret | undefined
  save(s: TelegramSecret): void
  clear(): void
}

// Mesaj metni + gizli bağlantılar + buton URL'leri. Mint adresi çoğu zaman
// "Buy" butonunun ya da köprülü metnin içinde, görünür metinde değil.
export function messageText(msg: Api.Message): string {
  const parts: string[] = [msg.message ?? '']
  for (const e of msg.entities ?? []) {
    if (e instanceof Api.MessageEntityTextUrl) parts.push(e.url)
  }
  const markup = msg.replyMarkup
  if (markup instanceof Api.ReplyInlineMarkup) {
    for (const row of markup.rows) {
      for (const b of row.buttons) {
        if (b instanceof Api.KeyboardButtonUrl) parts.push(b.url)
      }
    }
  }
  return parts.filter(Boolean).join('\n')
}

export class TelegramService {
  private client: TelegramClient | null = null
  private status: TelegramStatus = { state: 'needs_setup' }
  private watched = new Set<string>()
  private pendingCode: Deferred<string> | null = null
  private pendingPassword: Deferred<string> | null = null

  constructor(
    private readonly store: TelegramStore,
    private readonly emit: Emit
  ) {}

  get current(): TelegramStatus {
    return this.status
  }

  private setStatus(s: TelegramStatus) {
    this.status = s
    this.emit.status(s)
  }

  private newClient(apiId: number, apiHash: string, session = ''): TelegramClient {
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 10,
      autoReconnect: true,
      deviceModel: 'MemeBot Engine',
      appVersion: '0.2'
    })
    client.setLogLevel(LogLevel.ERROR)
    return client
  }

  /** Kayıtlı Telegram oturumunu açar (motor başlarken). */
  async attach(): Promise<TelegramStatus> {
    if (this.client) return this.status
    const secret = this.store.load()
    if (!secret) {
      this.setStatus({ state: 'needs_setup' })
      return this.status
    }
    this.setStatus({ state: 'connecting' })
    const client = this.newClient(secret.apiId, secret.apiHash, secret.session)
    this.client = client
    try {
      await client.connect()
      if (!(await client.checkAuthorization())) {
        this.store.clear()
        await client.disconnect()
        this.client = null
        this.setStatus({ state: 'disconnected', reason: 'Telegram oturumu sonlanmış, yeniden bağlanın.' })
        return this.status
      }
      await this.onAuthorized(client)
    } catch (e) {
      this.setStatus({ state: 'disconnected', reason: (e as Error).message })
    }
    return this.status
  }

  /** Motor kapanırken: bağlantıyı kapatır, oturumu silmez. */
  async detach(): Promise<void> {
    this.pendingCode?.reject(new Error('iptal'))
    this.pendingPassword?.reject(new Error('iptal'))
    this.pendingCode = this.pendingPassword = null
    const c = this.client
    this.client = null
    if (c) await c.destroy().catch(() => undefined)
  }

  async startLogin(apiId: number, apiHash: string, phone: string): Promise<void> {
    if (!Number.isInteger(apiId) || apiId <= 0 || !/^[0-9a-f]{32}$/i.test(apiHash)) {
      throw new Error('API ID sayı, API Hash 32 karakterlik bir kod olmalı (my.telegram.org)')
    }
    if (this.client) await this.client.destroy().catch(() => undefined)
    const client = this.newClient(apiId, apiHash)
    this.client = client
    this.setStatus({ state: 'connecting' })

    // start() kod ve şifreyi callback ile ister; arayüzden gelene kadar bekletiyoruz.
    // Yanlış kod/şifrede GramJS onError'u çağırıp aynı adımı tekrar sorar.
    let lastError: string | undefined
    const takeError = () => {
      const e = lastError
      lastError = undefined
      return e
    }
    client
      .start({
        phoneNumber: phone.replace(/\s+/g, ''),
        phoneCode: (viaApp) => {
          this.pendingCode = new Deferred<string>()
          this.setStatus({ state: 'code', viaApp: Boolean(viaApp), error: takeError() })
          return this.pendingCode.promise
        },
        password: (hint) => {
          this.pendingPassword = new Deferred<string>()
          this.setStatus({ state: 'password', hint, error: takeError() })
          return this.pendingPassword.promise
        },
        // Bu numaranın Telegram hesabı yoksa yeni hesap AÇMA.
        firstAndLastNames: async () => {
          throw new Error(NO_ACCOUNT)
        },
        onError: async (err) => {
          // Giriş iptal edildi ya da yeni bir giriş başlatıldı → döngüyü durdur
          if (this.client !== client || err.message === NO_ACCOUNT) return true
          lastError = translateError(err)
          return false
        }
      })
      .then(async () => {
        if (this.client !== client) return
        this.store.save({ apiId, apiHash, session: client.session.save() as unknown as string })
        await this.onAuthorized(client)
      })
      .catch((e: Error) => {
        if (this.client !== client) return
        this.client = null
        client.destroy().catch(() => undefined)
        this.setStatus({ state: 'disconnected', reason: e.message === NO_ACCOUNT || e.message === 'AUTH_USER_CANCEL' ? (lastError ?? 'Bu numaraya ait Telegram hesabı yok.') : translateError(e) })
      })
  }

  submitCode(code: string) {
    this.pendingCode?.resolve(code.trim())
  }

  submitPassword(password: string) {
    this.pendingPassword?.resolve(password)
  }

  async logout(): Promise<void> {
    const c = this.client
    if (c) {
      await c.invoke(new Api.auth.LogOut()).catch(() => undefined)
      await c.destroy().catch(() => undefined)
    }
    this.client = null
    this.store.clear()
    this.setStatus({ state: 'needs_setup' })
  }

  async listChats(): Promise<TelegramChat[]> {
    if (!this.client || this.status.state !== 'connected') throw new Error('Telegram bağlı değil')
    const dialogs = await this.client.getDialogs({ limit: 500 })
    return dialogs
      .filter((d) => (d.isChannel || d.isGroup) && d.id)
      .map((d) => ({
        id: d.id!.toString(),
        title: d.title ?? d.name ?? 'İsimsiz',
        kind: d.isChannel && !d.isGroup ? ('channel' as const) : ('group' as const)
      }))
  }

  setWatched(chatIds: string[]) {
    this.watched = new Set(chatIds)
  }

  private async onAuthorized(client: TelegramClient) {
    const me = (await client.getMe()) as Api.User
    const handle = (event: NewMessageEvent | EditedMessageEvent, edited: boolean) => {
      const msg = event.message
      const chatId = msg.chatId?.toString()
      if (!chatId || !this.watched.has(chatId)) return
      const text = messageText(msg)
      if (!text) return
      this.emit.message({ chatId, msgId: msg.id, text, date: msg.date, receivedAt: Date.now(), edited })
    }
    client.addEventHandler((e: NewMessageEvent) => handle(e, false), new NewMessage({}))
    client.addEventHandler((e: EditedMessageEvent) => handle(e, true), new EditedMessage({}))
    this.setStatus({ state: 'connected', me: me.username ? `@${me.username}` : [me.firstName, me.lastName].filter(Boolean).join(' ') })
  }
}
