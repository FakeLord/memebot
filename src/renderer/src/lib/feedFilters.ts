import { useCallback, useSyncExternalStore } from 'react'

// Canlı Akış filtreleri. Sayfalar arasında gezince sıfırlanmasın diye modül düzeyinde tutulur ve cihazda saklanır.

export interface FeedFilters {
  /** Gönderi kartları gösterilsin mi */
  showFeed: boolean
  /** Sinyal satırları gösterilsin mi (ikisi de açıksa tek zaman çizelgesinde karışık) */
  showSignals: boolean
  platform: 'all' | 'x' | 'telegram'
  /** Sadece token adresi içerenler */
  withMint: boolean
  /** Sadece anahtar kelime eşleşenler */
  keywordOnly: boolean
  pinnedOnly: boolean
  showHidden: boolean
  /** Tek bir kaynak (hesap/kanal) id'si; 'all' hepsi */
  source: string
  query: string
}

export const DEFAULT_FILTERS: FeedFilters = {
  showFeed: true,
  showSignals: false,
  platform: 'all',
  withMint: false,
  keywordOnly: false,
  pinnedOnly: false,
  showHidden: false,
  source: 'all',
  query: ''
}

const KEY = 'memebot.feedFilters'

function read(): FeedFilters {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<FeedFilters>) }
      // En az biri açık kalmalı
      if (!v.showFeed && !v.showSignals) v.showFeed = true
      return v
    }
  } catch {
    /* bozuk ya da kapalı depolama: varsayılan */
  }
  return DEFAULT_FILTERS
}

let state = read()
const listeners = new Set<() => void>()

function set(next: FeedFilters) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* depolama kapalı olabilir */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useFeedFilters(): [FeedFilters, (patch: Partial<FeedFilters>) => void, () => void] {
  const f = useSyncExternalStore(subscribe, () => state)
  const patch = useCallback((p: Partial<FeedFilters>) => {
    const next = { ...state, ...p }
    if (!next.showFeed && !next.showSignals) {
      // Son açık görünümü kapatmaya izin verme
      if ('showFeed' in p) next.showFeed = true
      else next.showSignals = true
    }
    set(next)
  }, [])
  const reset = useCallback(() => set({ ...DEFAULT_FILTERS, showFeed: state.showFeed, showSignals: state.showSignals }), [])
  return [f, patch, reset]
}

/** Varsayılandan farklı (kullanıcının açtığı) filtre sayısı: "temizle" düğmesi ve rozet için */
export function activeFilterCount(f: FeedFilters): number {
  return (
    (f.platform !== 'all' ? 1 : 0) +
    (f.withMint ? 1 : 0) +
    (f.keywordOnly ? 1 : 0) +
    (f.pinnedOnly ? 1 : 0) +
    (f.showHidden ? 1 : 0) +
    (f.source !== 'all' ? 1 : 0) +
    (f.query.trim() ? 1 : 0)
  )
}
