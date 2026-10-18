import { useMemo, useState } from 'react'
import { usePipeline } from '../lib/pipeline'
import { canTrade, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { DashData } from '../lib/dashboard'
import { callerLeaderboard, callerSuggestions, isXCaller, PERIOD_LABEL, topEarners, type CallerRow, type CallerRule, type Mode, type Period } from '../../../shared/dashboard'
import { Empty, pct, sol, tone } from './DashWidgets'

// Çağrıcılar: Telegram gruplarında token paylaşan kişiler ve izlenen X hesapları. Başarı, kendi işlemlerimizden hesaplanır:
// işlemi açan sinyali kim paylaştıysa, kapanan işlemin kâr/zararı ona yazılır.

export const RULE_LABEL: Record<CallerRule, string> = { normal: 'Varsayılan', trusted: 'Otomatik al', manual: 'Onaya düşsün', blocked: 'Engelli' }
const RULE_HINT: Record<CallerRule, string> = {
  normal: 'Kurallar’daki genel ayara uyar',
  trusted: 'Otomatik modda güvenlikten geçen çağrısı otomatik alınır',
  manual: 'Çağrısı her zaman onaya düşer, otomatik alınmaz',
  blocked: 'Çağrısı hiç işlenmez'
}
const PERIODS: Period[] = ['day', 'week', 'month']
const PERIOD_SHORT: Record<Period, string> = { day: 'Gün', week: 'Hafta', month: 'Ay' }

/** Kişinin kuralını değiştirir (yalnızca işlem yetkisi olanlar). */
export function useCallerRule() {
  const { profile } = useAuth()
  const editable = canTrade(profile?.role)
  const set = async (senderId: string, patch: CallerRule | { rule?: CallerRule; buy_sol?: number | null }): Promise<string | null> => {
    if (!profile) return 'Oturum yok'
    const row = typeof patch === 'string' ? { rule: patch } : patch
    const { error } = await supabase.from('callers').update(row).eq('user_id', profile.id).eq('sender_id', senderId)
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
  return <span className={`badge ${rule === 'trusted' ? 'pass' : rule === 'manual' ? 'warn' : 'fail'}`}>{RULE_LABEL[rule]}</span>
}

function PlatformTag({ senderId }: { senderId: string }) {
  return (
    <span className="badge" style={{ marginRight: 4 }} title={isXCaller(senderId) ? 'X hesabı' : 'Telegram grup üyesi'}>
      {isXCaller(senderId) ? 'X' : 'TG'}
    </span>
  )
}

/** Kişiye özel otomatik alım tutarı: boş = Kurallar'daki tutar. */
function BuySolInput({ value, placeholder, disabled, onSave }: { value: number | null; placeholder: string; disabled?: boolean; onSave: (v: number | null) => void }) {
  return (
    <span className="unit-input">
      <input
        inputMode="decimal"
        style={{ width: 64 }}
        disabled={disabled}
        placeholder={placeholder}
        defaultValue={value ?? ''}
        key={String(value)}
        onBlur={(e) => {
          const t = e.target.value.trim().replace(',', '.')
          const n = t === '' ? null : Number(t)
          if (n !== null && !(Number.isFinite(n) && n > 0 && n <= 5)) {
            e.target.value = String(value ?? '')
            return
          }
          if (n !== value) onSave(n)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span>SOL</span>
    </span>
  )
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
                    <PlatformTag senderId={r.senderId} />
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
  const [platform, setPlatform] = useState<'all' | 'tg' | 'x'>('all')
  const { editable, set } = useCallerRule()
  const { rule: pr } = usePipeline()
  const buyOf = useMemo(() => new Map(data.callers.map((c) => [c.sender_id, c.buy_sol ?? null])), [data.callers])
  const rows = useMemo(() => callerLeaderboard(data.positions, data.signals, data.callers, data.sources, mode, period), [data.positions, data.signals, data.callers, data.sources, mode, period])
  const suggestions = useMemo(() => callerSuggestions(data.positions, data.signals, data.callers, data.sources, mode), [data.positions, data.signals, data.callers, data.sources, mode])

  // Henüz işlemi olmayan kişiler de listelensin (kural verebilmek için)
  const known = new Set(rows.map((r) => r.senderId))
  const idle: CallerRow[] = data.callers
    .filter((c) => !known.has(c.sender_id))
    .map((c) => ({ senderId: c.sender_id, name: c.name || c.handle || 'Bilinmeyen', handle: c.handle, rule: c.rule, groups: [], trades: 0, wins: 0, losses: 0, winrate: null, pnl: 0, cost: 0, roi: null }))
  const ql = q.trim().toLocaleLowerCase('tr')
  const all = [...rows, ...idle]
    .filter((r) => platform === 'all' || (platform === 'x') === isXCaller(r.senderId))
    .filter((r) => !ql || `${r.name} ${r.handle ?? ''} ${r.groups.join(' ')}`.toLocaleLowerCase('tr').includes(ql))

  const change = async (senderId: string, patch: CallerRule | { buy_sol: number | null }) => {
    setMsg(null)
    const err = await set(senderId, patch)
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
                  {s.name}: {s.suggest === 'trusted' ? 'otomatik alınsın mı?' : 'engellensin mi?'}
                </span>
                <span className="setting-row-desc">
                  {s.trades} işlem · kazanma {pct(s.winrate, false, 0)} · {sol(s.pnl, true)}
                </span>
              </div>
              <div className="setting-row-control">
                <button className={`btn btn-sm ${s.suggest === 'blocked' ? 'btn-danger' : 'btn-primary'}`} disabled={!editable} onClick={() => change(s.senderId, s.suggest)}>
                  {s.suggest === 'trusted' ? 'Otomatik al yap' : 'Engelle'}
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
          <div className="pills" aria-label="Platform">
            {(['all', 'tg', 'x'] as const).map((k) => (
              <button key={k} className="pill" aria-selected={platform === k} onClick={() => setPlatform(k)}>
                {k === 'all' ? 'Tümü' : k === 'tg' ? 'Telegram' : 'X'}
              </button>
            ))}
          </div>
          <PeriodPills period={period} onChange={setPeriod} />
          <label className="search sm" style={{ width: 160 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kişi ya da grup ara" />
          </label>
        </div>
      </div>

      {pr.mode !== 'auto' && (
        <div className="notice warn">
          Otomatik mod şu an kapalı: “Otomatik al” kişilerin çağrıları da onaya düşer. Otomatik alım için Kurallar'dan modu “Otomatik” yapın.
        </div>
      )}

      {all.length === 0 ? (
        <Empty>
          Henüz kişi yok. Ayarlar → Kaynaklar'dan bir Telegram grubu izleyin (token paylaşan üyeler burada listelenir) ya da Hesaplar'dan X hesabı ekleyin.
        </Empty>
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
                <th className="r" title="Bu kişinin çağrısında otomatik alım tutarı. Boş = Kurallar'daki tutar">Alım tutarı</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.senderId}>
                  <td>
                    <PlatformTag senderId={r.senderId} />
                    <b>{r.name}</b>
                    {r.handle && <div className="faint" style={{ fontSize: 11 }}>@{r.handle}</div>}
                  </td>
                  <td className="faint" style={{ fontSize: 11 }}>{r.groups.join(', ') || '—'}</td>
                  <td className="r mono">{r.trades || '—'}</td>
                  <td className="r mono">{r.winrate === null ? '—' : pct(r.winrate, false, 0)}</td>
                  <td className={`r mono ${tone(r.pnl) ?? ''}`}>{r.trades ? sol(r.pnl, true) : '—'}</td>
                  <td className={`r mono ${tone(r.roi) ?? ''}`}>{r.roi === null ? '—' : pct(r.roi, true)}</td>
                  <td>
                    <select className="input-sm" value={r.rule} disabled={!editable} title={RULE_HINT[r.rule]} onChange={(e) => change(r.senderId, e.target.value as CallerRule)}>
                      {(Object.keys(RULE_LABEL) as CallerRule[]).map((k) => (
                        <option key={k} value={k} title={RULE_HINT[k]}>
                          {RULE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="r">
                    {r.rule === 'blocked' || r.rule === 'manual' ? (
                      <span className="faint">—</span>
                    ) : (
                      <BuySolInput
                        value={buyOf.get(r.senderId) ?? null}
                        placeholder={String(r.rule === 'trusted' ? +(pr.limits.autoBuySol * Math.max(1, pr.limits.trustedBuyMult || 1)).toFixed(4) : pr.limits.autoBuySol)}
                        disabled={!editable}
                        onSave={(v) => change(r.senderId, { buy_sol: v })}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        Kâr/zarar yalnızca bu uygulamada açılıp {PERIOD_LABEL[period].toLocaleLowerCase('tr')} içinde kapanan işlemlerden hesaplanır; işlemi açan sinyali paylaşan kişiye yazılır.
        Kurallar: <b>Varsayılan</b> genel ayara uyar · <b>Otomatik al</b> otomatik modda güvenlikten geçen çağrıyı alır (“yalnız güvenilir” açıkken de) ·{' '}
        <b>Onaya düşsün</b> hiç otomatik alınmaz · <b>Engelli</b> hiç işlenmez. Alım tutarı boşsa Kurallar'daki tutar kullanılır; her durumda işlem başı en çok{' '}
        {pr.limits.maxBuySol} SOL.
      </p>
    </div>
  )
}
