import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { extractMints } from '../../../shared/extract'
import { evaluateSafety, type SafetyReport } from '../../../shared/safety'

const VERDICT_LABEL = { pass: 'GEÇTİ', warn: 'UYARI', fail: 'RED' } as const

interface Checked {
  mint: string
  name?: string
  symbol?: string
  priceUsd?: number
  report?: SafetyReport
  error?: string
}

type Obj = Record<string, unknown>

export function TokenCheckPage({ initial }: { initial?: string }) {
  const { profile } = useAuth()
  const [text, setText] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Checked[]>([])

  const mints = extractMints(text)

  // Canlı Akış'tan "Kontrol" ile gelindiyse hemen çalıştır
  useEffect(() => {
    if (initial) run(extractMints(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const run = async (targets: string[] = mints) => {
    if (!profile) return
    setBusy(true)
    const out: Checked[] = []
    // Sırayla: GMGN rate limit'ine nazik davranır
    for (const mint of targets.slice(0, 5)) {
      const [info, security] = await Promise.all([
        window.api.gmgn.tokenInfo(profile.id, mint),
        window.api.gmgn.tokenSecurity(profile.id, mint)
      ])
      if (!info.ok || !security.ok) {
        out.push({ mint, error: (!info.ok && info.error) || (!security.ok && security.error) || 'Bilinmeyen hata' })
        continue
      }
      const report = evaluateSafety(security.data, info.data)
      const d = (info.data ?? {}) as Obj
      out.push({
        mint,
        name: typeof d.name === 'string' ? d.name : undefined,
        symbol: typeof d.symbol === 'string' ? d.symbol : undefined,
        priceUsd: d.price !== undefined ? Number(d.price) : undefined,
        report
      })
      await supabase.from('safety_checks').insert({
        mint,
        result: report.result,
        reasons: report.items.filter((i) => i.verdict !== 'pass'),
        raw: { info: info.data, security: security.data }
      })
    }
    setResults(out)
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="card stack">
        <label>
          Mesaj ya da token adresi yapıştırın
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="ör. Telegram mesajının tamamı" />
        </label>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">{mints.length === 0 ? 'Adres bulunamadı' : `${mints.length} adres bulundu`}</span>
          <button className="btn btn-primary" disabled={busy || mints.length === 0} onClick={() => run()}>
            {busy ? 'Kontrol ediliyor…' : 'Kontrol et'}
          </button>
        </div>
      </div>

      {results.map((r) => (
        <div key={r.mint} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div>
                {r.symbol ?? '—'} <span className="muted">{r.name}</span>
              </div>
              <div className="mono faint">{r.mint}</div>
            </div>
            <div className="row">
              {r.priceUsd !== undefined && <span className="mono muted">${r.priceUsd.toPrecision(4)}</span>}
              {r.report && <span className={`badge ${r.report.result}`}>{VERDICT_LABEL[r.report.result]}</span>}
              <a className="btn btn-sm" href={`https://gmgn.ai/sol/token/${r.mint}`} target="_blank" rel="noreferrer">
                GMGN
              </a>
            </div>
          </div>
          {r.error && <div className="notice error">{r.error}</div>}
          {r.report && (
            <table>
              <tbody>
                {r.report.items.map((i) => (
                  <tr key={i.label}>
                    <td className="muted">{i.label}</td>
                    <td className="mono">{i.value}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`badge ${i.verdict}`}>{VERDICT_LABEL[i.verdict]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}
