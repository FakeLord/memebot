import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { usePipeline } from './pipeline'
import { keywordRegex, type FeedItem, type KeywordMatch } from '../../../shared/feed'
import {
  DEFAULT_KEYBINDS,
  isLight,
  presetFromRow,
  presetToRow,
  resolvePreset,
  themeColors,
  type FeePreset,
  type FeePresetRow,
  type KeyAction,
  type PresetKind,
  type PresetSlot,
  type ThemeSetting
} from '../../../shared/settings'

// Kullanıcı ayarları (Supabase'de, cihazlar arası senkron): tema, kısayollar, anahtar kelimeler,
// ücret preset'leri. Yeni gönderi bildirimleri (ses + masaüstü bildirimi) de buradan.

export interface Keyword {
  id: string
  pattern: string
  match: KeywordMatch
  color: string | null
  sound: boolean
  notify: boolean
  muted: boolean
}

export interface UiLayout {
  deployForm?: 'modal' | 'side'
  deployPlatform?: 'pump' | 'bonk' | 'bags'
  openAfterDeploy?: 'gmgn' | 'solscan' | 'none'
  /** Alt çubuktaki canlı fiyatlar: gösterilen coinler (boş dizi = kapalı); tanımsızsa varsayılan 4 coin */
  ticker?: string[]
}

interface PrefsCtx {
  theme: ThemeSetting
  setTheme: (t: ThemeSetting) => Promise<void>
  keybinds: Record<KeyAction, string>
  setKeybinds: (k: Record<KeyAction, string>) => Promise<void>
  layout: UiLayout
  setLayout: (l: UiLayout) => Promise<void>
  keywords: Keyword[]
  reloadKeywords: () => Promise<void>
  presets: FeePreset[]
  preset: (slot: PresetSlot, kind: PresetKind) => FeePreset
  savePreset: (p: FeePreset) => Promise<string | null>
  resetPreset: (slot: PresetSlot, kind: PresetKind) => Promise<void>
  activePreset: PresetSlot
  setActivePreset: (s: PresetSlot) => Promise<void>
}

const Ctx = createContext<PrefsCtx | null>(null)

/** Temayı CSS değişkenlerine uygular (bütün uygulama anında değişir). */
export function applyTheme(t: ThemeSetting | null | undefined) {
  const c = themeColors(t)
  const r = document.documentElement.style
  r.setProperty('--bg', c.bg)
  r.setProperty('--surface', c.surface)
  r.setProperty('--surface-2', `color-mix(in srgb, ${c.surface} 92%, ${c.text} 6%)`)
  r.setProperty('--accent', c.accent)
  r.setProperty('--accent-text', isLight(c.accent) ? '#0b0b0c' : '#ffffff')
  r.setProperty('--text', c.text)
  r.setProperty('--muted', c.muted)
  r.setProperty('--faint', `color-mix(in srgb, ${c.muted} 65%, ${c.bg})`)
  r.setProperty('--border', c.border)
  r.setProperty('--hl', `color-mix(in srgb, ${c.text} 18%, ${c.surface})`)
  r.setProperty('color-scheme', isLight(c.bg) ? 'light' : 'dark')
}

