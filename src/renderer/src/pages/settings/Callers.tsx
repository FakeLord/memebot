import { Trophy } from 'lucide-react'
import { useDashboardData, useDashMode } from '../../lib/dashboard'
import { useNav } from '../../lib/nav'
import { usePipeline } from '../../lib/pipeline'
import { CallerManager, TopCallers } from '../../components/Callers'
import { Card, ModeSwitch } from '../../components/DashWidgets'
import { Section } from '../../components/ui'

// Çağrıcılar: Telegram gruplarında token paylaşan kişilerin ve izlenen X hesaplarının başarısı, kuralları ve alım tutarları.

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
            ? `Otomatik modda yalnızca “Otomatik al” kişilerin çağrıları otomatik alınır; diğerleri onaya düşer. Her kişiye ayrı alım tutarı verebilirsiniz.`
            : 'Her Telegram üyesi ve X hesabı için kural (Engelli / Onaya düşsün / Otomatik al) ve kişiye özel alım tutarı seçin. Otomatik alımı yalnız seçtiğiniz kişilerle sınırlamak için Kurallar → İşlem bölümündeki seçeneği açın.'
        }
      >
        {data.loaded ? <CallerManager data={data} mode={mode} /> : <p className="faint">Yükleniyor…</p>}
      </Section>
    </div>
  )
}
