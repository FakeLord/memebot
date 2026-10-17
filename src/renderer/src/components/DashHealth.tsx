import { useNav } from '../lib/nav'
import { useEngine } from '../lib/engine'
import { usePipeline } from '../lib/pipeline'
import { useKillSwitch } from '../lib/killswitch'
import { spentToday, type DOrder, type Mode, type PnlSummary } from '../../../shared/dashboard'
import type { TelegramStatus } from '../../../shared/types'
import type { DashGmgn } from '../../../shared/engine'
import { sol, ago } from './DashWidgets'
import { StatusPill } from './ui'

// Sistem sağlığı: motor, GMGN, kaynaklar, mod ve günlük limitler. Sorun varsa uyarı satırı olarak da döner.

type Tone = 'on' | 'off' | 'wait'
interface Row {
  label: string
  value: string
  tone: Tone
  go?: () => void
}

export interface Alert {
  text: string
  level: 'error' | 'warn'
  go?: () => void
}

export function useHealth(orders: DOrder[], summary: PnlSummary, mode: Mode, dash: DashGmgn | null) {
  const { online, status, me } = useEngine()
  const { rule, state, lastError } = usePipeline()
  const kill = useKillSwitch()
  const { go } = useNav()
  const l = rule.limits
  const tg = (me?.telegram && 'state' in me.telegram ? me.telegram : { state: 'needs_setup' }) as TelegramStatus
  const ts = me?.x?.ts
  const x = me?.x ?? {}
  const spent = spentToday(orders, mode)
  const lossToday = Math.max(0, -summary.today)

  const rows: Row[] = [
    { label: 'Motor', value: online ? `Çalışıyor${status?.gmgn_latency_ms != null ? ` · GMGN ${status.gmgn_latency_ms} ms` : ''}` : 'Kapalı', tone: online ? 'on' : 'off', go: () => go('settings', 'connections') },
    {
      label: 'GMGN',
      value: !me?.gmgn.configured ? 'Anahtar yok' : dash?.error ? 'Veri hatası' : state === 'no_key' ? 'Anahtar yok' : 'Bağlı',
      tone: !me?.gmgn.configured || state === 'no_key' ? 'off' : dash?.error ? 'wait' : 'on',
      go: () => go('settings', 'connections')
    },
    {
      label: 'X (TweetStream)',
      value: !ts?.configured ? 'Kurulmadı' : ts.state === 'live' ? `Canlı${ts.lastLatencyMs != null ? ` · ${ts.lastLatencyMs} ms` : ''}` : ts.state === 'error' ? 'Hata' : 'Bağlanıyor',
      tone: ts?.state === 'live' ? 'on' : ts?.configured && ts.state !== 'error' ? 'wait' : 'off',
      go: () => go('settings', 'sources')
    },
    { label: 'X (XFlux)', value: !x.configured ? 'Kurulmadı' : x.state === 'polling' ? 'Çalışıyor' : x.state === 'error' ? 'Hata' : 'Başlıyor', tone: x.state === 'polling' ? 'on' : x.configured && x.state !== 'error' ? 'wait' : 'off', go: () => go('settings', 'sources') },
    { label: 'Telegram', value: tg.state === 'connected' ? 'Bağlı' : tg.state === 'needs_setup' ? 'Kurulmadı' : 'Bağlı değil', tone: tg.state === 'connected' ? 'on' : tg.state === 'connecting' ? 'wait' : 'off', go: () => go('settings', 'sources') }
  ]

  const alerts: Alert[] = []
  if (!online) alerts.push({ text: 'Motor çalışmıyor: sinyaller işlenmiyor, alım-satım yapılamaz.', level: 'error', go: () => go('settings', 'connections') })
  if (kill) alerts.push({ text: 'İşlemler durduruldu (kill switch açık).', level: 'warn' })
  if (online && !me?.gmgn.configured) alerts.push({ text: 'GMGN anahtarı yok: güvenlik kontrolü ve işlem yapılamaz.', level: 'error', go: () => go('settings', 'connections') })
  if (ts?.configured && ts.state === 'error') alerts.push({ text: `TweetStream: ${ts.error ?? 'hata'}`, level: 'error', go: () => go('settings', 'sources') })
  if (ts?.configured && ts.limit && (ts.count ?? 0) >= ts.limit) alerts.push({ text: `TweetStream hesap sınırı doldu (${ts.count}/${ts.limit}).`, level: 'warn', go: () => go('settings', 'sources') })
  if (dash?.error) alerts.push({ text: `GMGN dashboard verisi: ${dash.error}`, level: 'warn' })
  if (lastError && state !== 'no_key') alerts.push({ text: `Güvenlik kontrolü hatası: ${lastError}`, level: 'warn' })
  if (l.dailyMaxSol > 0 && spent >= l.dailyMaxSol * 0.8 && mode !== 'dry') alerts.push({ text: `Günlük harcama sınırına yaklaştı (${sol(spent)} / ${sol(l.dailyMaxSol)}).`, level: 'warn', go: () => go('settings', 'rules') })
  if (l.dailyLossLimitSol > 0 && lossToday >= l.dailyLossLimitSol * 0.8 && mode !== 'dry') alerts.push({ text: `Günlük zarar sınırına yaklaştı (${sol(lossToday)} / ${sol(l.dailyLossLimitSol)}).`, level: 'warn', go: () => go('settings', 'rules') })
  if (rule.mode === 'auto' && l.liveTrading) alerts.push({ text: 'Otomatik mod GERÇEK işlemde: onay beklenmeden alım yapılır.', level: 'warn', go: () => go('settings', 'rules') })

  return { rows, alerts, spent, lossToday, limits: l, mode: rule.mode, kill }
}

