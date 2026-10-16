import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { supabaseCsp } from './build/csp'

// Web sürümü: masaüstü arayüzünün aynısı, statik site olarak (Cloudflare Pages).
// npm run build:web → dist-web/
const version = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version as string

export default defineConfig(({ mode }) => ({
  root: resolve('src/renderer'),
  envDir: resolve('.'),
  publicDir: resolve('src/renderer/public'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  plugins: [react(), supabaseCsp(loadEnv(mode, resolve('.'), 'VITE_').VITE_SUPABASE_URL)],
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
  }
}))
