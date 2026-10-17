import { Trophy } from 'lucide-react'
import { useDashboardData, useDashMode } from '../../lib/dashboard'
import { useNav } from '../../lib/nav'
import { usePipeline } from '../../lib/pipeline'
import { CallerManager, TopCallers } from '../../components/Callers'
import { Card, ModeSwitch } from '../../components/DashWidgets'
import { Section } from '../../components/ui'

// Çağrıcılar: Telegram gruplarında token paylaşan kişilerin başarısı ve kuralları.

export function CallersSection() {
  const data = useDashboardData()
  const [mode, setMode] = useDashMode()
  const { go } = useNav()
  const { rule } = usePipeline()
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <ModeSwitch mode={mode} onChange={setMode} />
        <button className="btn btn-sm btn-ghost" onClick={() => go('settings', 'rules')}>
          Otomatik alım ayarları (Kurallar)
        </button>
      </div>
      <Card title="En çok kazandıran 10 kişi" icon={<Trophy size={13} />}>
        {data.loaded ? <TopCallers data={data} mode={mode} /> : <p className="faint">Yükleniyor…</p>}
      </Card>
      <Section
        icon={Trophy}
        title="Kişiler ve kurallar"
        note={
          rule.limits.autoOnlyTrusted
            ? `Otomatik modda yalnızca “Güvenilir” kişilerin grup çağrıları otomatik alınır (güvenilirlerde alım tutarı ×${rule.limits.trustedBuyMult}); diğerleri onaya düşer.`
            : 'Otomatik alımı yalnızca güvenilir kişilere sınırlamak için Kurallar → İşlem bölümündeki seçeneği açın.'
        }
      >
        {data.loaded ? <CallerManager data={data} mode={mode} /> : <p className="faint">Yükleniyor…</p>}
      </Section>
    </div>
  )
}
