// Yerel geliştirme motoru: sahte GMGN ve sahte XFlux ile, yerel Supabase'e (npx supabase start) karşı çalışır.
// Para harcamaz, gerçek servislere bağlanmaz. Arayüzü uçtan uca denemek için:
//   npx tsx --env-file=<yerel motor ayarları> scripts/dev-engine.mts
// Gereken ayarlar: SUPABASE_URL (sadece 127.0.0.1/localhost), SUPABASE_SERVICE_ROLE_KEY, ENGINE_MASTER_KEY, ENGINE_DATA_DIR

import { createClient } from '@supabase/supabase-js'
import { Engine } from '../src/engine/engine'
import { createLogger } from '../src/engine/log'
import { Vault } from '../src/engine/vault'
import { FakeGmgn } from '../tests/integration/helpers'

const url = process.env.SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error('dev-engine sadece yerel Supabase ile çalışır')

const gmgn = new FakeGmgn()
// Sahte gerçek emirler hemen kesinleşsin
gmgn.queryResults = []

const engine = new Engine({
  db: createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
  vault: await Vault.open(process.env.ENGINE_DATA_DIR!, process.env.ENGINE_MASTER_KEY!),
  log: createLogger(),
  version: 'dev',
  gmgnFactory: () => gmgn,
  xPoll: async () => ({
    ok: true,
    quotaRemaining: 5_000,
    monitors: [{ id: 'demo-monitor', username: 'demo_hesap', hits: [] }]
  })
})
await engine.start()
process.on('SIGINT', () => void engine.stop().then(() => process.exit(0)))
