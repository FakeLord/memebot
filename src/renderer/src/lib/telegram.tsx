import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { extractMints } from '../../../shared/extract'
import type { TelegramMessage, TelegramStatus } from '../../../shared/types'

export interface Source {
  id: string
  chat_id: string
  title: string
  is_active: boolean
}

interface TelegramState {
  status: TelegramStatus
  sources: Source[]
  reloadSources: () => Promise<void>
  lastSignalAt: number | null
}

const TelegramContext = createContext<TelegramState | null>(null)

// Giriş yapan kullanıcı için Telegram oturumunu açar, izlenen sohbetlerden gelen
// mesajlardaki mint adreslerini Supabase'e (record_signal) yazar.
export function TelegramProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [status, setStatus] = useState<TelegramStatus>({ state: 'connecting' })
  const [sources, setSources] = useState<Source[]>([])
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null)
  const byChat = useRef(new Map<string, Source>())

  const reloadSources = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('sources')
      .select('id, chat_id, title, is_active')
      .eq('user_id', profile.id)
      .eq('type', 'telegram')
      .order('title')
    const list = (data as Source[]) ?? []
    setSources(list)
    const active = list.filter((s) => s.is_active)
    byChat.current = new Map(active.map((s) => [s.chat_id, s]))
    await window.api.telegram.setWatched(active.map((s) => s.chat_id))
  }, [profile?.id])

  useEffect(() => {
    if (!profile) return
    const offStatus = window.api.telegram.onStatus(setStatus)
    window.api.telegram.attach(profile.id).then(setStatus)
    reloadSources()
    return () => {
      offStatus()
    }
  }, [profile?.id, reloadSources])

  useEffect(() => {
    return window.api.telegram.onMessage(async (m: TelegramMessage) => {
      const source = byChat.current.get(m.chatId)
      if (!source) return
      const mints = extractMints(m.text)
      for (const mint of mints) {
        const { error } = await supabase.rpc('record_signal', {
          p_source_id: source.id,
          p_msg_id: m.msgId,
          p_mint: mint,
          p_raw_text: m.text,
          p_msg_ts: new Date(m.date * 1000).toISOString()
        })
        if (error) console.error('record_signal', error.message)
      }
      if (mints.length) setLastSignalAt(Date.now())
    })
  }, [])

  return <TelegramContext.Provider value={{ status, sources, reloadSources, lastSignalAt }}>{children}</TelegramContext.Provider>
}

export function useTelegram(): TelegramState {
  const ctx = useContext(TelegramContext)
  if (!ctx) throw new Error('useTelegram TelegramProvider dışında kullanıldı')
  return ctx
}
