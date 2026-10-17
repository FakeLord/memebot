import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

// Alt çubuk rozetleri: görülmemiş sinyal sayısı ve açık pozisyon sayısı.
// "Görüldü" işareti yalnızca bu cihazda (localStorage); canlı akış ekranına bakınca sıfırlanır.

const KEY = 'memebot.signalsSeen'

const readSeen = (): string => {
  try {
    return localStorage.getItem(KEY) ?? new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

export function useBadges(viewingFeed: boolean) {
  const { profile } = useAuth()
  const [unseen, setUnseen] = useState(0)
  const [openCount, setOpenCount] = useState(0)
  const seen = useRef(readSeen())

  // Canlı akışa bakılıyorsa her şey görülmüş sayılır
  useEffect(() => {
    if (!viewingFeed) return
    seen.current = new Date().toISOString()
    try {
      localStorage.setItem(KEY, seen.current)
    } catch {
      /* depolama kapalı olabilir */
    }
    setUnseen(0)
  }, [viewingFeed])

  useEffect(() => {
    if (!profile) return
    const loadUnseen = () =>
      supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gt('received_at', seen.current)
        .then(({ count }) => setUnseen(count ?? 0))
    const loadOpen = () =>
      supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('status', 'open')
        .then(({ count }) => setOpenCount(count ?? 0))
    if (!viewingFeed) loadUnseen()
    loadOpen()
    const ch = supabase
      .channel('statusbar-badges')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `user_id=eq.${profile.id}` }, () => {
        if (!document.hidden && viewingFeed) {
          seen.current = new Date().toISOString()
        } else setUnseen((n) => n + 1)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `user_id=eq.${profile.id}` }, loadOpen)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile?.id, viewingFeed])

  return { unseen, openCount }
}

export const cap = (n: number) => (n > 99 ? '99+' : String(n))
