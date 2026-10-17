import { useState } from 'react'
import { Keyboard, Plus, RotateCcw, X } from 'lucide-react'
import { usePrefs } from '../../lib/prefs'
import { Section } from '../../components/ui'
import { DEFAULT_KEYBINDS, KEY_ACTIONS, keyCombo, type KeyAction } from '../../../../shared/settings'

// Klavye kısayolları: atanmış kısayollar listelenir; tuşa tıklayıp yeni kombinasyona basarak değiştirilir,
// × ile kaldırılır. "Kısayol ekle" atanmamış bir eylem seçtirir ve tuş bekler. Esc iptal eder.

export function ShortcutsSection() {
  const { keybinds, setKeybinds } = usePrefs()
  const [editing, setEditing] = useState<KeyAction | null>(null)
  const [adding, setAdding] = useState<KeyAction | ''>('')
  const [error, setError] = useState<string | null>(null)
  const all = Object.keys(KEY_ACTIONS) as KeyAction[]
  const assigned = all.filter((a) => keybinds[a])
  const free = all.filter((a) => !keybinds[a])

  const bind = (action: KeyAction, e: React.KeyboardEvent) => {
    e.preventDefault()
    // Yakalanan tuş, kısayol olarak hemen çalışmasın
    e.nativeEvent.stopImmediatePropagation()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setEditing(null)
      setAdding('')
      return
    }
    const combo = keyCombo(e)
    if (!combo) return
    const clash = all.find((a) => a !== action && keybinds[a] === combo)
    if (clash) return setError(`${combo} zaten "${KEY_ACTIONS[clash]}" için kullanılıyor.`)
    setError(null)
    setKeybinds({ ...keybinds, [action]: combo })
    setEditing(null)
    setAdding('')
  }

  return (
    <div>
      {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}

      <Section
        icon={Keyboard}
        title="Kısayollar"
        count={assigned.length}
        actions={
          <button className="btn btn-sm btn-ghost" onClick={() => (setKeybinds(DEFAULT_KEYBINDS), setError(null))}>
            <RotateCcw size={13} /> Varsayılanlar
          </button>
        }
        note="Tuşa tıklayıp yeni kombinasyona basın (Esc iptal). Yazı alanlarındayken kısayollar çalışmaz (F tuşları hariç)."
      >
        <div className="list">
          {assigned.map((a) => (
            <div key={a} className="list-row">
              <div className="list-row-main">
                <span className="list-row-title">{KEY_ACTIONS[a]}</span>
              </div>
              <button
                className={`btn btn-sm mono ${editing === a ? 'btn-primary' : ''}`}
                style={{ minWidth: 120 }}
                onClick={() => setEditing(a)}
                onKeyDown={(e) => editing === a && bind(a, e)}
                onBlur={() => setEditing(null)}
              >
                {editing === a ? 'Tuşa basın…' : keybinds[a]}
              </button>
              <button className="icon-btn danger" title="Kısayolu kaldır" onClick={() => setKeybinds({ ...keybinds, [a]: '' })}>
                <X size={14} />
              </button>
            </div>
          ))}
          {assigned.length === 0 && <div className="empty">Atanmış kısayol yok.</div>}
        </div>
      </Section>

      <Section icon={Plus} title="Kısayol ekle" note={free.length ? 'Bir eylem seçin, ardından düğmeye tıklayıp tuş kombinasyonuna basın.' : 'Bütün eylemlere kısayol atanmış.'}>
        {free.length > 0 && (
          <div className="setting-row">
            <select className="input-sm" value={adding} onChange={(e) => setAdding(e.target.value as KeyAction | '')}>
              <option value="">Eylem seçin…</option>
              {free.map((a) => (
                <option key={a} value={a}>
                  {KEY_ACTIONS[a]}
                </option>
              ))}
            </select>
            <button
              className={`btn btn-sm mono ${adding ? 'btn-primary' : ''}`}
              style={{ minWidth: 160 }}
              disabled={!adding}
              onKeyDown={(e) => adding && bind(adding, e)}
              title="Tıklayıp tuş kombinasyonuna basın"
            >
              {adding ? 'Tuşa basın…' : 'Önce eylem seçin'}
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}
