import type { Plugin } from 'vite'

// index.html'deki CSP "connect-src" kuralına derlemede kullanılan Supabase adresini ekler.
// Üretimde *.supabase.co zaten izinli; yerel test (http://127.0.0.1:54321) için gerekir.
export function supabaseCsp(url: string | undefined): Plugin {
  return {
    name: 'memebot-supabase-csp',
    transformIndexHtml(html) {
      if (!url) return html
      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        return html
      }
      if (/\.supabase\.co$/.test(new URL(origin).hostname)) return html
      const ws = origin.replace(/^http/, 'ws')
      return html.replace("connect-src 'self'", `connect-src 'self' ${origin} ${ws}`).replace("img-src 'self'", `img-src 'self' ${origin}`)
    }
  }
}
