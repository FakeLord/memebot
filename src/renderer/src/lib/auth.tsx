import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, Role } from '../../../shared/types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  inactive: boolean
  /** Parola doğru ama iki adımlı doğrulama kodu henüz girilmedi */
  mfaRequired: boolean
  signOut: () => Promise<void>
  /** Profil alanları değişince (profil düzenleme) yeniden okur */
  reloadProfile: () => Promise<void>
  /** 2FA açılıp kapanınca oturum seviyesini yeniden okur */
  reloadAal: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inactive, setInactive] = useState(false)
  // null: henüz bilinmiyor; true: ikinci adım gerekli
  const [mfaRequired, setMfaRequired] = useState<boolean | null>(null)
  const [tick, setTick] = useState(0)

  const reloadAal = useCallback(async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setMfaRequired(!!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2')
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Kod doğrulandığında ya da oturum yenilendiğinde seviye değişmiş olabilir
      if (event === 'MFA_CHALLENGE_VERIFIED' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(() => reloadAal(), 0)
      if (event === 'SIGNED_OUT') setMfaRequired(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [reloadAal])

  useEffect(() => {
    if (session && mfaRequired === null) reloadAal()
  }, [session?.user.id, mfaRequired, reloadAal])

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setProfile(null)
      setLoading(false)
      return
    }
    if (mfaRequired !== false) {
      // Seviye bilinmiyor ya da kod bekleniyor: profil/veri yüklenmez
      setProfile(null)
      setLoading(mfaRequired === null)
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
  }, [session?.user.id, mfaRequired, tick])

  const reloadProfile = useCallback(async () => {
    if (!session) return
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (data) setProfile(data as Profile)
  }, [session?.user.id])

  // Telegram ve diğer bağlantılar motorda çalışmaya devam eder; sadece bu oturum kapanır
  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ loading, session, profile, inactive, mfaRequired: !!mfaRequired, signOut, reloadProfile, reloadAal }}>
      {children}
    </AuthContext.Provider>
  )
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

/** Görünen ad: özel ad varsa o, yoksa kullanıcı adı */
export const shownName = (p: Pick<Profile, 'username' | 'display_name'> | null | undefined) => p?.display_name || p?.username || '?'
