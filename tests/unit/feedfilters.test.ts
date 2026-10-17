import { describe, expect, it } from 'vitest'
import { activeFilterCount, DEFAULT_FILTERS } from '../../src/renderer/src/lib/feedFilters'

describe('akış filtreleri', () => {
  it('varsayılan filtrede etkin filtre yok', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
  })

  it('her etkin filtreyi sayar; görünüm düğmeleri (Akış/Sinyaller) saymaz', () => {
    const f = { ...DEFAULT_FILTERS, showSignals: true, platform: 'telegram' as const, withMint: true, query: ' dog ', source: 'abc' }
    expect(activeFilterCount(f)).toBe(4)
    expect(activeFilterCount({ ...f, keywordOnly: true, pinnedOnly: true, showHidden: true })).toBe(7)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, query: '   ' })).toBe(0)
  })
})
