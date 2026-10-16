import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { errText, useEngine } from './engine'
import type { WalletInfo } from '../../../shared/types'

// GMGN'e bağlı cüzdanlar (motordan) + kullanıcının etiket/gizleme tercihleri (wallet_prefs).
// Varsayılan (işlem) cüzdanı motorda saklanır; değiştirmek "gmgn.wallet" komutuyla.

export interface WalletRow extends WalletInfo {
  label: string | null
  hidden: boolean
  isDefault: boolean
}

let cache: { userId: string; wallets: WalletInfo[]; at: number } | null = null

export function useWallets() {
  const { profile } = useAuth()
  const { me, run, online } = useEngine()
  const [wallets, setWallets] = useState<WalletInfo[]>(cache && cache.userId === profile?.id ? cache.wallets : [])
  const [prefs, setPrefs] = useState<Record<string, { label: string | null; hidden: boolean }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = me?.gmgn.wallet ?? null

  const loadPrefs = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase.from('wallet_prefs').select('address, label, hidden').eq('user_id', profile.id)
    setPrefs(Object.fromEntries(((data as { address: string; label: string | null; hidden: boolean }[]) ?? []).map((p) => [p.address, p])))
  }, [profile?.id])

  const refresh = useCallback(async () => {
    if (!profile || !online) return
    setBusy(true)
    setError(null)
    try {
      const r = await run('gmgn.wallets', {})
      cache = { userId: profile.id, wallets: r.wallets, at: Date.now() }
      setWallets(r.wallets)
      if (!r.wallets.length) setError('Bu API anahtarına bağlı Solana cüzdanı bulunamadı. gmgn.ai/ai sayfasından cüzdan bağlayın.')
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }, [profile?.id, online, run])

  useEffect(() => {
    loadPrefs()
    // Bakiyeler 1 dk'dan eskiyse ya da hiç yoksa getir
    if (me?.gmgn.configured && (!cache || cache.userId !== profile?.id || Date.now() - cache.at > 60_000)) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, me?.gmgn.configured, online])

  const setPref = async (address: string, patch: { label?: string | null; hidden?: boolean }) => {
    const cur = prefs[address] ?? { label: null, hidden: false }
    const next = { ...cur, ...patch }
    setPrefs((p) => ({ ...p, [address]: next }))
    await supabase
      .from('wallet_prefs')
      .upsert({ user_id: profile!.id, address, label: next.label, hidden: next.hidden, updated_at: new Date().toISOString() }, { onConflict: 'user_id,address' })
  }

  const makeDefault = async (address: string) => {
    setError(null)
    try {
      await run('gmgn.wallet', { address })
    } catch (e) {
      setError(errText(e))
    }
  }

  // Seçili cüzdan listede yoksa (ör. bakiyeler henüz gelmedi) yine de göster
  const all = selected && !wallets.some((w) => w.address === selected) ? [{ address: selected }, ...wallets] : wallets
  const rows: WalletRow[] = all.map((w) => ({
    ...w,
    label: prefs[w.address]?.label ?? null,
    hidden: prefs[w.address]?.hidden ?? false,
    isDefault: w.address === selected
  }))

  return { rows, selected, busy, error, refresh, setPref, makeDefault }
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`
