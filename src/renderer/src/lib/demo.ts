import { useMemo, useSyncExternalStore } from 'react'
import { buildDemo, type DemoData } from '../../../shared/demo'

// Demo modu: arayüz örnek veriyle gösterilir (ilk kullanımda uygulamanın nasıl görüneceğini görmek için).
// Veritabanına hiçbir şey yazılmaz; kapatınca gerçek verilere dönülür. Alım-satım demo modunda kapalıdır.

const KEY = 'memebot.demo'

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let on = read()
const listeners = new Set<() => void>()

export function setDemo(v: boolean) {
  on = v
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* depolama kapalı olabilir */
  }
  listeners.forEach((l) => l())
}

/** Hook olmayan yerler için (ör. emir gönderme korumaları). */
export const isDemo = () => on

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, () => on)
}

/** Örnek veri (sayfa açıkken sabit kalır). Demo kapalıysa null. */
export function useDemoData(): DemoData | null {
  const demo = useDemoMode()
  return useMemo(() => (demo ? buildDemo() : null), [demo])
}
