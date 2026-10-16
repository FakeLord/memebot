import { useState } from 'react'
import { BadgeCheck, ClipboardPaste, Copy, Users, X as XIcon, Zap } from 'lucide-react'
import { usePrefs } from '../../lib/prefs'
import { HEX, THEMES, isLight, themeColors, type ThemeColors } from '../../../../shared/settings'

// Görünüm: canlı önizleme + hazır temalar + özel palet (6 renk). Değişiklik anında uygulanır ve hesabınıza kaydedilir.

const COLOR_LABEL: Record<keyof ThemeColors, string> = {
  bg: 'Arka plan',
  surface: 'Kartlar',
  accent: 'Vurgu',
  text: 'Metin',
  muted: 'Soluk metin',
  border: 'Kenarlıklar'
}

export function AppearanceSection() {
  const { theme, setTheme } = usePrefs()
  const [json, setJson] = useState<string | null>(null)
  const [mode, setMode] = useState<'dark' | 'light'>(isLight(themeColors(theme).bg) ? 'light' : 'dark')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const colors = themeColors(theme)

  const setColor = (k: keyof ThemeColors, v: string) => setTheme({ preset: 'custom', colors: { ...colors, [k]: v } })

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify({ preset: 'custom', colors }, null, 2))
    setMsg({ kind: 'ok', text: 'Tema JSON olarak kopyalandı.' })
  }

  const pasteJson = () => {
    try {
      const t = JSON.parse(json ?? '') as { colors?: Partial<ThemeColors> }
      const c = t.colors ?? (t as Partial<ThemeColors>)
      const bad = Object.entries(c).filter(([, v]) => typeof v !== 'string' || !HEX.test(v))
      if (!Object.keys(c).length || bad.length) throw new Error()
      setTheme({ preset: 'custom', colors: { ...colors, ...c } })
      setJson(null)
      setMsg({ kind: 'ok', text: 'Tema uygulandı.' })
    } catch {
      setMsg({ kind: 'error', text: 'Geçersiz tema JSON\'u (renkler #rrggbb olmalı).' })
    }
  }

  const themes = Object.entries(THEMES).filter(([, t]) => isLight(t.colors.bg) === (mode === 'light'))

  return (
    <div className="stack">
      <div>
        <div className="section-label">Önizleme</div>
        <article className="post theme-preview">
          <div className="post-inner">
            <header className="post-head">
              <span className="avatar avatar-text" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                M
              </span>
              <div className="post-who">
                <div className="post-line">
                  <span className="post-name">MemeBot</span>
                  <span className="verified">
                    <BadgeCheck size={14} />
                  </span>
                  <span className="post-time">2 dk</span>
                </div>
                <div className="post-sub">
                  @memebot <span>•</span> <Users size={10} /> 12.4K
                </div>
              </div>
              <div className="post-head-actions">
                <span className="icon-btn">
                  <XIcon size={15} />
                </span>
                <span className="deploy-btn">
                  <Zap size={13} /> Deploy
                </span>
              </div>
            </header>
            <div className="post-body">
              Akıştaki kartlar böyle görünür. <mark className="hl hl-ticker">$MEME</mark> ve <mark className="hl">"anahtar kelimeler"</mark> vurgulanır;
              değişiklikler anında uygulanır.
            </div>
          </div>
        </article>
      </div>

      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="section-label">Renk teması</div>
          <div className="pills">
            <button className="pill" aria-selected={mode === 'dark'} onClick={() => setMode('dark')}>
              Koyu
            </button>
            <button className="pill" aria-selected={mode === 'light'} onClick={() => setMode('light')}>
              Açık
            </button>
          </div>
        </div>
        <div className="theme-grid">
          {themes.map(([id, t]) => (
            <ThemeTile key={id} label={t.label} c={t.colors} on={theme.preset === id} onClick={() => setTheme({ preset: id })} />
          ))}
          <ThemeTile label="Özel" c={colors} on={theme.preset === 'custom'} onClick={() => setTheme({ preset: 'custom', colors })} />
        </div>
      </div>

      <div>
        <div className="section-label">Özel palet</div>
        <div className="palette">
          {(Object.keys(COLOR_LABEL) as (keyof ThemeColors)[]).map((k) => (
            <label key={k} className="palette-item" title={colors[k]}>
              <span className="palette-dot" style={{ background: colors[k] }}>
                <input type="color" value={colors[k]} onChange={(e) => setColor(k, e.target.value)} />
              </span>
              {COLOR_LABEL[k]}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={copyJson}>
            <Copy size={13} /> JSON kopyala
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setJson(json === null ? '' : null)}>
            <ClipboardPaste size={13} /> JSON yapıştır
          </button>
        </div>
        {json !== null && (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <textarea rows={4} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"colors": {"bg": "#111113", ...}}' autoFocus />
            <div>
              <button className="btn btn-sm btn-primary" disabled={!json.trim()} onClick={pasteJson}>
                Uygula
              </button>
            </div>
          </div>
        )}
        {msg && (
          <div className={`notice ${msg.kind}`} style={{ marginTop: 8 }}>
            {msg.text}
          </div>
        )}
        <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Yeşil (kâr/geçti), kırmızı (zarar/red) ve sarı (uyarı) anlam renkleri sabittir.
        </p>
      </div>
    </div>
  )
}

function ThemeTile({ label, c, on, onClick }: { label: string; c: ThemeColors; on: boolean; onClick: () => void }) {
  return (
    <button className="theme-tile" aria-pressed={on} onClick={onClick}>
      <span className="theme-swatch" style={{ background: c.bg }}>
        <span className="theme-swatch-card" style={{ background: c.surface, border: `1px solid ${c.border}` }} />
        <span className="theme-swatch-dot" style={{ background: c.accent }} />
      </span>
      <span className="theme-name">{label}</span>
    </button>
  )
}
