import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { FloatingPanel } from './FloatingPanel'
import { canTrade, ROLE_LABEL, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useEngine } from '../lib/engine'
import { usePipeline, type TradeMode } from '../lib/pipeline'
import { usePrefs } from '../lib/prefs'
import { useNav } from '../lib/nav'
import { THEMES, themeColors } from '../../../shared/settings'
import type { TelegramStatus } from '../../../shared/types'
import { since, StatusPill, Toggle } from './ui'
import { RAIL_WIDGETS, useRails, type WidgetId } from './DashRails'

// Alt çubuktaki kısayolların mini panelleri. Hepsi taşınabilir ve boyutlandırılabilir (FloatingPanel);
// tıklanan düğmenin üstünde açılır, aynı düğme ya da X ile kapanır. Birden fazlası aynı anda açık kalabilir.

export function Popover({
  title,
  onClose,
  left,
  width = 300,
  children
}: {
  title: string
  onClose: () => void
  left: number
  width?: number
  children: ReactNode
}) {
  return (
    <FloatingPanel id={title} title={title} anchorX={left} width={width} onClose={onClose}>
      {children}
    </FloatingPanel>
  )
}

function GoLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="popover-link" onClick={onClick}>
      {children} <ArrowRight size={12} />
    </button>
  )
}

