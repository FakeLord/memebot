import { defineConfig } from 'vitest/config'

// Birim testleri: tests/unit — her yerde çalışır.
// Entegrasyon testleri: tests/integration — yerel Supabase (npx supabase start) gerekir; yoksa atlanır.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