// Kısa "bip" sesi (dosya gerektirmez)
function beep() {
  try {
    const ac = new AudioContext()
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.08, ac.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25)
    o.connect(g).connect(ac.destination)
    o.start()
    o.stop(ac.currentTime + 0.25)
  } catch {
    /* ses kapalı olabilir */
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { rule, saveRule } = usePipeline()
  const [theme, setThemeState] = useState<ThemeSetting>({ preset: 'default' })
  const [keybinds, setKeybindsState] = useState<Record<KeyAction, string>>(DEFAULT_KEYBINDS)
  const [layout, setLayoutState] = useState<UiLayout>({})
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [presets, setPresets] = useState<FeePreset[]>([])
  const kwRef = useRef(keywords)
  kwRef.current = keywords

  // --- arayüz ayarları
  useEffect(() => {
    if (!profile) return
    supabase
      .from('ui_settings')
      .select('theme, keybinds, layout')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        const t = (data?.theme as ThemeSetting) ?? { preset: 'default' }
        setThemeState(t.preset ? t : { preset: 'default' })
        applyTheme(t)
        setKeybindsState({ ...DEFAULT_KEYBINDS, ...((data?.keybinds as Partial<Record<KeyAction, string>>) ?? {}) })
        setLayoutState((data?.layout as UiLayout) ?? {})
      })
  }, [profile?.id])

  const saveUi = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!profile) return
      await supabase.from('ui_settings').upsert({ user_id: profile.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    },
    [profile?.id]
  )

  const setTheme = useCallback(
    async (t: ThemeSetting) => {
      setThemeState(t)
      applyTheme(t)
      await saveUi({ theme: t, keybinds, layout })
    },
    [saveUi, keybinds, layout]
  )
  const setKeybinds = useCallback(
    async (k: Record<KeyAction, string>) => {
      setKeybindsState(k)
      await saveUi({ theme, keybinds: k, layout })
    },
    [saveUi, theme, layout]
  )
  const setLayout = useCallback(
    async (l: UiLayout) => {
      setLayoutState(l)
      await saveUi({ theme, keybinds, layout: l })
    },
    [saveUi, theme, keybinds]
  )

  // --- anahtar kelimeler
  const reloadKeywords = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('keywords')
      .select('id, pattern, match, color, sound, notify, muted')
      .eq('user_id', profile.id)
      .order('created_at')
    setKeywords((data as Keyword[]) ?? [])
  }, [profile?.id])

  // --- ücret preset'leri
  const reloadPresets = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase.from('fee_presets').select('slot, kind, priority_sol, tip_sol, slippage, anti_mev').eq('user_id', profile.id)
    setPresets(((data as FeePresetRow[]) ?? []).map(presetFromRow))
  }, [profile?.id])

  useEffect(() => {
    reloadKeywords()
    reloadPresets()
  }, [reloadKeywords, reloadPresets])

  const preset = useCallback((slot: PresetSlot, kind: PresetKind) => resolvePreset(presets, slot, kind, rule.limits), [presets, rule.limits])

  const savePreset = useCallback(
    async (p: FeePreset) => {
      if (!profile) return 'Oturum yok'
      const { error } = await supabase
        .from('fee_presets')
        .upsert({ user_id: profile.id, ...presetToRow(p), updated_at: new Date().toISOString() }, { onConflict: 'user_id,slot,kind' })
      if (error) return error.message
      await reloadPresets()
      return null
    },
    [profile?.id, reloadPresets]
  )

  const resetPreset = useCallback(
    async (slot: PresetSlot, kind: PresetKind) => {
      if (!profile) return
      await supabase.from('fee_presets').delete().eq('user_id', profile.id).eq('slot', slot).eq('kind', kind)
      await reloadPresets()
    },
    [profile?.id, reloadPresets]
  )

  const setActivePreset = useCallback(
    async (s: PresetSlot) => {
      if (s === rule.limits.activePreset) return
      await saveRule({ ...rule, limits: { ...rule.limits, activePreset: s } })
    },
    [rule, saveRule]
  )

  // --- yeni gönderi bildirimi: bildirim açık anahtar kelime ya da kaynak eşleşirse
  useEffect(() => {
    if (!profile) return
    let notifySources = new Set<string>()
    const loadSources = async () => {
      const { data } = await supabase.from('sources').select('id').eq('user_id', profile.id).eq('notify', true)
      notifySources = new Set(((data as { id: string }[]) ?? []).map((s) => s.id))
    }
    loadSources()
    const t = setInterval(loadSources, 30_000)
    const ch = supabase
      .channel('prefs-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feed_items', filter: `user_id=eq.${profile.id}` }, (p) => {
        const item = p.new as FeedItem
        const hits = kwRef.current.filter((k) => !k.muted && (k.notify || k.sound) && keywordRegex(k)?.test(item.text))
        const bySource = !!item.source_id && notifySources.has(item.source_id)
        if (hits.some((k) => k.sound)) beep()
        if ((bySource || hits.some((k) => k.notify)) && 'Notification' in window && Notification.permission === 'granted') {
          const who = item.author?.name ?? item.author?.handle ?? (item.platform === 'x' ? 'X' : 'Telegram')
          new Notification(`${who}${hits.length ? ` · ${hits.map((k) => k.pattern).join(', ')}` : ''}`, { body: item.text.slice(0, 180), silent: true })
        }
      })
      .subscribe()
    return () => {
      clearInterval(t)
      supabase.removeChannel(ch)
    }
  }, [profile?.id])

  return (
    <Ctx.Provider
      value={{
        theme,
        setTheme,
        keybinds,
        setKeybinds,
        layout,
        setLayout,
        keywords,
        reloadKeywords,
        presets,
        preset,
        savePreset,
        resetPreset,
        activePreset: rule.limits.activePreset,
        setActivePreset
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function usePrefs(): PrefsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePrefs PrefsProvider dışında kullanıldı')
  return c
}
