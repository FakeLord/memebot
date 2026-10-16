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

// Örnek akış: 20 sn'de bir $TICKER'lı (bazen adresli) bir gönderi
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const fakeMint = () => Array.from({ length: 44 }, () => B58[Math.floor(Math.random() * 58)]).join('')
const TICKERS = ['DOG', 'MOON', 'PEPE', 'CAT', 'FROG']
for (const t of TICKERS) {
  gmgn.searchResults.set(t.toLowerCase(), [1, 2, 3].map((n) => ({ address: fakeMint(), name: `${t} ${n}`, symbol: n === 1 ? t : `${t}${n}`, price: '0.0001', mcp: String(20_000 * n) })))
}
let seq = 0
const hits: { tweetId: string; text: string; body: string; createdAt: number; author: object; media?: object[] }[] = []
setInterval(() => {
  const t = TICKERS[seq % TICKERS.length]
  const withMint = seq % 2 === 0 ? ` CA: ${fakeMint()}` : ''
  const body = `Yeni bir şey geliyor $${t} "${t} to the moon"${withMint}`
  hits.unshift({
    tweetId: String(1900000000000000000n + BigInt(Date.now())),
    text: body,
    body,
    createdAt: Date.now() - 800,
    author: { name: 'Demo Hesap', handle: 'demo_hesap', verified: seq % 3 === 0, followers: 12_400 },
    media: seq % 3 === 1 ? [{ type: 'photo', url: 'https://picsum.photos/seed/' + seq + '/640/360' }] : undefined
  })
  hits.splice(5)
  seq++
}, 20_000)

const engine = new Engine({
  db: createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
  vault: await Vault.open(process.env.ENGINE_DATA_DIR!, process.env.ENGINE_MASTER_KEY!),
  log: createLogger(),
  version: 'dev',
  gmgnFactory: () => gmgn,
  xPoll: async () => ({
    ok: true,
    quotaRemaining: 10_000_000,
    monitors: [{ id: 'demo-monitor', username: 'demo_hesap', hits: hits as never }]
  })
})
await engine.start()
process.on('SIGINT', () => void engine.stop().then(() => process.exit(0)))
