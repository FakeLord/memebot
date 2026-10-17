import { useMemo, useState } from 'react'
import { canTrade, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { DashData } from '../lib/dashboard'
import { callerLeaderboard, callerSuggestions, PERIOD_LABEL, topEarners, type CallerRow, type CallerRule, type Mode, type Period } from '../../../shared/dashboard'
import { Empty, pct, sol, tone } from './DashWidgets'

// Çağrıcılar: Telegram gruplarında token paylaşan kişiler. Başarı, kendi işlemlerimizden hesaplanır:
// işlemi açan sinyali kim paylaştıysa, kapanan işlemin kâr/zararı ona yazılır.

export const RULE_LABEL: Record<CallerRule, string> = { normal: 'Normal', trusted: 'Güvenilir', blocked: 'Engelli' }
const PERIODS: Period[] = ['day', 'week', 'month']
const PERIOD_SHORT: Record<Period, string> = { day: 'Gün', week: 'Hafta', month: 'Ay' }

/** Kişinin kuralını değiştirir (yalnızca işlem yetkisi olanlar). */
export function useCallerRule() {
  const { profile } = useAuth()
  const editable = canTrade(profile?.role)
  const set = async (senderId: string, rule: CallerRule): Promise<string | null> => {
    if (!profile) return 'Oturum yok'
    const { error } = await supabase.from('callers').update({ rule }).eq('user_id', profile.id).eq('sender_id', senderId)
    return error ? error.message : null
  }
  return { editable, set }
}

export function PeriodPills({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="pills" aria-label="Dönem">
      {PERIODS.map((p) => (
        <button key={p} className="pill" aria-selected={period === p} onClick={() => onChange(p)} title={PERIOD_LABEL[p]}>
          {PERIOD_SHORT[p]}
        </button>
      ))}
    </div>
  )
}

function RuleBadge({ rule }: { rule: CallerRule }) {
  if (rule === 'normal') return null
  return <span className={`badge ${rule === 'trusted' ? 'pass' : 'fail'}`}>{RULE_LABEL[rule]}</span>
}

/** En çok kazandıran 10 kişi tablosu: Gün / Hafta / Ay. */
export function TopCallers({ data, mode, compact, onReload }: { data: DashData; mode: Mode; compact?: boolean; onReload?: () => void }) {
  const [period, setPeriod] = useState<Period>('day')
  const rows = useMemo(() => topEarners(callerLeaderboard(data.positions, data.signals, data.callers, data.sources, mode, period)), [data.positions, data.signals, data.callers, data.sources, mode, period])
  void onReload
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PeriodPills period={period} onChange={setPeriod} />
      {rows.length === 0 ? (
        <Empty>{PERIOD_LABEL[period]} kâr getiren çağrıcı yok. Telegram gruplarından gelen sinyallerle açılan işlemler kapandıkça burada görünür.</Empty>
      ) : (
        <div className="stable-wrap">
          <table className="stable">
            <thead>
              <tr>
                <th>#</th>
                <th>Kişi</th>
                <th className="r">İşlem</th>
                {!compact && <th className="r">Kazanma</th>}
                <th className="r">Kazandırdı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.senderId}>
                  <td className="faint">{i + 1}</td>
                  <td>
                    <b>{r.name}</b> <RuleBadge rule={r.rule} />
                    {!compact && r.groups.length > 0 && <div className="faint" style={{ fontSize: 11 }}>{r.groups.join(', ')}</div>}
                  </td>
                  <td className="r mono">{r.trades}</td>
                  {!compact && <td className="r mono">{r.winrate === null ? '—' : pct(r.winrate, false, 0)}</td>}
                  <td className={`r mono ${tone(r.pnl) ?? ''}`}>{sol(r.pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Ayarlar → Çağrıcılar: tüm kişiler, kural seçimi ve öneriler. */
export function CallerManager({ data, mode }: { data: DashData; mode: Mode }) {
  const [period, setPeriod] = useState<Period>('month')
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const { editable, set } = useCallerRule()
  const rows = useMemo(() => callerLeaderboard(data.positions, data.signals, data.callers, data.sources, mode, period), [data.positions, data.signals, data.callers, data.sources, mode, period])
  const suggestions = useMemo(() => callerSuggestions(data.positions, data.signals, data.callers, data.sources, mode), [data.positions, data.signals, data.callers, data.sources, mode])

  // Henüz işlemi olmayan kişiler de listelensin (kural verebilmek için)
  const known = new Set(rows.map((r) => r.senderId))
  const idle: CallerRow[] = data.callers
    .filter((c) => !known.has(c.sender_id))
    .map((c) => ({ senderId: c.sender_id, name: c.name || c.handle || 'Bilinmeyen', handle: c.handle, rule: c.rule, groups: [], trades: 0, wins: 0, losses: 0, winrate: null, pnl: 0, cost: 0, roi: null }))
  const ql = q.trim().toLocaleLowerCase('tr')
  const all = [...rows, ...idle].filter((r) => !ql || `${r.name} ${r.handle ?? ''} ${r.groups.join(' ')}`.toLocaleLowerCase('tr').includes(ql))

  const change = async (senderId: string, rule: CallerRule) => {
    setMsg(null)
    const err = await set(senderId, rule)
    if (err) setMsg(`Kaydedilemedi: ${err}`)
    else data.reload()
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {msg && <div className="notice error">{msg}</div>}
      {suggestions.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="section-label">Öneriler (son 30 gün)</div>
          {suggestions.map((s) => (
            <div key={s.senderId} className="setting-row">
              <div className="setting-row-text">
                <span className="setting-row-title">
                  {s.name}: {s.suggest === 'trusted' ? 'güvenilir yapılsın mı?' : 'engellensin mi?'}
                </span>
                <span className="setting-row-desc">
                  {s.trades} işlem · kazanma {pct(s.winrate, false, 0)} · {sol(s.pnl, true)}
                </span>
              </div>
              <div className="setting-row-control">
                <button className={`btn btn-sm ${s.suggest === 'blocked' ? 'btn-danger' : 'btn-primary'}`} disabled={!editable} onClick={() => change(s.senderId, s.suggest)}>
                  {s.suggest === 'trusted' ? 'Güvenilir yap' : 'Engelle'}
                </button>
              </div>
            </div>
          ))}
          <p className="faint" style={{ fontSize: 11, margin: 0 }}>Öneriler yalnızca bilgidir; siz onaylamadan hiçbir kural değişmez.</p>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="section-label" style={{ margin: 0 }}>Tüm kişiler ({all.length})</div>
        <div className="row">
          <PeriodPills period={period} onChange={setPeriod} />
          <label className="search sm" style={{ width: 160 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kişi ya da grup ara" />
          </label>
        </div>
      </div>

      {all.length === 0 ? (
        <Empty>Henüz Telegram grubundan gelen bir kişi yok. Ayarlar → Kaynaklar'dan bir grup izleyin; grup mesajlarındaki token adresleri paylaşanlar burada listelenir.</Empty>
      ) : (
        <div className="stable-wrap">
          <table className="stable">
            <thead>
              <tr>
                <th>Kişi</th>
                <th>Gruplar</th>
                <th className="r">İşlem</th>
                <th className="r">Kazanma</th>
                <th className="r">Kâr/zarar</th>
                <th className="r">Getiri</th>
                <th>Kural</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.senderId}>
                  <td>
                    <b>{r.name}</b>
                    {r.handle && <div className="faint" style={{ fontSize: 11 }}>@{r.handle}</div>}
                  </td>
                  <td className="faint" style={{ fontSize: 11 }}>{r.groups.join(', ') || '—'}</td>
                  <td className="r mono">{r.trades || '—'}</td>
                  <td className="r mono">{r.winrate === null ? '—' : pct(r.winrate, false, 0)}</td>
                  <td className={`r mono ${tone(r.pnl) ?? ''}`}>{r.trades ? sol(r.pnl, true) : '—'}</td>
                  <td className={`r mono ${tone(r.roi) ?? ''}`}>{r.roi === null ? '—' : pct(r.roi, true)}</td>
                  <td>
                    <select className="input-sm" value={r.rule} disabled={!editable} onChange={(e) => change(r.senderId, e.target.value as CallerRule)}>
                      {(Object.keys(RULE_LABEL) as CallerRule[]).map((k) => (
                        <option key={k} value={k}>
                          {RULE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        Kâr/zarar yalnızca bu uygulamada açılıp {PERIOD_LABEL[period].toLocaleLowerCase('tr')} içinde kapanan işlemlerden hesaplanır; işlemi açan sinyali paylaşan kişiye yazılır.
        Engelli kişinin mesajları hiç işlenmez. Güvenilir kişilerde, Kurallar'daki seçeneklere göre otomatik alım yapılır.
      </p>
    </div>
  )
}
