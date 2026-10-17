import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Play, RotateCcw, Upload, Volume2 } from 'lucide-react'
import { usePrefs } from '../../lib/prefs'
import { useNav } from '../../lib/nav'
import { announce, askDesktopPermission, desktopPermission, NOTIFY_EVENTS, notifyPrefs, type NotifyPrefs } from '../../lib/notify'
import { clearCustomSound, customSoundName, loadSounds, saveCustomSound, soundSource, type SoundKind } from '../../lib/sounds'
import { Section, SettingRow, Toggle } from '../../components/ui'

// Bildirimler: alım/satım/X/Telegram için ses ve masaüstü bildirimi.

const SAMPLE: Record<string, [string, string]> = {
  buy: ['Alım gerçekleşti (deneme)', 'DOG · 0.100 SOL'],
  sell: ['Satış gerçekleşti (deneme)', 'DOG'],
  x: ['Demo Hesap', 'Yeni bir şey geliyor $CAT "CAT to the moon"'],
  telegram: ['Demo Grup', 'Yeni token: CA DeET…m5kv']
}

export function NotificationsSection() {
  const { layout, setLayout } = usePrefs()
  const { go } = useNav()
  const prefs = notifyPrefs(layout.notify)
  const [perm, setPerm] = useState(desktopPermission())
  useEffect(() => setPerm(desktopPermission()), [])

  // Hangi olayda hangi ses kullanılıyor (yüklenen dosya / paketlenen / üretilen yedek)
  const [names, setNames] = useState<Partial<Record<SoundKind, string | null>>>({})
  const [, bump] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<SoundKind | null>(null)
  const refresh = async () => {
    await loadSounds()
    const out: Partial<Record<SoundKind, string | null>> = {}
    for (const ev of NOTIFY_EVENTS) out[ev.id] = await customSoundName(ev.id)
    setNames(out)
    bump((n) => n + 1)
  }
  useEffect(() => {
    void refresh()
  }, [])
  const pick = (id: SoundKind) => {
    pending.current = id
    fileRef.current?.click()
  }
  const onFile = async (file: File | undefined) => {
    const id = pending.current
    if (!file || !id) return
    setErr(null)
    const e = await saveCustomSound(id, file)
    if (e) setErr(e)
    await refresh()
    if (!e) announce(id, { ...prefs, [id]: { sound: true, desktop: false } }, '', '', { force: true })
  }
  const label = (id: SoundKind) => {
    const src = soundSource(id)
    return src === 'custom' ? `Yüklenen: ${names[id] ?? 'dosya'}` : src === 'bundled' ? 'Uygulamayla gelen ses dosyası' : 'Yedek (üretilen) ses'
  }

  const save = (patch: Partial<NotifyPrefs>) => setLayout({ ...layout, notify: { ...prefs, ...patch } })
  const setEvent = (id: 'buy' | 'sell' | 'x' | 'telegram', patch: Partial<NotifyPrefs['buy']>) => save({ [id]: { ...prefs[id], ...patch } })

  const test = async (id: (typeof NOTIFY_EVENTS)[number]['id']) => {
    // Deneme her zaman çalar (ayar kapalı olsa da ses duyulsun); masaüstü yalnızca açıksa gösterilir
    if (prefs[id].desktop) setPerm(await askDesktopPermission())
    const [title, body] = SAMPLE[id]
    announce(id, { ...prefs, [id]: { sound: true, desktop: prefs[id].desktop } }, title, body, { force: true })
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section icon={Volume2} title="Ses" note="Sesler uygulamanın içinde üretilir; ek dosya gerekmez.">
        <SettingRow title="Ses düzeyi" desc={`%${Math.round(prefs.volume * 100)}`}>
          <input type="range" min={0} max={1} step={0.05} value={prefs.volume} style={{ width: 160 }} onChange={(e) => save({ volume: Number(e.target.value) })} />
        </SettingRow>
      </Section>

      <Section icon={Bell} title="Olaylar" note="Kendi sesinizi yükleyin (mp3, wav, ogg; en çok 6 sn). Yüklemezseniz yedek ses çalar. Ses bu cihazda saklanır.">
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
        {err && <div className="notice error">{err}</div>}
        {NOTIFY_EVENTS.map((ev) => (
          <SettingRow key={ev.id} title={ev.label} desc={`${ev.hint} · ${label(ev.id)}`}>
            <div className="row" style={{ gap: 14 }}>
              <label className="row" style={{ gap: 6, fontSize: 12 }}>
                Ses <Toggle checked={prefs[ev.id].sound} onChange={(v) => setEvent(ev.id, { sound: v })} />
              </label>
              <label className="row" style={{ gap: 6, fontSize: 12 }}>
                Masaüstü <Toggle checked={prefs[ev.id].desktop} onChange={(v) => setEvent(ev.id, { desktop: v })} />
              </label>
              <button className="btn btn-sm" onClick={() => test(ev.id)} title="Sesi ve bildirimi dene">
                <Play size={12} /> Dene
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => pick(ev.id)} title="Kendi ses dosyanızı seçin">
                <Upload size={12} /> Ses yükle
              </button>
              {soundSource(ev.id) === 'custom' && (
                <button className="btn btn-sm btn-ghost" onClick={async () => { await clearCustomSound(ev.id); await refresh() }} title="Yüklenen sesi kaldır">
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          </SettingRow>
        ))}
      </Section>

      <Section icon={BellRing} title="X ve Telegram kapsamı">
        <SettingRow title="Hangi gönderilerde bildirim gelsin?" desc="Seçtiğiniz kaynaklar Ayarlar → Kaynaklar / Hesaplar'da “bildirim” açık olanlar; anahtar kelimelerdeki bildirim/ses seçenekleri de bunlara dahildir." stacked>
          <div className="pills">
            <button className="pill" aria-selected={prefs.scope === 'flagged'} onClick={() => save({ scope: 'flagged' })}>
              Yalnız bildirimi açık kaynaklar
            </button>
            <button className="pill" aria-selected={prefs.scope === 'all'} onClick={() => save({ scope: 'all' })}>
              Tüm gönderiler
            </button>
          </div>
          {prefs.scope === 'all' && <p className="faint" style={{ fontSize: 11, margin: '6px 0 0' }}>Çok hesap izliyorsanız sık çalabilir; sessize alınan kaynaklar hariç tutulur, seri gönderilerde ses 1,2 saniyede bir çalar.</p>}
        </SettingRow>
      </Section>

      <Section icon={Bell} title="Masaüstü bildirim izni">
        <SettingRow
          title={perm === 'granted' ? 'İzin verildi' : perm === 'denied' ? 'İzin reddedildi' : perm === 'unsupported' ? 'Bu ortam bildirimi desteklemiyor' : 'İzin gerekli'}
          desc={perm === 'denied' ? 'Tarayıcı/işletim sistemi ayarlarından MemeBot için bildirimlere izin verin.' : 'Masaüstü bildirimleri için bir kez izin verilmesi gerekir.'}
        >
          {perm === 'default' && (
            <button className="btn btn-sm btn-primary" onClick={async () => setPerm(await askDesktopPermission())}>
              İzin ver
            </button>
          )}
        </SettingRow>
        <button className="link faint" style={{ fontSize: 11 }} onClick={() => go('settings', 'accounts')}>
          Hangi hesapların bildirimi açık? → Hesaplar
        </button>
      </Section>
    </div>
  )
}