// ---------------------------------------------------------------- bağlantı
export function ConnPanel({ connected, onClose, left }: { connected: boolean; onClose: () => void; left: number }) {
  const { profile } = useAuth()
  return (
    <Popover title="Bağlantı" onClose={onClose} left={left}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Gerçek zamanlı veri
        </span>
        <StatusPill tone={connected ? 'on' : 'off'}>{connected ? 'Bağlı' : 'Kopuk'}</StatusPill>
      </div>
      <dl className="kv">
        <dt>Kullanıcı</dt>
        <dd>{profile?.username}</dd>
        <dt>Rol</dt>
        <dd>{profile ? ROLE_LABEL[profile.role] : '—'}</dd>
      </dl>
      <p className="faint" style={{ fontSize: 11 }}>
        Bağlantı koparsa istemci kendiliğinden yeniden bağlanır; kartlar ve emirler kaldığı yerden güncellenir.
      </p>
      {!connected && (
        <button className="btn btn-sm" onClick={() => window.location.reload()}>
          Sayfayı yenile
        </button>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------- motor
const TG_LABEL: Record<TelegramStatus['state'], string> = {
  needs_setup: 'Kurulmadı',
  connecting: 'Bağlanıyor',
  code: 'Kod bekleniyor',
  password: 'Şifre bekleniyor',
  connected: 'Bağlı',
  disconnected: 'Koptu'
}

export function EnginePanel({ onClose, left }: { onClose: () => void; left: number }) {
  const { online, status, me } = useEngine()
  const { go } = useNav()
  const tg = (me?.telegram && 'state' in me.telegram ? me.telegram : { state: 'needs_setup' }) as TelegramStatus
  const x = me?.x ?? {}
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(t)
  }, [])
  return (
    <Popover title="Motor" onClose={onClose} left={left}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {status?.host ? status.host : 'Konum bilinmiyor'}
        </span>
        <StatusPill tone={online ? 'on' : 'off'}>{online ? 'Çalışıyor' : 'Kapalı'}</StatusPill>
      </div>
      <dl className="kv">
        <dt>Sürüm</dt>
        <dd className="mono">{status?.version ?? '—'}</dd>
        <dt>Açılış</dt>
        <dd>{since(status?.started_at)}</dd>
        <dt>Son sinyal</dt>
        <dd>{since(status?.heartbeat_at)}</dd>
        <dt>GMGN gecikmesi</dt>
        <dd className={status?.gmgn_latency_ms != null ? 'pos' : ''}>{status?.gmgn_latency_ms != null ? `${status.gmgn_latency_ms} ms` : '—'}</dd>
      </dl>
      <div className="mini-list" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <div className="mini-row">
          <span style={{ flex: 1 }}>GMGN anahtarı</span>
          <StatusPill tone={me?.gmgn.configured ? 'on' : 'off'}>{me?.gmgn.configured ? 'Kayıtlı' : 'Yok'}</StatusPill>
        </div>
        <div className="mini-row">
          <span style={{ flex: 1 }}>Telegram</span>
          <StatusPill tone={tg.state === 'connected' ? 'on' : tg.state === 'connecting' ? 'wait' : 'off'}>{TG_LABEL[tg.state]}</StatusPill>
        </div>
        <div className="mini-row">
          <span style={{ flex: 1 }}>X (TweetStream)</span>
          <StatusPill tone={x.ts?.state === 'live' ? 'on' : x.ts?.state === 'connecting' || x.ts?.state === 'reconnecting' ? 'wait' : 'off'}>
            {!x.ts?.configured ? 'Kurulmadı' : x.ts.state === 'live' ? `Canlı${x.ts.lastLatencyMs != null ? ` · ${x.ts.lastLatencyMs} ms` : ''}` : x.ts.state === 'error' ? 'Hata' : 'Bağlanıyor'}
          </StatusPill>
        </div>
        <div className="mini-row">
          <span style={{ flex: 1 }}>X (XFlux)</span>
          <StatusPill tone={x.state === 'polling' ? 'on' : x.state === 'starting' ? 'wait' : 'off'}>
            {!x.configured ? 'Kurulmadı' : x.state === 'polling' ? 'Çalışıyor' : x.state === 'error' ? 'Hata' : 'Başlıyor'}
          </StatusPill>
        </div>
      </div>
      <GoLink
        onClick={() => {
          onClose()
          go('settings', 'connections')
        }}
      >
        GMGN ve motor ayarları
      </GoLink>
    </Popover>
  )
}

// ---------------------------------------------------------------- geçmiş (son emirler)
interface OrderLite {
  id: string
  side: 'buy' | 'sell'
  mint: string
  symbol: string | null
  amount_in: string
  sell_percent: number | null
  status: string
  is_dry_run: boolean
  created_at: string
}

const ORDER_TONE: Record<string, 'on' | 'off' | 'wait'> = { confirmed: 'on', failed: 'off', expired: 'off' }
const ORDER_LABEL: Record<string, string> = {
  created: 'Hazır',
  submitted: 'Gönderildi',
  pending: 'Bekliyor',
  processed: 'İşlendi',
  confirmed: 'Kesin',
  failed: 'Başarısız',
  expired: 'Süresi doldu'
}

export function HistoryPanel({ onClose, left }: { onClose: () => void; left: number }) {
  const { profile } = useAuth()
  const { go } = useNav()
  const [rows, setRows] = useState<OrderLite[] | null>(null)
  useEffect(() => {
    if (!profile) return
    supabase
      .from('orders')
      .select('id, side, mint, symbol, amount_in, sell_percent, status, is_dry_run, created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setRows((data as OrderLite[]) ?? []))
  }, [profile?.id])
  return (
    <Popover title="Son emirler" onClose={onClose} left={left} width={340}>
      {rows === null ? (
        <p className="faint" style={{ fontSize: 12 }}>
          Yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <p className="faint" style={{ fontSize: 12 }}>
          Henüz emir yok.
        </p>
      ) : (
        <div className="mini-list">
          {rows.map((o) => (
            <div key={o.id} className="mini-row">
              <span className={`badge ${o.side === 'buy' ? 'pass' : 'fail'}`} style={{ minWidth: 38, justifyContent: 'center' }}>
                {o.side === 'buy' ? 'AL' : 'SAT'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }} className="ellipsis">
                <b>{o.symbol ?? `${o.mint.slice(0, 4)}…`}</b>{' '}
                <span className="mono faint">{o.side === 'buy' ? `${+(Number(o.amount_in) / 1e9).toFixed(4)} SOL` : `%${o.sell_percent ?? 100}`}</span>
                {o.is_dry_run && <span className="faint"> · deneme</span>}
              </span>
              <StatusPill tone={ORDER_TONE[o.status] ?? 'wait'}>{ORDER_LABEL[o.status] ?? o.status}</StatusPill>
              <span className="faint" style={{ fontSize: 10.5, width: 52, textAlign: 'right' }}>
                {new Date(o.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
      <GoLink
        onClick={() => {
          onClose()
          go('orders')
        }}
      >
        Tüm emirler
      </GoLink>
    </Popover>
  )
}

// ---------------------------------------------------------------- işlem modu
const MODES: { value: TradeMode; label: string }[] = [
  { value: 'watch', label: 'İzle' },
  { value: 'manual', label: 'Manuel' },
  { value: 'auto', label: 'Otomatik' }
]

export function ModePanel({ onClose, left }: { onClose: () => void; left: number }) {
  const { profile } = useAuth()
  const { rule, saveRule } = usePipeline()
  const { go } = useNav()
  const [error, setError] = useState<string | null>(null)
  const editable = canTrade(profile?.role)
  const l = rule.limits

  const save = async (next: typeof rule) => setError(await saveRule(next))

  const setMode = (m: TradeMode) => {
    if (m === rule.mode) return
    if (m === 'auto') {
      if (!(l.autoBuySol > 0 && l.autoBuySol <= l.maxBuySol)) return setError('Önce Kurallar\'da geçerli bir otomatik alım tutarı girin.')
      if (!confirm(l.liveTrading ? 'Otomatik + GERÇEK işlem: güvenlikten geçen her token için onay sormadan gerçek SOL harcanacak. Emin misiniz?' : 'Otomatik mod deneme modunda çalışacak (para harcanmaz). Devam?'))
        return
    }
    save({ ...rule, mode: m })
  }

  const setLive = (on: boolean) => {
    if (on && !confirm("Gerçek mod açılırsa onayladığınız token'lar için GMGN cüzdanınızdan GERÇEK SOL harcanır. Emin misiniz?")) return
    save({ ...rule, limits: { ...l, liveTrading: on } })
  }

  return (
    <Popover title="İşlem modu" onClose={onClose} left={left}>
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.value} className={`seg-btn ${rule.mode === m.value ? 'on' : ''}`} disabled={!editable} onClick={() => setMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'grid', gap: 1 }}>
          <b style={{ fontSize: 12.5 }} className={l.liveTrading ? 'neg' : undefined}>
            Gerçek işlem
          </b>
          <span className="faint" style={{ fontSize: 11 }}>
            {l.liveTrading ? 'Onaylar gerçek SOL harcar' : 'Kapalı: sadece fiyat teklifi alınır'}
          </span>
        </span>
        <Toggle checked={l.liveTrading} disabled={!editable} onChange={setLive} />
      </div>
      <dl className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <dt>Günlük maks. harcama</dt>
        <dd className="mono">{l.dailyMaxSol} SOL</dd>
        <dt>Otomatik alım</dt>
        <dd className="mono">{l.autoBuySol} SOL</dd>
        <dt>Günlük zarar sınırı</dt>
        <dd className="mono">{l.dailyLossLimitSol} SOL</dd>
        <dt>Maks. açık pozisyon</dt>
        <dd className="mono">{l.maxOpenPositions}</dd>
      </dl>
      {error && <div className="notice error">{error}</div>}
      <GoLink
        onClick={() => {
          onClose()
          go('settings', 'rules')
        }}
      >
        Tüm kurallar
      </GoLink>
    </Popover>
  )
}

// ---------------------------------------------------------------- görünüm
export function ThemePanel({ onClose, left }: { onClose: () => void; left: number }) {
  const { theme, setTheme } = usePrefs()
  const { go } = useNav()
  const custom = themeColors({ ...theme, preset: 'custom' })
  return (
    <Popover title="Görünüm" onClose={onClose} left={left} width={320}>
      <div className="theme-grid mini">
        {Object.entries(THEMES).map(([id, t]) => (
          <button key={id} className="theme-tile" aria-pressed={theme.preset === id} onClick={() => setTheme({ preset: id })} title={t.label}>
            <span className="theme-swatch" style={{ background: t.colors.bg }}>
              <span className="theme-swatch-card" style={{ background: t.colors.surface, border: `1px solid ${t.colors.border}` }} />
              <span className="theme-swatch-dot" style={{ background: t.colors.accent }} />
            </span>
            <span className="theme-name">{t.label}</span>
          </button>
        ))}
        {theme.preset === 'custom' && (
          <button className="theme-tile" aria-pressed>
            <span className="theme-swatch" style={{ background: custom.bg }}>
              <span className="theme-swatch-card" style={{ background: custom.surface, border: `1px solid ${custom.border}` }} />
              <span className="theme-swatch-dot" style={{ background: custom.accent }} />
            </span>
            <span className="theme-name">Özel</span>
          </button>
        )}
      </div>
      <GoLink
        onClick={() => {
          onClose()
          go('settings', 'appearance')
        }}
      >
        Özel palet ve diğer ayarlar
      </GoLink>
    </Popover>
  )
}

// ---------------------------------------------------------------- paneller
// Canlı Akış'ın yan panellerinde hangi kartların görüneceğini seçer; yerleri kartlardan sürüklenerek değişir.
export function WidgetsPanel({ onClose, left }: { onClose: () => void; left: number }) {
  const { rails, toggle, reset } = useRails()
  const { go } = useNav()
  const sideOf = (id: string) => (rails.left.includes(id) ? 'Sol' : rails.right.includes(id) ? 'Sağ' : null)
  return (
    <Popover title="Paneller" onClose={onClose} left={left} width={320}>
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        Ana sayfanın iki yanındaki kartlar. Açıp kapatın; kartı başlığındaki tutamaçtan sürükleyerek taşıyın (geniş ekran).
      </p>
      <div className="widget-list">
        {(Object.keys(RAIL_WIDGETS) as WidgetId[]).map((id) => {
          const w = RAIL_WIDGETS[id]
          const side = sideOf(id)
          return (
            <div key={id} className="widget-row">
              <div style={{ minWidth: 0 }}>
                <div className="widget-title">{w.title}</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {side ? `${side} sütun · ` : ''}
                  {w.desc}
                </div>
              </div>
              <Toggle checked={!!side} onChange={() => toggle(id)} title={side ? 'Kaldır' : 'Ekle'} />
            </div>
          )
        })}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-sm btn-ghost" onClick={reset}>
          <RotateCcw size={12} /> Varsayılana dön
        </button>
        <GoLink
          onClick={() => {
            onClose()
            go('feed')
          }}
        >
          Ana sayfa
        </GoLink>
      </div>
    </Popover>
  )
}
