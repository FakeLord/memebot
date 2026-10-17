import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { usePipeline } from '../lib/pipeline'
import { useKillSwitch } from '../lib/killswitch'
import { useOrders } from '../lib/orders'
import { usd, VERDICT_LABEL, type SafetyCheckItem, type TokenSummary, type Verdict } from '../../../shared/safety'

interface Candidate {
  id: string
  mint: string
  verdict: Verdict
  reasons: SafetyCheckItem[]
  summary: TokenSummary
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  amount_sol: number | null
  created_at: string
  expires_at: string
  decided_at: string | null
}

const STATUS_LABEL = { pending: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', expired: 'Süresi doldu' } as const

function remaining(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ApprovalsPage({ onCheck }: { onCheck: (mint: string) => void }) {
  const { profile } = useAuth()
  const { rule } = usePipeline()
  const killSwitch = useKillSwitch()
  const orders = useOrders()
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState<Candidate[]>([])
  const [recent, setRecent] = useState<Candidate[]>([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trader = canTrade(profile?.role)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      const cols = 'id, mint, verdict, reasons, summary, status, amount_sol, created_at, expires_at, decided_at'
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from('candidates').select(cols).eq('user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
        supabase
          .from('candidates')
          .select(cols)
          .eq('user_id', profile.id)
          .neq('status', 'pending')
          .order('decided_at', { ascending: false })
          .limit(30)
      ])
      setPending((p as Candidate[]) ?? [])
      setRecent((r as Candidate[]) ?? [])
    }
    load()
    const ch = supabase
      .channel('approvals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candidates', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(tick)
    }
  }, [profile?.id])

  const decide = async (c: Candidate, status: 'approved' | 'rejected', amountSol?: number) => {
    setBusy(c.id)
    setError(null)
    setInfo(null)
    // Sadece hâlâ bekleyen adayı güncelle: çift tıklama / iki bilgisayar tek karar üretir
    const { data, error } = await supabase
      .from('candidates')
      .update({ status, amount_sol: amountSol ?? null, decided_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('status', 'pending')
      .select('id')
    if (error) {
      setBusy(null)
      return setError(error.message)
    }
    if (!data?.length) {
      setBusy(null)
      return setError('Bu aday artık beklemede değil (süresi dolmuş ya da başka yerden karar verilmiş).')
    }
    await supabase.from('audit_log').insert({ action: `candidate.${status}`, detail: { mint: c.mint, amount_sol: amountSol } })
    if (status === 'approved' && amountSol) {
      const err = await orders.buy({ mint: c.mint, amountSol, candidateId: c.id, symbol: c.summary.symbol })
      if (err) setError(`Alım yapılamadı: ${err}`)
      else setInfo(`${c.summary.symbol ?? 'Token'} için ${amountSol} SOL ${live ? 'alım emri gönderildi' : 'deneme alımı yapıldı'} — Pozisyonlar/Emirler ekranından izleyin.`)
    }
    setBusy(null)
  }

  const live = rule.limits.liveTrading

  const visible = pending.filter((c) => new Date(c.expires_at).getTime() > now)

  return (
    <div className="stack">
      <div className="notice">
        Mod: <b>{rule.mode === 'watch' ? 'Sadece izle' : rule.mode === 'manual' ? 'Manuel onay' : 'Otomatik'}</b> · Güvenlikten geçen sinyaller
        burada {rule.limits.approvalTtlMin} dk bekler. İşlem:{' '}
        {live ? <b className="neg">GERÇEK — onay SOL harcar</b> : <b>Deneme modu — para harcanmaz</b>}
      </div>
      {killSwitch && <div className="notice error">İşlemler founder tarafından durduruldu; onay verilemez.</div>}
      {error && <div className="notice error">{error}</div>}
      {info && <div className="notice ok">{info}</div>}

      {visible.length === 0 ? (
        <div className="empty">Onay bekleyen token yok.</div>
      ) : (
        visible.map((c) => (
          <div key={c.id} className="card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div>
                  <b>{c.summary.symbol ?? '—'}</b> <span className="muted">{c.summary.name}</span>{' '}
                  <span className={`badge ${c.verdict}`}>{VERDICT_LABEL[c.verdict]}</span>
                </div>
                <div className="mono faint">{c.mint}</div>
              </div>
              <div className="mono muted" title="Kalan süre">
                {remaining(c.expires_at, now)}
              </div>
            </div>

            <div className="row muted" style={{ gap: 18 }}>
              <span>MC {c.summary.mcapUsd !== undefined ? usd(c.summary.mcapUsd) : '—'}</span>
              <span>Likidite {c.summary.liquidityUsd !== undefined ? usd(c.summary.liquidityUsd) : '—'}</span>
              <span>Holder {c.summary.holders ?? '—'}</span>
              {c.summary.launchpad && <span>{c.summary.launchpad}</span>}
            </div>

            {c.reasons.length > 0 && (
              <div className="row" style={{ gap: 6 }}>
                {c.reasons.map((r) => (
                  <span key={r.label} className={`badge ${r.verdict}`}>
                    {r.label}: {r.value}
                  </span>
                ))}
              </div>
            )}

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                {rule.limits.buyPresetsSol
                  .filter((a) => a <= rule.limits.maxBuySol)
                  .slice(0, 4)
                  .map((a) => (
                    <button
                      key={a}
                      className="btn btn-primary btn-sm"
                      disabled={!trader || killSwitch || busy === c.id}
                      onClick={() => decide(c, 'approved', a)}
                    >
                      {live ? 'Al' : 'Dene'} · {a} SOL
                    </button>
                  ))}
                <button className="btn btn-sm" disabled={!trader || busy === c.id} onClick={() => decide(c, 'rejected')}>
                  Reddet
                </button>
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => onCheck(c.mint)}>
                  Detay
                </button>
                <a className="btn btn-sm" href={`https://gmgn.ai/sol/token/${c.mint}`} target="_blank" rel="noreferrer">
                  GMGN
                </a>
              </div>
            </div>
            {!trader && <p className="faint">Asistan rolü onay veremez.</p>}
          </div>
        ))
      )}

      {recent.length > 0 && (
        <div className="card stack" style={{ padding: 0 }}>
          <h2 style={{ padding: '14px 16px 0' }}>Son kararlar</h2>
          <table>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td>{c.summary.symbol ?? '—'}</td>
                  <td className="mono faint">
                    {c.mint.slice(0, 6)}…{c.mint.slice(-6)}
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'approved' ? 'pass' : ''}`}>{STATUS_LABEL[c.status]}</span>
                  </td>
                  <td className="mono muted">{c.amount_sol ? `${c.amount_sol} SOL` : ''}</td>
                  <td className="muted">{c.decided_at ? new Date(c.decided_at).toLocaleTimeString('tr-TR') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
