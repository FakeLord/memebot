import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

// Founder'ın "Tümünü durdur" anahtarı; tüm bilgisayarlarda canlı güncellenir.
const Ctx = createContext(false)

export function KillSwitchProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false)

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'kill_switch')
      .maybeSingle()
      .then(({ data }) => setOn(data?.value === true))
    const ch = supabase
      .channel('kill-switch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.kill_switch' }, (p) =>
        setOn((p.new as { value?: unknown })?.value === true)
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  return <Ctx.Provider value={on}>{children}</Ctx.Provider>
}

export const useKillSwitch = () => useContext(Ctx)
