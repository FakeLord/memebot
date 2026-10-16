import { useState } from 'react'
import { canTrade, useAuth } from '../../lib/auth'
import { useEngine } from '../../lib/engine'
import { useWallets, type WalletRow } from '../../lib/wallets'

// Cüzdanlar: GMGN'e bağlı SOL cüzdanları, bakiye, etiket, varsayılan (★) ve listeden gizleme.
// Uygulama özel anahtar tutmaz; yeni cüzdan GMGN'de oluşturulur/bağlanır, silme de orada yapılır.

export function WalletsSection() {
  const { profile } = useAuth()
  const { me, online } = useEngine()
  const { rows, busy, error, refresh, setPref, makeDefault } = useWallets()
  const [showHidden, setShowHidden] = useState(false)
  const trader = canTrade(profile?.role)

  if (!me?.gmgn.configured) {
    return (
      <div className="card stack">
        <h2>Cüzdanlar</h2>
        <p className="muted">Önce GMGN API anahtarını girin (Ayarlar → GMGN ve motor).</p>
      </div>
    )
  }

  const visible = rows.filter((w) => showHidden || !w.hidden || w.isDefault)
  const hiddenCount = rows.filter((w) => w.hidden && !w.isDefault).length

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Cüzdanlar</h2>
        <div className="row">
          <button className="btn btn-sm" disabled={busy || !online} onClick={refresh}>
            {busy ? 'Getiriliyor…' : 'Bakiyeleri yenile'}
          </button>
          <a className="btn btn-sm" href="https://gmgn.ai/ai" target="_blank" rel="noreferrer" title="Cüzdan GMGN'de oluşturulur ve API anahtarına bağlanır">
            GMGN'de cüzdan ekle ↗
          </a>
        </div>
      </div>
      <p className="muted">
        Alım-satım ve deploy <b>★ varsayılan</b> cüzdandan yapılır. MemeBot özel anahtar saklamaz: cüzdanlar GMGN'de durur, burada sadece etiket ve
        görünüm ayarlanır.
      </p>
      {error && <div className="notice error">{error}</div>}
      {visible.length === 0 ? (
        <p className="faint">{busy ? 'Yükleniyor…' : 'Cüzdan yok.'}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th />
              <th>Etiket</th>
              <th>Adres</th>
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
      )}
      {hiddenCount > 0 && (
        <label className="row check">
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
  const [copied, setCopied] = useState(false)
  return (
    <tr style={w.hidden ? { opacity: 0.55 } : undefined}>
      <td>
        <button
          className={`star ${w.isDefault ? 'on' : ''}`}
          title={w.isDefault ? 'Varsayılan cüzdan' : 'Varsayılan yap'}
          disabled={w.isDefault || !trader || !online}
          onClick={() => makeDefault(w.address)}
        >
          {w.isDefault ? '★' : '☆'}
        </button>
      </td>
      <td>
        <input
          className="input-sm"
          value={label}
          maxLength={40}
          placeholder="Etiket"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== (w.label ?? '') && setPref(w.address, { label: label.trim() || null })}
        />
      </td>
      <td className="mono">
        <button
          className="link"
          title="Kopyala"
          onClick={async () => {
            await navigator.clipboard.writeText(w.address)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? 'Kopyalandı' : `${w.address.slice(0, 6)}…${w.address.slice(-6)}`}
        </button>
      </td>
      <td className="mono">{w.balance !== undefined ? `${w.balance.toFixed(4)} SOL` : <span className="faint">—</span>}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <a className="btn btn-xs" href={`https://solscan.io/account/${w.address}`} target="_blank" rel="noreferrer">
          Solscan
        </a>{' '}
        {!w.isDefault && (
          <button className="btn btn-xs" onClick={() => setPref(w.address, { hidden: !w.hidden })}>
            {w.hidden ? 'Göster' : 'Gizle'}
          </button>
        )}
      </td>
    </tr>
  )
}
