import { useState } from 'react'
import { usePrefs } from '../../lib/prefs'
import { DEFAULT_KEYBINDS, KEY_ACTIONS, keyCombo, type KeyAction } from '../../../../shared/settings'

// Klavye kısayolları: satıra tıklayıp yeni tuş kombinasyonuna basın. Esc iptal eder.

export function ShortcutsSection() {
  const { keybinds, setKeybinds } = usePrefs()
  const [editing, setEditing] = useState<KeyAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const capture = (e: React.KeyboardEvent) => {
    if (!editing) return
    e.preventDefault()
    if (e.key === 'Escape') return setEditing(null)
    const combo = keyCombo(e)
    if (!combo) return
    const clash = (Object.keys(keybinds) as KeyAction[]).find((a) => a !== editing && keybinds[a] === combo)
    if (clash) return setError(`${combo} zaten "${KEY_ACTIONS[clash]}" için kullanılıyor.`)
    setError(null)
    setKeybinds({ ...keybinds, [editing]: combo })
    setEditing(null)
  }

  return (
    <div className="card stack">
      <h2>Kısayollar</h2>
      <p className="muted">Yazı alanlarındayken kısayollar çalışmaz (F tuşları hariç).</p>
      {error && <div className="notice error">{error}</div>}
      <table>
        <tbody>
          {(Object.keys(KEY_ACTIONS) as KeyAction[]).map((a) => (
            <tr key={a}>
              <td>{KEY_ACTIONS[a]}</td>
              <td style={{ textAlign: 'right' }}>
                <button className={`btn btn-sm mono ${editing === a ? 'btn-primary' : ''}`} onClick={() => setEditing(a)} onKeyDown={capture} onBlur={() => setEditing(null)}>
                  {editing === a ? 'Tuşa basın…' : keybinds[a]}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button className="btn btn-sm" onClick={() => setKeybinds(DEFAULT_KEYBINDS)}>
          Varsayılanlara dön
        </button>
      </div>
    </div>
  )
}
