// Bildirim sesleri. Öncelik sırası:
//  1) Ayarlar → Bildirimler'den yüklenen ses dosyası (bu cihazda saklanır)
//  2) src/renderer/src/assets/sounds/<olay>.mp3|wav|ogg (uygulamayla birlikte paketlenir; olay: buy, sell, x, telegram)
//  3) Yedek: Web Audio ile üretilen klasik, sade bildirim sesleri

export type SoundKind = 'buy' | 'sell' | 'x' | 'telegram'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null // ses kapalı / desteklenmiyor
  }
}

function noiseBuf(ac: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noise
}

/** Kısa gürültü patlaması (filtreli, üstel sönümlü). */
function burst(ac: AudioContext, out: AudioNode, t: number, dur: number, gain: number, filter: { type: BiquadFilterType; from: number; to?: number; q?: number }) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuf(ac)
  src.loop = true
  const f = ac.createBiquadFilter()
  f.type = filter.type
  f.Q.value = filter.q ?? 1
  f.frequency.setValueAtTime(filter.from, t)
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.02)
}

/** Sinüs/üçgen ton; isteğe bağlı frekans kayması. */
function tone(ac: AudioContext, out: AudioNode, t: number, dur: number, gain: number, f0: number, f1?: number, type: OscillatorType = 'sine', attack = 0.004) {
  const o = ac.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + dur + 0.02)
}

/** Çan benzeri "ting": üst tonlar tam katlı olmadığı için metalik, çabuk sönen temiz bir ses. */
function bell(ac: AudioContext, out: AudioNode, t: number, f: number, gain: number, decay = 0.5) {
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.76, 0.45, 0.6],
    [5.4, 0.2, 0.35],
    [8.93, 0.08, 0.2]
  ]
  for (const [mult, amp, len] of partials) tone(ac, out, t, decay * len + 0.05, gain * amp, f * mult, undefined, 'sine', 0.003)
}

// Klasik, sade bildirim sesleri (Web Audio ile üretilir):
//  alım: yükselen iki notalı "ding-ding" · satış: parlak "tink-tink" para tıngırtısı
//  X: kısa iki "tu-tu" · Telegram: yumuşak "pop-pop"
const SOUNDS: Record<SoundKind, (ac: AudioContext, out: AudioNode, t: number) => void> = {
  buy(ac, out, t) {
    bell(ac, out, t, 659, 0.5, 0.55) // mi
    bell(ac, out, t + 0.13, 880, 0.5, 0.7) // la
  },
  sell(ac, out, t) {
    bell(ac, out, t, 1976, 0.4, 0.28) // si
    bell(ac, out, t + 0.085, 2637, 0.4, 0.4) // mi (yüksek)
  },
  x(ac, out, t) {
    tone(ac, out, t, 0.07, 0.35, 1500, 1900, 'sine', 0.008)
    tone(ac, out, t + 0.11, 0.09, 0.35, 1800, 2400, 'sine', 0.008)
  },
  telegram(ac, out, t) {
    tone(ac, out, t, 0.16, 0.4, 880, 1040, 'triangle', 0.006)
    tone(ac, out, t + 0.12, 0.22, 0.4, 1318, 1318, 'triangle', 0.006)
  }
}

// ---------------------------------------------------------------- gerçek ses dosyaları
const MAX_BYTES = 1_500_000
const MAX_SECONDS = 6
const DB = 'memebot-sounds'

// Paketlenen dosyalar base64 olarak derlemeye gömülür (dosya sistemi/CSP sorunu olmaz)
const bundledUrls = import.meta.glob('../assets/sounds/*.{mp3,wav,ogg,m4a}', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

const buffers: Partial<Record<SoundKind, AudioBuffer>> = {}
const sources: Partial<Record<SoundKind, 'custom' | 'bundled'>> = {}
let loading: Promise<void> | null = null

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sounds')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db()
    return await new Promise<T>((res, rej) => {
      const r = fn(d.transaction('sounds', mode).objectStore('sounds'))
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  } catch {
    return undefined // gizli pencere / depolama kapalı
  }
}

function dataUrlBytes(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  const ac = audio()
  if (!ac) return null
  try {
    const b = await ac.decodeAudioData(bytes.slice(0))
    return b.duration <= MAX_SECONDS ? b : null
  } catch {
    return null
  }
}

/** Yüklenen (öncelikli) ya da paketlenen ses dosyalarını çözer. Birden çok kez çağrılabilir. */
export function loadSounds(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = (async () => {
    for (const kind of ['buy', 'sell', 'x', 'telegram'] as SoundKind[]) {
      delete buffers[kind]
      delete sources[kind]
      const saved = (await idb<{ name: string; bytes: ArrayBuffer }>('readonly', (s) => s.get(kind) as IDBRequest<{ name: string; bytes: ArrayBuffer }>)) ?? undefined
      const custom = saved ? await decode(saved.bytes) : null
      if (custom) {
        buffers[kind] = custom
        sources[kind] = 'custom'
        continue
      }
      const url = Object.entries(bundledUrls).find(([path]) => new RegExp(`/${kind}\\.[a-z0-9]+$`, 'i').test(path))?.[1]
      const bundled = url ? await decode(dataUrlBytes(url)) : null
      if (bundled) {
        buffers[kind] = bundled
        sources[kind] = 'bundled'
      }
    }
  })()
  return loading
}

/** Olay için hangi kaynak kullanılıyor: yüklenen dosya, paketlenen dosya ya da yedek (üretilen) ses. */
export const soundSource = (kind: SoundKind): 'custom' | 'bundled' | 'synth' => sources[kind] ?? 'synth'

/** Kullanıcının dosyasını bu cihaza kaydeder. Hata metni ya da null döner. */
export async function saveCustomSound(kind: SoundKind, file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return 'Dosya en çok 1,5 MB olabilir.'
  const bytes = await file.arrayBuffer()
  const probe = await decode(bytes)
  if (!probe) return `Ses dosyası okunamadı ya da ${MAX_SECONDS} saniyeden uzun (mp3, wav, ogg desteklenir).`
  await idb('readwrite', (s) => s.put({ name: file.name, bytes }, kind))
  await loadSounds(true)
  return null
}

export async function clearCustomSound(kind: SoundKind): Promise<void> {
  await idb('readwrite', (s) => s.delete(kind))
  await loadSounds(true)
}

export async function customSoundName(kind: SoundKind): Promise<string | null> {
  const saved = await idb<{ name: string }>('readonly', (s) => s.get(kind) as IDBRequest<{ name: string }>)
  return saved?.name ?? null
}

// Üretilen sesler benzer yükseklikte duyulsun (çevrimdışı ölçümle ayarlandı); silah sesi kırpılmasın
const LEVEL: Record<SoundKind, number> = { buy: 1.0, sell: 1.4, x: 2.5, telegram: 2.2 }

/** Sesi çalar. volume: 0–1. */
export function playSound(kind: SoundKind, volume = 0.6): void {
  const ac = audio()
  if (!ac) return
  void loadSounds()
  const v = Math.max(0, Math.min(1, volume))
  const master = ac.createGain()
  master.connect(ac.destination)
  const file = buffers[kind]
  if (file) {
    master.gain.value = v
    const src = ac.createBufferSource()
    src.buffer = file
    src.connect(master)
    src.start()
    return
  }
  master.gain.value = v * 0.9 * LEVEL[kind]
  SOUNDS[kind](ac, master, ac.currentTime + 0.01)
}
