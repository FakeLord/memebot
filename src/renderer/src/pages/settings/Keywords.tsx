import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { usePrefs, type Keyword } from '../../lib/prefs'
import { highlight, keywordRegex, type KeywordMatch } from '../../../../shared/feed'

// Anahtar kelimeler: akışta vurgulanır, öneri ızgarasına arama terimi olarak gider, isterseniz ses/bildirim verir.
// $TICKER ve "tırnak içi" her zaman vurgulanır (ayrıca eklemeye gerek yok).

const MATCH_LABEL: Record<KeywordMatch, string> = { partial: 'Kısmi', word: 'Tam kelime', regex: 'Regex' }
const SAMPLE = 'Yeni baby dog coin geliyor $DOG "Justice For Dogs" deploy yarın'

export function KeywordsSection() {
  const { profile } = useAuth()
  const { keywords, reloadKeywords } = usePrefs()
  const [pattern, setPattern] = useState('')
  const [match, setMatch] = useState<KeywordMatch>('partial')
  const [error, setError] = useState<string | null>(null)
  const [sample, setSample] = useState(SAMPLE)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (match === 'regex' && !keywordRegex({ pattern, match })) return setError('Geçersiz düzenli ifade.')
    const { error } = await supabase.from('keywords').insert({ user_id: profile!.id, pattern: pattern.trim(), match })
    if (error) return setError(error.code === '23505' ? 'Bu kelime zaten var.' : error.message)
    setPattern('')
    reloadKeywords()
  }

  const update = async (k: Keyword, patch: Partial<Keyword>) => {
    await supabase.from('keywords').update(patch).eq('id', k.id)
    reloadKeywords()
  }

  const remove = async (k: Keyword) => {
    await supabase.from('keywords').delete().eq('id', k.id)
    reloadKeywords()
  }

  const askNotify = async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Anahtar kelimeler</h2>
        <p className="muted">
          Eşleşen kelimeler akış kartlarında vurgulanır ve kartın altındaki token önerilerinde arama terimi olarak kullanılır. <b>$TICKER</b> ve{' '}
          <b>"tırnak içi"</b> her zaman vurgulanır.
        </p>
        {error && <div className="notice error">{error}</div>}
        <form className="row" onSubmit={add}>
          <input style={{ flex: 1 }} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ör. dog, inu, deploy" />
          <select value={match} onChange={(e) => setMatch(e.target.value as KeywordMatch)}>
            {Object.entries(MATCH_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={!pattern.trim()}>
            Ekle
          </button>
        </form>

        {keywords.length === 0 ? (
          <p className="faint">Henüz anahtar kelime yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kelime</th>
                <th>Eşleşme</th>
                <th>Renk</th>
                <th>Ses</th>
                <th>Bildirim</th>
                <th>Sessiz</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id} style={k.muted ? { opacity: 0.5 } : undefined}>
                  <td className="mono">{k.pattern}</td>
                  <td>
                    <select value={k.match} onChange={(e) => update(k, { match: e.target.value as KeywordMatch })}>
                      {Object.entries(MATCH_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <input
                        type="color"
                        className="swatch"
                        value={k.color ?? '#2c2c31'}
                        onChange={(e) => update(k, { color: e.target.value })}
                        title="Vurgu rengi (boş = gri)"
                      />
                      {k.color && (
                        <button className="link faint" onClick={() => update(k, { color: null })}>
                          sıfırla
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <input type="checkbox" checked={k.sound} onChange={(e) => update(k, { sound: e.target.checked })} />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={k.notify}
                      onChange={(e) => {
                        if (e.target.checked) askNotify()
                        update(k, { notify: e.target.checked })
                      }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={k.muted} onChange={(e) => update(k, { muted: e.target.checked })} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-xs btn-danger" onClick={() => remove(k)}>
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <h2>Önizleme</h2>
        <input value={sample} onChange={(e) => setSample(e.target.value)} />
        <div className="post-body">
          {highlight(sample, { keywords }).map((s, i) =>
            s.mark ? (
              <mark key={i} className={`hl hl-${s.mark}`} style={s.color ? { background: s.color } : undefined}>
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            )
          )}
        </div>
      </div>
    </div>
  )
}
