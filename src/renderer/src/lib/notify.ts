import { playSound, type SoundKind } from './sounds'

// Bildirim ayarları (Ayarlar → Bildirimler): olay başına ses ve masaüstü bildirimi.

export interface EventNotify {
  sound: boolean
  desktop: boolean
}

export interface NotifyPrefs {
  /** 0–1 */
  volume: number
  buy: EventNotify
  sell: EventNotify
  x: EventNotify
  telegram: EventNotify
  /** X/Telegram gönderilerinde: yalnız bildirimi açık kaynaklar/anahtar kelimeler mi, tüm gönderiler mi */
  scope: 'flagged' | 'all'
}

export const DEFAULT_NOTIFY: NotifyPrefs = {
  volume: 0.6,
  buy: { sound: true, desktop: true },
  sell: { sound: true, desktop: true },
  x: { sound: true, desktop: true },
  telegram: { sound: true, desktop: true },
  scope: 'flagged'
}

export const NOTIFY_EVENTS: { id: SoundKind; label: string; hint: string }[] = [
  { id: 'buy', label: 'Alım', hint: 'Alım emri kesinleşince: tetik çekme sesi' },
  { id: 'sell', label: 'Satış', hint: 'Satış emri kesinleşince: silah sesi' },
  { id: 'x', label: 'X gönderisi', hint: 'Kuş cıvıltısı' },
  { id: 'telegram', label: 'Telegram mesajı', hint: 'Yumuşak zil sesi' }
]

export function notifyPrefs(saved: Partial<NotifyPrefs> | undefined): NotifyPrefs {
  const s = saved ?? {}
  return {
    volume: typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : DEFAULT_NOTIFY.volume,
    buy: { ...DEFAULT_NOTIFY.buy, ...s.buy },
    sell: { ...DEFAULT_NOTIFY.sell, ...s.sell },
    x: { ...DEFAULT_NOTIFY.x, ...s.x },
    telegram: { ...DEFAULT_NOTIFY.telegram, ...s.telegram },
    scope: s.scope === 'all' ? 'all' : 'flagged'
  }
}

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window
export const desktopPermission = (): NotificationPermission | 'unsupported' => (desktopSupported() ? Notification.permission : 'unsupported')

export async function askDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!desktopSupported()) return 'unsupported'
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

let lastSound = 0
let lastDesktop = 0

/**
 * Bir olayı duyurur: ayara göre ses ve/veya masaüstü bildirimi. Seri gönderilerde taşmasın diye
 * ses 1,2 sn'de, masaüstü bildirimi 0,8 sn'de bir kez çalar (alım/satış için sınır yok).
 */
export function announce(kind: SoundKind, prefs: NotifyPrefs, title: string, body: string, opts: { force?: boolean } = {}) {
  const ev = prefs[kind]
  const trade = kind === 'buy' || kind === 'sell'
  const now = Date.now()
  if (ev.sound && (trade || opts.force || now - lastSound > 1200)) {
    lastSound = now
    playSound(kind, prefs.volume)
  }
  if (ev.desktop && desktopSupported() && Notification.permission === 'granted' && (trade || opts.force || now - lastDesktop > 800)) {
    lastDesktop = now
    try {
      const n = new Notification(title, { body, silent: true, tag: `memebot-${kind}` })
      n.onclick = () => window.focus()
    } catch {
      /* bazı ortamlar bildirim oluşturmaya izin vermez */
    }
  }
}
