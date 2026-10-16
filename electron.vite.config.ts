import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { supabaseCsp } from './build/csp'

const version = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version as string
const define = { __APP_VERSION__: JSON.stringify(version) }

export default defineConfig(({ mode }) => ({
  main: {
    // Motor (src/engine) ana süreçle aynı klasöre ayrı dosya olarak derlenir: out/main/engine.js
    // Masaüstünde utilityProcess ile, VPS'te düz Node ile çalışır.
    envPrefix: ['MAIN_VITE_', 'VITE_SUPABASE_URL'],
    define,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          engine: resolve('src/engine/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define,
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react(), supabaseCsp(loadEnv(mode, resolve('.'), 'VITE_').VITE_SUPABASE_URL)]
  }
}))
