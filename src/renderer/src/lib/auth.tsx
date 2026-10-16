import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, Role } from '../../../shared/types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  inactive: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inactive, setInactive] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const p = data as Profile | null
        if (!p || !p.is_active) {
          // Pasif ya da profilsiz hesap uygulamaya giremez
          setInactive(true)
          setProfile(null)
          supabase.auth.signOut()
        } else {
          setInactive(false)
          setProfile(p)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  const signOut = async () => {
    // Telegram bağlantısını kapat (oturum bu bilgisayarda kayıtlı kalır)
    await window.api.telegram.detach()
    await supabase.auth.signOut()
  }

  return <AuthContext.Provider value={{ loading, session, profile, inactive, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth AuthProvider dışında kullanıldı')
  return ctx
}

export const ROLE_LABEL: Record<Role, string> = {
  founder: 'Founder',
  developer: 'Developer',
  assistant: 'Asistan'
}

export const canTrade = (role?: Role) => role === 'founder' || role === 'developer'