export function HealthList({ health, compact }: { health: ReturnType<typeof useHealth>; compact?: boolean }) {
  const { rows, limits: l, spent, lossToday, kill } = health
  const { rule } = usePipeline()
  const { status } = useEngine()
  return (
    <div className="plist">
      {rows.map((r) => (
        <button key={r.label} className="prow clickable" onClick={r.go} disabled={!r.go}>
          <div className="prow-main">
            <span>{r.label}</span>
          </div>
          <div className="prow-pnl">
            <StatusPill tone={r.tone}>{r.value}</StatusPill>
          </div>
        </button>
      ))}
      <div className="prow static">
        <div className="prow-main">
          <span>Mod</span>
        </div>
        <div className="prow-pnl">
          <span className={`badge ${l.liveTrading ? 'fail' : 'warn'}`}>{l.liveTrading ? 'GERÇEK' : 'DENEME'}</span>
          <span className="faint" style={{ fontSize: 11 }}>
            {rule.mode === 'auto' ? 'otomatik' : rule.mode === 'manual' ? 'manuel' : 'izle'}
            {kill ? ' · DURDU' : ''}
          </span>
        </div>
      </div>
      {!compact && (
        <>
          <div className="prow static">
            <div className="prow-main">
              <span>Bugün harcanan</span>
            </div>
            <div className="prow-pnl">
              <b className="mono">
                {sol(spent)} <span className="faint">/ {sol(l.dailyMaxSol)}</span>
              </b>
              <Bar v={spent} max={l.dailyMaxSol} />
            </div>
          </div>
          <div className="prow static">
            <div className="prow-main">
              <span>Bugünkü zarar</span>
            </div>
            <div className="prow-pnl">
              <b className="mono">
                {sol(lossToday)} <span className="faint">/ {sol(l.dailyLossLimitSol)}</span>
              </b>
              <Bar v={lossToday} max={l.dailyLossLimitSol} bad />
            </div>
          </div>
          <div className="prow static">
            <div className="prow-main">
              <span>Motor sürümü</span>
            </div>
            <div className="prow-pnl">
              <span className="mono faint">{status?.version ?? '—'}</span>
              <span className="faint" style={{ fontSize: 11 }}>
                son sinyal {status ? ago(status.heartbeat_at) : '—'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Bar({ v, max, bad }: { v: number; max: number; bad?: boolean }) {
  const r = max > 0 ? Math.min(1, v / max) : 0
  return (
    <span className="limit-track">
      <span className={`limit-fill ${bad ? 'bad' : ''} ${r >= 0.8 ? 'hot' : ''}`} style={{ width: `${r * 100}%` }} />
    </span>
  )
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null
  return (
    <div className="alerts">
      {alerts.map((a, i) => (
        <button key={i} className={`alert ${a.level}`} onClick={a.go} disabled={!a.go}>
          {a.text}
        </button>
      ))}
    </div>
  )
}
