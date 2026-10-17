import { useState } from 'react'
import { Check, Copy, ExternalLink, Eye, EyeOff, Plus, RefreshCw, Star } from 'lucide-react'
import { canTrade, useAuth } from '../../lib/auth'
import { useEngine } from '../../lib/engine'
import { useNav } from '../../lib/nav'
import { useGmgnDash } from '../../lib/dashboard'
import { WalletSummary } from '../../components/DashExtras'
import { shortAddr, useWallets, type WalletRow } from '../../lib/wallets'

// Cüzdanlar: GMGN'e bağlı SOL cüzdanları, bakiye, etiket, varsayılan (★) ve listeden gizleme.
// Uygulama özel anahtar tutmaz; yeni cüzdan GMGN'de oluşturulur/bağlanır, silme de orada yapılır.

export function SolMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="solg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <path fill="url(#solg)" d="M5 16.5h14l-3 3H2l3-3Zm0-12h14l-3 3H2l3-3Zm11 6H2l3 3h14l-3-3Z" />
    </svg>
  )
}

export function WalletsSection() {
  const { profile } = useAuth()
  const { me, online } = useEngine()
  const { go } = useNav()
  const { rows, busy, error, refresh, setPref, makeDefault } = useWallets()
  const [showHidden, setShowHidden] = useState(false)
  const trader = canTrade(profile?.role)
  const { dash } = useGmgnDash()

  if (!me?.gmgn.configured) {
    return (
      <div className="empty">
        Önce GMGN API anahtarını girin.
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => go('settings', 'connections')}>
            GMGN ve motor
          </button>
        </div>
      </div>
    )
  }

  const visible = rows.filter((w) => showHidden || !w.hidden || w.isDefault)
  const hiddenCount = rows.filter((w) => w.hidden && !w.isDefault).length

  return (
    <div className="stack">
      <WalletSummary dash={dash} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <h3>Cüzdanlar ({rows.length})</h3>
          <button className="icon-btn sm" title="Bakiyeleri yenile" disabled={busy || !online} onClick={refresh}>
            <RefreshCw size={12} className={busy ? 'spin' : undefined} />
          </button>
        </div>
        <a className="btn btn-sm" href="https://gmgn.ai/ai" target="_blank" rel="noreferrer" title="Cüzdan GMGN'de oluşturulur ve API anahtarına bağlanır">
          <Plus size={13} /> GMGN'de ekle
        </a>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        Alım-satım ve deploy ★ varsayılan cüzdandan yapılır. MemeBot özel anahtar saklamaz: cüzdanlar GMGN'de durur, burada sadece etiket ve görünüm ayarlanır.
      </p>
      {error && <div className="notice error">{error}</div>}
      {visible.length === 0 ? (
        <div className="empty">{busy ? 'Yükleniyor…' : 'Cüzdan yok.'}</div>
      ) : (
        <div className="card card-flush">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Cüzdan</th>
                <th>Bakiye</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => (
                <WalletLine key={w.address} w={w} trader={trader} online={online} setPref={setPref} makeDefault={makeDefault} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hiddenCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Gizlenen {hiddenCount} cüzdanı göster
        </label>
      )}
    </div>
  )
}

function WalletLine({
  w,
  trader,
  online,
  setPref,
  makeDefault
}: {
  w: WalletRow
  trader: boolean
  online: boolean
  setPref: (a: string, p: { label?: string | null; hidden?: boolean }) => Promise<void>
  makeDefault: (a: string) => Promise<void>
}) {
  const [label, setLabel] = useState(w.label ?? '')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const save = () => {
    setEditing(false)
    if (label !== (w.label ?? '')) setPref(w.address, { label: label.trim() || null })
  }
  return (
    <tr style={w.hidden ? { opacity: 0.55 } : undefined}>
      <td>
        <button
          className={`star ${w.isDefault ? 'on' : ''}`}
          title={w.isDefault ? 'Varsayılan cüzdan' : 'Varsayılan yap'}
          disabled={w.isDefault || !trader || !online}
          onClick={() => makeDefault(w.address)}
        >
          <Star size={14} fill={w.isDefault ? 'currentColor' : 'none'} />
        </button>
      </td>
      <td>
        {editing ? (
          <input
            className="input-sm"
            value={label}
            maxLength={40}
            placeholder="Etiket"
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        ) : (
          <button className="link" style={{ textDecoration: 'none', fontWeight: 600 }} title="Etiketi düzenle" onClick={() => setEditing(true)}>
            {w.label ?? shortAddr(w.address)}
          </button>
        )}
        <div className="row mono faint" style={{ gap: 4, fontSize: 11 }}>
          {w.address.slice(0, 6)}…{w.address.slice(-4)}
          <button
            className="icon-btn sm"
            style={{ width: 18, height: 18 }}
            title="Adresi kopyala"
            onClick={async () => {
              await navigator.clipboard.writeText(w.address)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
      </td>
      <td className="mono">
        <span className="row" style={{ gap: 6 }}>
          <SolMark />
          {w.balance !== undefined ? w.balance.toFixed(4) : <span className="faint">—</span>}
        </span>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <a className="icon-btn" title="Solscan'de aç" href={`https://solscan.io/account/${w.address}`} target="_blank" rel="noreferrer">
          <ExternalLink size={13} />
        </a>
        {!w.isDefault && (
          <button className="icon-btn" title={w.hidden ? 'Listede göster' : 'Listeden gizle'} onClick={() => setPref(w.address, { hidden: !w.hidden })}>
            {w.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}
      </td>
    </tr>
  )
}
