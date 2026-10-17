import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Download, X } from 'lucide-react'
import { useAuth, shownName } from '../lib/auth'

// PnL paylaşım kartı: kapanan bir işlemi görsel olarak dışa aktarır. Cüzdan adresi ve token adresi karta KONMAZ.

export interface ShareTrade {
  symbol: string | null
  cost_sol: number | null
  proceeds_sol: number | null
  opened_at: string
  closed_at: string | null
  is_dry_run: boolean
}

const W = 1080
const H = 566

function duration(a: string, b: string | null): string {
  const s = Math.max(0, ((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} dk`
  if (s < 86400) return `${(s / 3600).toFixed(1)} sa`
  return `${(s / 86400).toFixed(1)} gün`
}

function draw(c: HTMLCanvasElement, t: ShareTrade, who: string) {
  const g = c.getContext('2d')
  if (!g) return
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d
  const bg = v('--bg', '#111113')
  const surface = v('--surface', '#1a1a1d')
  const text = v('--text', '#ececf1')
  const muted = v('--muted', '#8e8e99')
  const accent = v('--accent', '#5865f2')
  const pos = v('--pos', '#3ecf8e')
  const neg = v('--neg', '#ef5b5b')
  const cost = Number(t.cost_sol ?? 0)
  const pnl = Number(t.proceeds_sol ?? 0) - cost
  const ratio = cost > 0 ? pnl / cost : 0
  const col = pnl >= 0 ? pos : neg

  g.clearRect(0, 0, W, H)
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  // yumuşak renk parıltısı
  const grad = g.createRadialGradient(W * 0.85, 0, 10, W * 0.85, 0, 620)
  grad.addColorStop(0, `${col}55`)
  grad.addColorStop(1, `${col}00`)
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  g.fillStyle = surface
  g.strokeStyle = `${muted}44`
  g.lineWidth = 2
  g.beginPath()
  g.roundRect(28, 28, W - 56, H - 56, 28)
  g.fill()
  g.stroke()

  g.textBaseline = 'alphabetic'
  g.fillStyle = muted
  g.font = '600 26px system-ui, sans-serif'
  g.fillText('MemeBot', 72, 92)
  if (t.is_dry_run) {
    g.fillStyle = `${muted}33`
    g.beginPath()
    g.roundRect(W - 72 - 120, 62, 120, 40, 20)
    g.fill()
    g.fillStyle = muted
    g.font = '600 20px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText('DENEME', W - 72 - 60, 90)
    g.textAlign = 'left'
  }

  g.fillStyle = text
  g.font = '700 64px system-ui, sans-serif'
  g.fillText(`$${(t.symbol ?? 'TOKEN').toUpperCase()}`, 72, 190)

  g.fillStyle = col
  g.font = '800 132px system-ui, sans-serif'
  g.fillText(`${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%`, 72, 330)
  g.font = '600 38px ui-monospace, Consolas, monospace'
  g.fillText(`${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL`, 76, 386)

  const cells: [string, string][] = [
    ['Maliyet', `${cost.toFixed(4)} SOL`],
    ['Gelen', `${Number(t.proceeds_sol ?? 0).toFixed(4)} SOL`],
    ['Süre', duration(t.opened_at, t.closed_at)]
  ]
  cells.forEach(([k, val], i) => {
    const x = 72 + i * 300
    g.fillStyle = muted
    g.font = '600 20px system-ui, sans-serif'
    g.fillText(k.toUpperCase(), x, 446)
    g.fillStyle = text
    g.font = '600 30px ui-monospace, Consolas, monospace'
    g.fillText(val, x, 484)
  })

  g.fillStyle = accent
  g.fillRect(72, H - 28 - 14, 56, 4)
  g.fillStyle = muted
  g.font = '500 20px system-ui, sans-serif'
  g.textAlign = 'right'
  g.fillText(`${who} · ${new Date(t.closed_at ?? Date.now()).toLocaleDateString('tr-TR')}`, W - 72, H - 44)
  g.textAlign = 'left'
}

function ShareModal({ trade, onClose }: { trade: ShareTrade; onClose: () => void }) {
  const { profile } = useAuth()
  const ref = useRef<HTMLCanvasElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (ref.current) draw(ref.current, trade, shownName(profile))
  }, [trade, profile])

  const download = () => {
    const c = ref.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `memebot-${(trade.symbol ?? 'pnl').toLowerCase()}.png`
    a.click()
  }

  const copy = () => {
    ref.current?.toBlob(async (b) => {
      try {
        if (!b) throw new Error('boş')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
        setMsg('Görsel panoya kopyalandı.')
      } catch {
        setMsg('Kopyalanamadı; “İndir”i kullanın.')
      }
    })
  }

  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <header className="modal-head">
          <h1>Paylaşım kartı</h1>
          <button className="icon-btn" onClick={onClose} title="Kapat">
            <X size={15} />
          </button>
        </header>
        <canvas ref={ref} width={W} height={H} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
        <p className="faint" style={{ fontSize: 11 }}>
          Kartta cüzdan ve token adresi yer almaz.
        </p>
        {msg && <div className="notice ok">{msg}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={copy}>
            <Copy size={13} /> Kopyala
          </button>
          <button className="btn btn-sm btn-primary" onClick={download}>
            <Download size={13} /> İndir (PNG)
          </button>
        </div>
      </div>
    </div>
  )
}

/** [aç, modal]: modal öğesini sayfanın herhangi bir yerinde render edin. */
export function useShareCard(): [(t: ShareTrade) => void, ReactNode] {
  const [trade, setTrade] = useState<ShareTrade | null>(null)
  const open = useCallback((t: ShareTrade) => setTrade(t), [])
  return [open, trade ? <ShareModal trade={trade} onClose={() => setTrade(null)} /> : null]
}
