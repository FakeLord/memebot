// Arayüz hem masaüstü uygulamasında (Electron kabuğu) hem tarayıcıda çalışır.
// Masaüstüne özgü şeyler (güncelleme, bu bilgisayarda motor) sadece window.desktop varsa görünür.

declare const __APP_VERSION__: string

export const desktop = typeof window !== 'undefined' ? window.desktop : undefined
export const isDesktop = !!desktop
export const APP_VERSION = __APP_VERSION__

/** "0.2.1" < "0.10.0" gibi sürüm karşılaştırması. */
export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0)
  }
  return false
}
