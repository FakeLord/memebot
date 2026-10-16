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
    <div className="stack">
      <p className="faint" style={{ fontSize: 12 }}>
        Satıra tıklayıp yeni tuş kombinasyonuna basın (Esc iptal). Yazı alanlarındayken kısayollar çalışmaz (F tuşları hariç).
      </p>
      {error && <div className="notice error">{error}</div>}
      <div>
        {(Object.keys(KEY_ACTIONS) as KeyAction[]).map((a) => (
          <div key={a} className="setting-row">
            <span className="setting-row-title">{KEY_ACTIONS[a]}</span>
            <button
              className={`btn btn-sm mono ${editing === a ? 'btn-primary' : ''}`}
              style={{ minWidth: 110 }}
              onClick={() => setEditing(a)}
              onKeyDown={capture}
              onBlur={() => setEditing(null)}
            >
              {editing === a ? 'Tuşa basın…' : keybinds[a]}
            </button>
          </div>
        ))}
      </div>
      <div>
        <button className="btn btn-sm btn-ghost" onClick={() => setKeybinds(DEFAULT_KEYBINDS)}>
          Varsayılanlara dön
        </button>
      </div>
    </div>
  )
}
