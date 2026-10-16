import { useMemo, useState, type FormEvent } from 'react'
import { Bell, BellOff, Download, Eye, EyeOff, Hash, Pencil, Plus, Search, Trash2, Upload, Volume2, VolumeX, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { usePrefs, type Keyword } from '../../lib/prefs'
import { HEX } from '../../../../shared/settings'
import { highlight, keywordRegex, type KeywordMatch } from '../../../../shared/feed'

// Anahtar kelimeler: akışta vurgulanır, öneri ızgarasına arama terimi olarak gider, isterseniz ses/bildirim verir.
// $TICKER ve "tırnak içi" her zaman vurgulanır (yerleşik).

const MATCH_LABEL: Record<KeywordMatch, string> = { partial: 'Kısmi eşleşme', word: 'Tam kelime', regex: 'Regex' }
const DEFAULT_COLOR = '#e8c547'
const SAMPLE = 'Yeni baby dog coin geliyor $DOG "Justice For Dogs" deploy yarın'

export function KeywordsSection() {
  const { profile } = useAuth()
  const { keywords, reloadKeywords } = usePrefs()
  const [adding, setAdding] = useState(false)
  const [pattern, setPattern] = useState('')
  const [match, setMatch] = useState<KeywordMatch>('partial')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sample, setSample] = useState(SAMPLE)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (match === 'regex' && !keywordRegex({ pattern, match })) return setError('Geçersiz düzenli ifade.')
    const { error } = await supabase.from('keywords').insert({ user_id: profile!.id, pattern: pattern.trim(), match, color: DEFAULT_COLOR })
    if (error) return setError(error.code === '23505' ? 'Bu kelime zaten var.' : error.message)
    setPattern('')
    reloadKeywords()
  }

  const update = async (k: Keyword, patch: Partial<Keyword>) => {
    if (patch.match === 'regex' && !keywordRegex({ pattern: patch.pattern ?? k.pattern, match: 'regex' })) return setError('Geçersiz düzenli ifade.')
    const { error } = await supabase.from('keywords').update(patch).eq('id', k.id)
    setError(error ? (error.code === '23505' ? 'Bu kelime zaten var.' : error.message) : null)
    reloadKeywords()
  }

  const remove = async (k: Keyword) => {
    await supabase.from('keywords').delete().eq('id', k.id)
    reloadKeywords()
  }

  const askNotify = async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  }

  const exportJson = () => {
    const data = keywords.map(({ pattern, match, color, sound, notify, muted }) => ({ pattern, match, color, sound, notify, muted }))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    a.download = 'memebot-anahtar-kelimeler.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const importJson = async (file: File) => {
    try {
      const list = JSON.parse(await file.text()) as Partial<Keyword>[]
      const rows = list
        .filter((k) => typeof k.pattern === 'string' && k.pattern.trim())
        .map((k) => ({
          user_id: profile!.id,
          pattern: k.pattern!.trim().slice(0, 200),
          match: (['partial', 'word', 'regex'] as KeywordMatch[]).includes(k.match as KeywordMatch) ? k.match : 'partial',
          color: typeof k.color === 'string' && HEX.test(k.color) ? k.color : DEFAULT_COLOR,
          sound: !!k.sound,
          notify: !!k.notify,
          muted: !!k.muted
        }))
      if (!rows.length) throw new Error()
      const { error } = await supabase.from('keywords').upsert(rows, { onConflict: 'user_id,pattern,match', ignoreDuplicates: true })
      setError(error?.message ?? null)
      reloadKeywords()
    } catch {
      setError('Geçersiz dosya: anahtar kelime JSON listesi bekleniyor.')
    }
  }

  const filtered = useMemo(() => keywords.filter((k) => k.pattern.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))), [keywords, q])

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: -6 }}>
        <button className="btn btn-sm btn-ghost" disabled={!keywords.length} onClick={exportJson}>
          <Download size={13} /> Dışa aktar
        </button>
        <label className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', flexDirection: 'row' }}>
          <Upload size={13} /> İçe aktar
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>

      <div>
        <div className="section-label">
          <Wand2 size={12} /> Yerleşik
        </div>
        <div className="list">
          <BuiltIn color="#f59e0b" title="$TICKER" desc="Her $bahsetme" />
          <BuiltIn color="var(--hl)" title={'"Tırnak içi"'} desc="Tırnak içindeki ifadeler" />
        </div>
      </div>

      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>
            <Hash size={12} /> Özel kelimeler <span className="faint">{keywords.length}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <label className="search sm" style={{ width: 180 }}>
              <Search size={12} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara" />
            </label>
            <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
              <Plus size={13} /> Kelime ekle
            </button>
          </div>
        </div>
        {error && (
          <div className="notice error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        {adding && (
          <form className="row card" style={{ padding: 10, marginBottom: 8 }} onSubmit={add}>
            <input style={{ flex: 1 }} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ör. dog, inu, deploy" autoFocus />
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
        )}
        {filtered.length === 0 ? (
          <div className="empty">{keywords.length ? 'Aramaya uyan kelime yok.' : 'Henüz anahtar kelime yok.'}</div>
        ) : (
          <div className="list">
            {filtered.map((k) => (
              <KeywordRow
                key={k.id}
                k={k}
                editing={editing === k.id}
                setEditing={(on) => setEditing(on ? k.id : null)}
                update={update}
                remove={remove}
                askNotify={askNotify}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="section-label">Önizleme</div>
        <div className="card stack" style={{ gap: 10 }}>
          <input value={sample} onChange={(e) => setSample(e.target.value)} />
          <div className="post-body">
            {highlight(sample, { keywords }).map((s, i) =>
              s.mark ? (
                <mark key={i} className={`hl hl-${s.mark}`} style={s.color ? { background: s.color, color: '#16130a' } : undefined}>
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function BuiltIn({ color, title, desc }: { color: string; title: string; desc: string }) {
  return (
    <div className="list-row">
      <span className="swatch-sq" style={{ background: color, cursor: 'default' }} />
      <div className="list-row-main">
        <span className="list-row-title">{title}</span>
        <span className="list-row-sub">{desc}</span>
      </div>
      <button className="toggle" role="switch" aria-checked disabled title="Her zaman açık" />
    </div>
  )
}

function KeywordRow({
  k,
  editing,
  setEditing,
  update,
  remove,
  askNotify
}: {
  k: Keyword
  editing: boolean
  setEditing: (on: boolean) => void
  update: (k: Keyword, patch: Partial<Keyword>) => Promise<void>
  remove: (k: Keyword) => Promise<void>
  askNotify: () => Promise<void>
}) {
  const [pattern, setPattern] = useState(k.pattern)
  const [match, setMatch] = useState(k.match)
  return (
    <div className={`list-row ${k.muted ? 'dim' : ''}`}>
      <label className="swatch-sq" style={{ background: k.color ?? 'var(--hl)' }} title="Vurgu rengi">
        <input type="color" value={k.color ?? DEFAULT_COLOR} onChange={(e) => update(k, { color: e.target.value })} />
      </label>
      {editing ? (
        <form
          className="row"
          style={{ flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault()
            update(k, { pattern: pattern.trim(), match }).then(() => setEditing(false))
          }}
        >
          <input className="input-sm" style={{ flex: 1 }} value={pattern} onChange={(e) => setPattern(e.target.value)} autoFocus />
          <select className="input-sm" value={match} onChange={(e) => setMatch(e.target.value as KeywordMatch)}>
            {Object.entries(MATCH_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn btn-xs btn-primary" disabled={!pattern.trim()}>
            Kaydet
          </button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditing(false)}>
            Vazgeç
          </button>
        </form>
      ) : (
        <div className="list-row-main">
          <span className="list-row-title">{k.pattern}</span>
          <span className="list-row-sub">{MATCH_LABEL[k.match]}</span>
        </div>
      )}
      <div className="list-row-actions">
        <button className={`icon-btn ${k.sound ? 'on' : ''}`} title={k.sound ? 'Ses açık' : 'Ses kapalı'} onClick={() => update(k, { sound: !k.sound })}>
          {k.sound ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>
        <button
          className={`icon-btn ${k.notify ? 'on' : ''}`}
          title={k.notify ? 'Bildirim açık' : 'Bildirim kapalı'}
          onClick={() => {
            if (!k.notify) askNotify()
            update(k, { notify: !k.notify })
          }}
        >
          {k.notify ? <Bell size={13} /> : <BellOff size={13} />}
        </button>
        <button className="icon-btn" title={k.muted ? 'Kelimeyi etkinleştir' : 'Kelimeyi devre dışı bırak'} onClick={() => update(k, { muted: !k.muted })}>
          {k.muted ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button className="icon-btn" title="Düzenle" onClick={() => setEditing(!editing)}>
          <Pencil size={13} />
        </button>
        <button className="icon-btn danger" title="Sil" onClick={() => remove(k)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
