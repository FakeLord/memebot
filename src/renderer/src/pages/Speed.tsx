import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Database, Gauge, Play, Radio, RefreshCw, ScrollText, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { errText, useEngine } from '../lib/engine'
import { Section, Stat, StatusPill } from '../components/ui'

// Hız: API ve işlem süreleri.
//  - Canlı test: arayüz → Supabase → motor → GMGN → geri (uçtan uca) ve sadece motor ↔ GMGN süresi
//  - Motorun son GMGN gecikmesi (10 sn'de bir örneklenir, bu sayfa açıkken)
//  - Son kayıtlardan: kaynak → motor gecikmesi, sinyal → onay adayı (güvenlik kontrolü), emir süresi

type Sample = { e2e: number; gmgn: number; db: number }

const fmt = (ms: number | undefined) => (ms === undefined || !Number.isFinite(ms) ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} sn`)

function summary(xs: number[]) {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!v.length) return null
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))]
  return { n: v.length, min: v[0], med: q(0.5), p90: q(0.9), max: v[v.length - 1], avg: v.reduce((a, b) => a + b, 0) / v.length }
}

const tone = (ms: number | undefined, good: number, ok: number) => (ms === undefined ? undefined : ms <= good ? 'pos' : ms <= ok ? 'warn' : 'neg')

function Bars({ values, max }: { values: number[]; max?: number }) {
  const top = max ?? Math.max(1, ...values)
  return (
    <div className="spark">
      {values.map((v, i) => (
        <span key={i} title={fmt(v)} style={{ height: `${Math.max(4, (v / top) * 100)}%` }} />
      ))}
    </div>
  )
}

function SummaryRow({ label, icon: Icon, s, good, ok, hint }: { label: string; icon: typeof Activity; s: ReturnType<typeof summary>; good: number; ok: number; hint: string }) {
  return (
    <div className="list-row" style={{ alignItems: 'center' }}>
      <span className="faint">
        <Icon size={14} />
      </span>
      <div className="list-row-main">
        <span className="list-row-title">{label}</span>
        <span className="list-row-sub">{s ? `${s.n} kayıt · ${hint}` : `Kayıt yok · ${hint}`}</span>
      </div>
      {s && (
        <div className="speed-cols">
          <span>
            <small>Ortanca</small>
            <b className={tone(s.med, good, ok)}>{fmt(s.med)}</b>
          </span>
          <span>
            <small>%90</small>
            <b className={tone(s.p90, good, ok)}>{fmt(s.p90)}</b>
          </span>
          <span>
            <small>En iyi</small>
            <b>{fmt(s.min)}</b>
          </span>
          <span>
            <small>En kötü</small>
            <b>{fmt(s.max)}</b>
          </span>
        </div>
      )}
    </div>
  )
}

export function SpeedPage() {
  const { profile } = useAuth()
  const { online, status, me, run } = useEngine()
  const [samples, setSamples] = useState<Sample[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hist, setHist] = useState<number[]>([])
  const [flows, setFlows] = useState<{ x: number[]; tg: number[]; check: number[]; orderDry: number[]; orderLive: number[] } | null>(null)
  const latRef = useRef(status?.gmgn_latency_ms)
  latRef.current = status?.gmgn_latency_ms

  // Motorun son GMGN gecikmesi: 10 sn'de bir örnek (en fazla 60 = 10 dk)
  useEffect(() => {
    const take = () => latRef.current != null && setHist((h) => [...h, latRef.current as number].slice(-60))
    take()
    const t = setInterval(take, 10_000)
    return () => clearInterval(t)
  }, [])

  const measure = useCallback(
    async (times = 5) => {
      setBusy(true)
      setError(null)
      try {
        for (let i = 0; i < times; i++) {
          const d0 = performance.now()
          await supabase.from('app_settings').select('key').eq('key', 'kill_switch').maybeSingle()
          const db = performance.now() - d0
          const t0 = performance.now()
          const r = await run('gmgn.test', {})
          const e2e = performance.now() - t0
          setSamples((s) => [...s, { e2e, gmgn: typeof r.ms === 'number' ? r.ms : NaN, db }].slice(-30))
        }
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusy(false)
      }
    },
    [run]
  )

  const loadFlows = useCallback(async () => {
    if (!profile) return
    const [feed, cands, orders] = await Promise.all([
      supabase.from('feed_items').select('platform, posted_at, received_at').eq('user_id', profile.id).not('posted_at', 'is', null).order('received_at', { ascending: false }).limit(200),
      supabase.from('candidates').select('created_at, signals(received_at)').eq('user_id', profile.id).not('signal_id', 'is', null).order('created_at', { ascending: false }).limit(100),
      supabase.from('orders').select('status, is_dry_run, created_at, updated_at').eq('user_id', profile.id).in('status', ['confirmed', 'failed']).order('created_at', { ascending: false }).limit(100)
    ])
    const diff = (a?: string | null, b?: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : NaN)
    const f = (feed.data as { platform: string; posted_at: string; received_at: string }[]) ?? []
    const c = (cands.data as unknown as { created_at: string; signals: { received_at: string } | null }[]) ?? []
    const o = (orders.data as { is_dry_run: boolean; created_at: string; updated_at: string }[]) ?? []
    setFlows({
      x: f.filter((r) => r.platform === 'x').map((r) => diff(r.posted_at, r.received_at)),
      tg: f.filter((r) => r.platform === 'telegram').map((r) => diff(r.posted_at, r.received_at)),
      check: c.map((r) => diff(r.signals?.received_at, r.created_at)),
      orderDry: o.filter((r) => r.is_dry_run).map((r) => diff(r.created_at, r.updated_at)),
      orderLive: o.filter((r) => !r.is_dry_run).map((r) => diff(r.created_at, r.updated_at))
    })
  }, [profile?.id])

  useEffect(() => {
    loadFlows()
  }, [loadFlows])

  const e2e = summary(samples.map((s) => s.e2e))
  const gm = summary(samples.map((s) => s.gmgn))
  const db = summary(samples.map((s) => s.db))
  const live = status?.gmgn_latency_ms ?? undefined
  const xs = me?.x

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Stat label="Motor" value={online ? 'Çalışıyor' : 'Kapalı'} tone={online ? 'pos' : 'neg'} />
        <Stat label="Son GMGN gecikmesi" value={fmt(live)} tone={tone(live, 300, 800)} />
        <Stat label="Uçtan uca (ortanca)" value={fmt(e2e?.med)} tone={tone(e2e?.med, 1000, 2500)} />
        <Stat label="Veritabanı (ortanca)" value={fmt(db?.med)} tone={tone(db?.med, 150, 400)} />
        <Stat label="X yoklama aralığı" value={xs?.intervalMs ? fmt(xs.intervalMs) : '—'} />
      </div>

      <Section
        icon={Gauge}
        title="Canlı test"
        actions={
          <>
            {samples.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setSamples([])}>
                Temizle
              </button>
            )}
            <button className="btn btn-sm btn-primary" disabled={busy || !online || !me?.gmgn.configured} onClick={() => measure(5)}>
              <Play size={13} /> {busy ? 'Ölçülüyor…' : '5 kez ölç'}
            </button>
          </>
        }
        note={
          !me?.gmgn.configured
            ? 'GMGN anahtarı girilmeden test yapılamaz.'
            : 'Uçtan uca: bu ekran → Supabase → motor → GMGN → motor → Supabase → bu ekran. GMGN: sadece motor ile GMGN arasındaki istek. Veritabanı: bu ekran ile Supabase arası. Test, GMGN\'in "user info" isteğini kullanır; işlem yapmaz.'
        }
      >
        {error && <div className="notice error" style={{ marginBottom: 6 }}>{error}</div>}
        {samples.length === 0 ? (
          <div className="empty">Henüz ölçüm yok. "5 kez ölç" ile başlatın.</div>
        ) : (
          <div className="list">
            <SummaryRow label="Uçtan uca komut" icon={Activity} s={e2e} good={1000} ok={2500} hint="arayüz ↔ motor ↔ GMGN" />
            <SummaryRow label="GMGN API" icon={Radio} s={gm} good={300} ok={800} hint="motor ↔ GMGN" />
            <SummaryRow label="Veritabanı" icon={Database} s={db} good={150} ok={400} hint="arayüz ↔ Supabase" />
            <div className="list-row" style={{ display: 'block' }}>
              <div className="list-row-sub" style={{ marginBottom: 6 }}>Uçtan uca ölçümler (son {samples.length})</div>
              <Bars values={samples.map((s) => s.e2e)} />
            </div>
          </div>
        )}
      </Section>

      <Section
        icon={Radio}
        title="Motorun GMGN gecikmesi"
        actions={<StatusPill tone={online ? 'on' : 'off'}>{online ? 'canlı' : 'motor kapalı'}</StatusPill>}
        note="Motorun GMGN'e yaptığı son isteğin süresi; bu sayfa açıkken 10 sn'de bir örneklenir (son 10 dk)."
      >
        {hist.length === 0 ? <div className="empty">Henüz örnek yok.</div> : <div className="list-row" style={{ display: 'block' }}><Bars values={hist} /></div>}
      </Section>

      <Section
        icon={ScrollText}
        title="Veri akışı ve işlem süreleri"
        actions={
          <button className="btn btn-sm" onClick={loadFlows}>
            <RefreshCw size={13} /> Yenile
          </button>
        }
        note="Son kayıtlardan hesaplanır. Kaynak → motor: gönderinin atıldığı an ile motorun aldığı an arası (X'te yoklama aralığı ve XFlux planı belirler). Güvenlik kontrolü: sinyal ile onay adayı arası. Emir: niyetin yazılması ile sonucun kesinleşmesi arası."
      >
        {!flows ? (
          <div className="empty">Yükleniyor…</div>
        ) : (
          <div className="list">
            <SummaryRow label="X → motor" icon={Radio} s={summary(flows.x)} good={5_000} ok={30_000} hint="gönderi gecikmesi" />
            <SummaryRow label="Telegram → motor" icon={Radio} s={summary(flows.tg)} good={2_000} ok={10_000} hint="gönderi gecikmesi" />
            <SummaryRow label="Sinyal → onay adayı" icon={ShieldCheck} s={summary(flows.check)} good={2_000} ok={6_000} hint="GMGN güvenlik kontrolü" />
            <SummaryRow label="Emir (deneme)" icon={ScrollText} s={summary(flows.orderDry)} good={1_500} ok={5_000} hint="niyet → sonuç" />
            <SummaryRow label="Emir (gerçek)" icon={ScrollText} s={summary(flows.orderLive)} good={5_000} ok={20_000} hint="niyet → zincirde kesinleşme" />
          </div>
        )}
      </Section>
    </div>
  )
}
