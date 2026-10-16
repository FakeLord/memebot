import { useEffect, useState } from 'react'
import { extractMints } from '../../../shared/extract'
import { errText, useEngine } from '../lib/engine'
import { usd, VERDICT_LABEL } from '../../../shared/safety'
import type { TokenCheckResult } from '../../../shared/engine'

export function TokenCheckPage({ initial }: { initial?: string }) {
  const { online, run: runEngine } = useEngine()
  const [text, setText] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<TokenCheckResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const mints = extractMints(text)

  // Canlı Akış'tan "Kontrol" ile gelindiyse hemen çalıştır
  useEffect(() => {
    if (initial) run(extractMints(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // Kontrolü motor yapar (GMGN anahtarı motorda); sonuç ortak önbelleğe de yazılır
  const run = async (targets: string[] = mints) => {
    setBusy(true)
    setError(null)
    try {
      setResults((await runEngine('token.check', { mints: targets.slice(0, 5) }, 45_000)).results)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
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
          <button className="btn btn-primary" disabled={busy || !online || mints.length === 0} onClick={() => run()}>
            {busy ? 'Kontrol ediliyor…' : 'Kontrol et'}
          </button>
        </div>
      </div>

      {!online && <div className="notice">Motor çalışmıyor; kontrol yapılamaz.</div>}
      {error && <div className="notice error">{error}</div>}
      {results.map((r) => (
        <div key={r.mint} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div>
                {r.summary?.symbol ?? '—'} <span className="muted">{r.summary?.name}</span>
              </div>
              <div className="mono faint">{r.mint}</div>
            </div>
            <div className="row">
              {r.summary?.mcapUsd !== undefined && <span className="mono muted">MC {usd(r.summary.mcapUsd)}</span>}
              {r.summary?.liquidityUsd !== undefined && <span className="mono muted">Lik. {usd(r.summary.liquidityUsd)}</span>}
              {r.summary?.priceUsd !== undefined && <span className="mono muted">${r.summary.priceUsd.toPrecision(4)}</span>}
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
