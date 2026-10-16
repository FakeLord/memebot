import { useState } from 'react'
import { usePrefs } from '../../lib/prefs'
import { HEX, THEMES, themeColors, type ThemeColors } from '../../../../shared/settings'

// Görünüm: hazır temalar + özel palet (6 renk). Değişiklik anında uygulanır ve hesabınıza kaydedilir.

const COLOR_LABEL: Record<keyof ThemeColors, string> = {
  bg: 'Arka plan',
  surface: 'Kartlar',
  accent: 'Vurgu (birincil buton)',
  text: 'Metin',
  muted: 'Soluk metin',
  border: 'Kenarlıklar'
}

export function AppearanceSection() {
  const { theme, setTheme } = usePrefs()
  const [json, setJson] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const colors = themeColors(theme)

  const setColor = (k: keyof ThemeColors, v: string) => setTheme({ preset: 'custom', colors: { ...colors, [k]: v } })

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify({ preset: 'custom', colors }, null, 2))
    setMsg({ kind: 'ok', text: 'Tema JSON olarak kopyalandı.' })
  }

  const pasteJson = () => {
    try {
      const t = JSON.parse(json) as { colors?: Partial<ThemeColors> }
      const c = t.colors ?? (t as Partial<ThemeColors>)
      const bad = Object.entries(c).filter(([, v]) => typeof v !== 'string' || !HEX.test(v))
      if (!Object.keys(c).length || bad.length) throw new Error()
      setTheme({ preset: 'custom', colors: { ...colors, ...c } })
      setJson('')
      setMsg({ kind: 'ok', text: 'Tema uygulandı.' })
    } catch {
      setMsg({ kind: 'error', text: 'Geçersiz tema JSON\'u (renkler #rrggbb olmalı).' })
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Tema</h2>
        <div className="theme-grid">
          {Object.entries(THEMES).map(([id, t]) => (
            <button key={id} className="theme-tile" aria-pressed={theme.preset === id} onClick={() => setTheme({ preset: id })}>
              <span className="theme-swatch" style={{ background: t.colors.bg, borderColor: t.colors.border }}>
                <span style={{ background: t.colors.surface, borderColor: t.colors.border }} />
                <span style={{ background: t.colors.accent }} />
              </span>
              {t.label}
            </button>
          ))}
          <button className="theme-tile" aria-pressed={theme.preset === 'custom'} onClick={() => setTheme({ preset: 'custom', colors })}>
            <span className="theme-swatch" style={{ background: colors.bg, borderColor: colors.border }}>
              <span style={{ background: colors.surface, borderColor: colors.border }} />
              <span style={{ background: colors.accent }} />
            </span>
            Özel
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Özel palet</h2>
        <div className="grid-2">
          {(Object.keys(COLOR_LABEL) as (keyof ThemeColors)[]).map((k) => (
            <label key={k} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{COLOR_LABEL[k]}</span>
              <span className="row" style={{ gap: 6 }}>
                <span className="mono faint">{colors[k]}</span>
                <input type="color" className="swatch" value={colors[k]} onChange={(e) => setColor(k, e.target.value)} />
              </span>
            </label>
          ))}
        </div>
        <p className="faint">Yeşil (kâr/geçti), kırmızı (zarar/red) ve sarı (uyarı) anlam renkleri sabittir.</p>
      </div>

      <div className="card stack">
        <h2>Paylaş</h2>
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <div className="row">
          <button className="btn" onClick={copyJson}>
            JSON'u kopyala
          </button>
        </div>
        <textarea rows={4} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"colors": {"bg": "#0b0b0c", ...}}' />
        <div>
          <button className="btn" disabled={!json.trim()} onClick={pasteJson}>
            JSON'dan uygula
          </button>
        </div>
      </div>
    </div>
  )
}
