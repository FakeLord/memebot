import { useEffect, useState } from 'react'
import { ArrowRight, Download, Keyboard, Lock, Presentation, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { ROLE_LABEL, useAuth } from '../../lib/auth'
import { useEngine } from '../../lib/engine'
import { useNav } from '../../lib/nav'
import { APP_VERSION, desktop } from '../../lib/platform'
import { Section, SettingRow, Stat, StatusPill, Toggle } from '../../components/ui'
import { setDemo, useDemoMode } from '../../lib/demo'
import type { UpdateStatus } from '../../../../shared/types'

// Hakkında: sürüm, güncelleme, uygulamanın para güvenliği sözleşmeleri.

const SAFETY: { title: string; desc: string }[] = [
  { title: 'Emir başına mutlak sınır', desc: 'Hiçbir emir 5 SOL\'u geçemez; kurallardaki tutarlar bunun altında kalır.' },
  { title: 'Kesinleşmeden pozisyon yok', desc: 'Zincirde "confirmed" görülmeden pozisyon açılmaz.' },
  { title: 'Başarısız işlem tekrar denenmez', desc: 'Para harcayan istekler otomatik yeniden gönderilmez; her emirde tekil anahtar var.' },
  { title: 'Kill switch', desc: 'Founder durdurunca yeni alım yapılmaz; satış serbest kalır.' },
  { title: 'Sırlar motorda', desc: 'API anahtarları arayüzden mühürlü zarfla gider, motorun kasasında şifreli saklanır.' }
]

export function AboutSection() {
  const { profile } = useAuth()
  const { status } = useEngine()
  const { go } = useNav()
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const demo = useDemoMode()

  useEffect(() => desktop?.updater.onStatus(setUpdate), [])

  const updateText =
    update.state === 'checking'
      ? 'Denetleniyor…'
      : update.state === 'available'
        ? `v${update.version} bulundu, iniyor`
        : update.state === 'downloading'
          ? `İndiriliyor %${update.percent}`
          : update.state === 'ready'
            ? `v${update.version} hazır — yeniden başlatınca kurulur`
            : update.state === 'none'
              ? 'Güncelsiniz'
              : update.state === 'error'
                ? `Hata: ${update.message}`
                : 'Uygulama açılışta ve arka planda kendiliğinden denetler'

  return (
    <div>
      <div className="row" style={{ gap: 14, marginBottom: 18 }}>
        <span className="page-head-icon" style={{ width: 48, height: 48, background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent' }}>
          <Sparkles size={22} />
        </span>
        <div>
          <h3 style={{ fontSize: 18 }}>MemeBot</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Telegram ve X sinyallerinden GMGN üzerinden meme coin alım-satımı
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Stat label="Uygulama" value={<span className="mono">v{APP_VERSION}</span>} />
        <Stat label="Platform" value={desktop ? 'Masaüstü' : 'Web'} />
        <Stat label="Motor" value={<span className="mono">{status?.version ?? '—'}</span>} />
        <Stat label="Rolünüz" value={profile ? ROLE_LABEL[profile.role] : '—'} />
      </div>

      <Section icon={Presentation} title="Demo modu" note="Demo modunda Dashboard, ana sayfa panelleri, Pozisyonlar ve Akış örnek veriyle dolar. Hiçbir şey kaydedilmez, alım-satım kapalıdır; kapatınca gerçek verileriniz görünür.">
        <SettingRow title="Örnek veriyle göster" desc={demo ? 'Açık: ekrandaki veriler örnektir' : 'Kapalı: gerçek verileriniz görünüyor'}>
          <Toggle checked={demo} onChange={setDemo} />
        </SettingRow>
      </Section>

      <Section icon={Download} title="Güncellemeler">
        {desktop ? (
          <SettingRow title="Masaüstü güncellemesi" desc={updateText}>
            {update.state === 'ready' ? (
              <button className="btn btn-sm btn-primary" onClick={() => desktop?.updater.install()}>
                Yeniden başlat
              </button>
            ) : (
              <button className="btn btn-sm" disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => desktop?.updater.check()}>
                <RefreshCw size={13} className={update.state === 'checking' ? 'spin' : undefined} /> Denetle
              </button>
            )}
          </SettingRow>
        ) : (
          <SettingRow title="Web sürümü" desc="Her yayında kendiliğinden güncellenir; sayfayı yenilemeniz yeterli">
            <StatusPill tone="on">Güncel</StatusPill>
          </SettingRow>
        )}
      </Section>

      <Section icon={ShieldCheck} title="Para güvenliği">
        <div className="list">
          {SAFETY.map((s) => (
            <div key={s.title} className="list-row">
              <span className="faint">
                <Lock size={13} />
              </span>
              <div className="list-row-main">
                <span className="list-row-title">{s.title}</span>
                <span className="list-row-sub">{s.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Keyboard} title="Kısayollar">
        <SettingRow title="Klavye kısayolları" desc="Preset değiştirme, sayfalar arası geçiş, deploy formu">
          <button className="btn btn-sm" onClick={() => go('settings', 'shortcuts')}>
            Aç <ArrowRight size={12} />
          </button>
        </SettingRow>
      </Section>
    </div>
  )
}
