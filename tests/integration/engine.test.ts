import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Engine } from '../../src/engine/engine'
import { Vault } from '../../src/engine/vault'
import { createLogger, silentLogger } from '../../src/engine/log'
import { runCommand, runSealed } from '../../src/shared/engineClient'
import { FakeGmgn, FakeTweetStream, localSupabase, makeUser, service, tmpDir, waitFor, type LocalEnv } from './helpers'

// Motorun uçtan uca davranışı: yerel Supabase + sahte GMGN. Para harcanmaz, gerçek projeye dokunulmaz.

const env = localSupabase()
const d = env ? describe : describe.skip

const tag = randomBytes(4).toString('hex')
const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const mint = () => Array.from(randomBytes(44), (b) => b58[b % 58]).join('')
const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

d('MemeBot Engine (yerel Supabase)', () => {
  const e = env as LocalEnv
  // Atlanan (yerel Supabase yok) durumda da bu gövde çalışır: bağlantı beforeAll'da kurulur
  let admin: SupabaseClient
  const gmgn = new FakeGmgn()
  const ts = new FakeTweetStream()
  let engine: Engine
  let founder: { id: string; client: SupabaseClient }
  let dev: { id: string; client: SupabaseClient }
  let asst: { id: string; client: SupabaseClient }
  let manualSource: string
  let xMonitors: { id: string; username: string; hits: { tweetId: string; text: string; createdAt?: number }[] }[] = []

  const order = (id: string) => admin.from('orders').select('*').eq('id', id).single().then((r) => r.data)
  const setRule = (userId: string, limits: Record<string, unknown>, mode = 'manual') =>
    admin.from('rules').upsert({ user_id: userId, mode, thresholds: {}, limits, tp_sl_template: [] }, { onConflict: 'user_id' })

  // Arayüzün yaptığı gibi: elle sinyal ekle
  const signal = async (c: SupabaseClient, m: string) => {
    const { error } = await c.rpc('record_signal', {
      p_source_id: manualSource,
      p_msg_id: Date.now(),
      p_mint: m,
      p_raw_text: `CA ${m}`,
      p_msg_ts: new Date().toISOString()
    })
    if (error) throw error
  }

  const startEngine = async (dir: string, key: string, instance?: string) => {
    const vault = await Vault.open(dir, key)
    const en = new Engine({
      db: service(e),
      vault,
      log: process.env.ENGINE_TEST_LOG ? createLogger() : silentLogger,
      version: 'test',
      instanceId: instance,
      gmgnFactory: () => gmgn,
      pollMs: 250,
      trackOrderMs: 50,
      trackerMs: 500,
      xPoll: async () => ({ ok: true, monitors: xMonitors, quotaRemaining: 100_000 }),
      tsApi: ts
    })
    await en.start()
    return en
  }

  beforeAll(async () => {
    admin = service(e)
    // Yerelde açık kalmış başka bir motor (ör. scripts/dev-engine) varsa: kilidi tutup bekleme moduna
    // geçmesini bekle (motor 10 sn'de bir kilidi yeniler), sonra bırak
    const { data: other } = await admin.from('engine_status').select('heartbeat_at').eq('id', 'main').maybeSingle()
    if (other && Date.now() - new Date(other.heartbeat_at).getTime() < 30_000) {
      await admin.from('engine_status').update({ instance_id: 'test-kilidi', heartbeat_at: new Date().toISOString() }).eq('id', 'main')
      await new Promise((r) => setTimeout(r, 11_000))
    }
    await admin.from('engine_status').delete().eq('id', 'main')
    founder = await makeUser(e, 'founder', tag)
    dev = await makeUser(e, 'developer', tag)
    asst = await makeUser(e, 'assistant', tag)
    engine = await startEngine(tmpDir('memebot-engine-'), randomBytes(32).toString('base64'))
    await waitFor(async () => engine.isActive)
    const { data } = await dev.client
      .from('sources')
      .upsert({ user_id: dev.id, type: 'manual', chat_id: 'manual', title: 'Manuel', is_active: true }, { onConflict: 'user_id,type,chat_id' })
      .select('id')
      .single()
    manualSource = data!.id
    await admin.from('app_settings').update({ value: false }).eq('key', 'kill_switch')
  })

  afterAll(async () => {
    await engine?.stop()
  })

  it('motor kilidi alır ve açık anahtarını yayınlar; ikinci motor beklemede kalır', async () => {
    const { data } = await dev.client.from('engine_status').select('instance_id, public_key, version').eq('id', 'main').single()
    expect(data?.instance_id).toBe(engine.instanceId)
    expect(data?.public_key).toBeTruthy()
    const second = await startEngine(tmpDir('memebot-engine2-'), randomBytes(32).toString('base64'))
    expect(second.isActive).toBe(false)
    await second.stop()
    expect(engine.isActive).toBe(true)
  })

  it('GMGN anahtarı mühürlü komutla kaydedilir; şifreli girdi veritabanından silinir', async () => {
    await runSealed(dev.client, dev.id, 'gmgn.save', { apiKey: 'test-api-key', privateKeyPem: pem })
    const { data: cmd } = await admin.from('engine_commands').select('payload, status').eq('user_id', dev.id).eq('kind', 'gmgn.save').single()
    expect(cmd?.status).toBe('done')
    expect(cmd?.payload).toBeNull()
    const st = await waitFor(async () => {
      const { data } = await dev.client.from('engine_user_state').select('gmgn').eq('user_id', dev.id).maybeSingle()
      return data?.gmgn?.configured ? data : null
    })
    expect(st.gmgn.configured).toBe(true)
  })

  it('geçersiz imza anahtarı reddedilir', async () => {
    await expect(runSealed(asst.client, asst.id, 'gmgn.save', { apiKey: 'k', privateKeyPem: 'yanlış' })).rejects.toThrow(/İmza anahtarı geçersiz/)
  })

  it('anahtar çifti motorda üretilir: arayüze sadece açık anahtar döner, API Key ile kaydedilince kasaya taşınır', async () => {
    const a = await runCommand(asst.client, asst.id, 'gmgn.keygen', {})
    expect(a.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(JSON.stringify(a)).not.toMatch(/PRIVATE/)
    // Tekrar basınca aynı çift (GMGN'e yüklenmiş olabilir); "fresh" ile yenisi
    expect((await runCommand(asst.client, asst.id, 'gmgn.keygen', {})).publicKeyPem).toBe(a.publicKeyPem)
    const b = await runCommand(asst.client, asst.id, 'gmgn.keygen', { fresh: true })
    expect(b.publicKeyPem).not.toBe(a.publicKeyPem)
    await waitFor(async () => {
      const { data } = await asst.client.from('engine_user_state').select('gmgn').eq('user_id', asst.id).maybeSingle()
      return data?.gmgn?.pendingPublicKey === b.publicKeyPem
    })
    // İmza anahtarı boş gönderilir → motor bekleyen anahtarı kullanır
    await runSealed(asst.client, asst.id, 'gmgn.save', { apiKey: 'keygen-api-key', privateKeyPem: '' })
    const saved = engine.ctx.vault.get(asst.id)
    expect(saved.gmgnPending).toBeUndefined()
    expect(createPublicKey(saved.gmgn!.privateKeyPem).export({ type: 'spki', format: 'pem' }).toString()).toBe(b.publicKeyPem)
    const st = await waitFor(async () => {
      const { data } = await asst.client.from('engine_user_state').select('gmgn').eq('user_id', asst.id).maybeSingle()
      return data?.gmgn?.configured && !data.gmgn.pendingPublicKey ? data : null
    })
    expect(st.gmgn.configured).toBe(true)
    // Bekleyen anahtar yokken boş imza anahtarı reddedilir
    await expect(runSealed(asst.client, asst.id, 'gmgn.save', { apiKey: 'k', privateKeyPem: '' })).rejects.toThrow(/İmza anahtarı boş/)
    await runCommand(asst.client, asst.id, 'gmgn.clear', {})
  })

  it('cüzdan listesi ve seçimi', async () => {
    const r = await runCommand(dev.client, dev.id, 'gmgn.wallets', {})
    expect(r.wallets[0].address).toBe(gmgn.wallets[0].address)
    await runCommand(dev.client, dev.id, 'gmgn.wallet', { address: r.wallets[0].address })
    await waitFor(async () => {
      const { data } = await dev.client.from('engine_user_state').select('gmgn').eq('user_id', dev.id).single()
      return data?.gmgn?.wallet === r.wallets[0].address
    })
  })

  it('Token Kontrol komutu sonuç ve güvenlik raporu döner', async () => {
    const m = mint()
    const r = await runCommand(dev.client, dev.id, 'token.check', { mints: [m] })
    expect(r.results[0].report?.result).toBe('pass')
    expect(r.results[0].summary?.symbol).toBe('TST')
  })

  it('sinyal → güvenlik kontrolü → onay adayı (manuel mod)', async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 2, liveTrading: false })
    await engine.ctx.users.load()
    const m = mint()
    await signal(dev.client, m)
    const cand = await waitFor(async () => {
      const { data } = await dev.client.from('candidates').select('*').eq('user_id', dev.id).eq('mint', m).maybeSingle()
      return data
    })
    expect(cand.status).toBe('pending')
    expect(cand.verdict).toBe('pass')
  })

  it('güvensiz token aday olmaz', async () => {
    const m = mint()
    gmgn.tokens.set(m, { price: 0.0001, safe: false })
    await signal(dev.client, m)
    await waitFor(async () => {
      const { data } = await admin.from('signals').select('processed_at').eq('mint', m).single()
      return data?.processed_at
    })
    await new Promise((r) => setTimeout(r, 500))
    const { data } = await admin.from('candidates').select('id').eq('mint', m)
    expect(data).toEqual([])
  })

  it('onay → deneme alımı → pozisyon açılır; satış → pozisyon kapanır', async () => {
    const m = mint()
    gmgn.tokens.set(m, { price: 0.0002, symbol: 'DOG' })
    await signal(dev.client, m)
    const cand = await waitFor(async () => (await dev.client.from('candidates').select('id').eq('mint', m).maybeSingle()).data)
    // Arayüz: adayı onayla, emir niyetini yaz
    await dev.client.from('candidates').update({ status: 'approved', amount_sol: 0.1 }).eq('id', cand.id).eq('status', 'pending')
    const { data: o, error } = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `buy:${cand.id}`, side: 'buy', mint: m, amount_in: '100000000', is_dry_run: true, candidate_id: cand.id, symbol: 'DOG' })
      .select('id')
      .single()
    expect(error).toBeNull()
    const done = await waitFor(async () => {
      const r = await order(o!.id)
      return r?.status === 'confirmed' || r?.status === 'failed' ? r : null
    })
    expect(done.error_code).toBeNull()
    expect(done.status).toBe('confirmed')
    expect(done.wallet).toBe(gmgn.wallets[0].address)

    const pos = await waitFor(async () => (await dev.client.from('positions').select('*').eq('buy_order_id', o!.id).maybeSingle()).data)
    expect(pos.status).toBe('open')
    expect(Number(pos.cost_sol)).toBeCloseTo(0.1)
    expect(Number(pos.entry_price)).toBeCloseTo(0.0002)

    // Aynı emir ikinci kez yazılamaz (idempotency)
    const dup = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `buy:${cand.id}`, side: 'buy', mint: m, amount_in: '100000000', is_dry_run: true })
    expect(dup.error?.code).toBe('23505')

    // Fiyat değişir → takip yeni fiyatı yazar
    gmgn.tokens.set(m, { price: 0.0004, symbol: 'DOG' })
    await waitFor(async () => {
      const { data } = await dev.client.from('positions').select('last_price_usd').eq('id', pos.id).single()
      return Number(data?.last_price_usd) === 0.0004
    })

    const { data: s } = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `sell:${pos.id}:100`, side: 'sell', mint: m, amount_in: '0', is_dry_run: true, position_id: pos.id, sell_percent: 100 })
      .select('id')
      .single()
    const sold = await waitFor(async () => {
      const r = await order(s!.id)
      return r?.status === 'confirmed' || r?.status === 'failed' ? r : null
    })
    expect(sold.status).toBe('confirmed')
    const closed = await waitFor(async () => {
      const { data } = await dev.client.from('positions').select('*').eq('id', pos.id).single()
      return data?.status === 'closed' ? data : null
    })
    expect(Number(closed.proceeds_sol)).toBeGreaterThan(0.1) // fiyat 2 katı → kâr
  })

  it('limitler motorda uygulanır: maks. tutar, mod uyuşmazlığı, kill switch', async () => {
    const insert = (amount: string, dry = true) =>
      dev.client
        .from('orders')
        .insert({ user_id: dev.id, idempotency_key: `t:${Math.random()}`, side: 'buy', mint: mint(), amount_in: amount, is_dry_run: dry })
        .select('id')
        .single()
    const settle = (id: string) => waitFor(async () => {
      const r = await order(id)
      return r?.status === 'failed' || r?.status === 'confirmed' ? r : null
    })

    const big = await insert('2000000000') // 2 SOL > maxBuySol 1
    expect((await settle(big.data!.id)).error_code).toMatch(/en fazla 1 SOL/)

    const live = await insert('10000000', false) // kural deneme modunda, emir gerçek
    expect((await settle(live.data!.id)).error_code).toMatch(/Deneme modundasınız/)

    await admin.from('app_settings').update({ value: true }).eq('key', 'kill_switch')
    const k = await insert('10000000')
    expect((await settle(k.data!.id)).error_code).toMatch(/durduruldu/)
    await admin.from('app_settings').update({ value: false }).eq('key', 'kill_switch')
  })

  it('günlük harcama limiti', async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 0.15, liveTrading: false, maxOpenPositions: 50 })
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const { data } = await dev.client
        .from('orders')
        .insert({ user_id: dev.id, idempotency_key: `d:${tag}:${i}`, side: 'buy', mint: mint(), amount_in: '100000000', is_dry_run: true })
        .select('id')
        .single()
      ids.push(data!.id)
      await waitFor(async () => ['confirmed', 'failed'].includes((await order(data!.id))?.status) || null)
    }
    // Bugün önceki testte 0.1 SOL harcandı: ikinci 0.1 limiti aşar
    const results = await Promise.all(ids.map(order))
    expect(results.some((r) => r?.status === 'failed' && /Günlük limit/.test(r.error_code))).toBe(true)
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 })
  })

  it('RLS: arayüz emri/pozisyonu güncelleyemez; asistan emir yazamaz; kesinleşmiş emir eklenemez', async () => {
    const { data: any } = await admin.from('orders').select('id').eq('user_id', dev.id).limit(1).single()
    const up = await dev.client.from('orders').update({ status: 'confirmed' }).eq('id', any!.id).select('id')
    expect(up.data ?? []).toEqual([])
    const pos = await dev.client.from('positions').update({ status: 'closed' }).eq('user_id', dev.id).select('id')
    expect(pos.data ?? []).toEqual([])
    const a = await asst.client
      .from('orders')
      .insert({ user_id: asst.id, idempotency_key: `a:${tag}`, side: 'buy', mint: mint(), amount_in: '1', is_dry_run: true })
    expect(a.error).toBeTruthy()
    const c = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `c:${tag}`, side: 'buy', mint: mint(), amount_in: '1', is_dry_run: true, status: 'confirmed' })
    expect(c.error).toBeTruthy()
    // Başkasının komut sonucunu göremez
    const other = await asst.client.from('engine_commands').select('id').eq('user_id', dev.id)
    expect(other.data ?? []).toEqual([])
    // Motor kilidini arayüz çağıramaz
    const claim = await dev.client.rpc('engine_claim', { p_instance: 'kötü' })
    expect(claim.error).toBeTruthy()
  })

  it('asistan "tümünü sat" komutu çalıştıramaz', async () => {
    await expect(runCommand(asst.client, asst.id, 'positions.sell_all', {})).rejects.toThrow(/işlem yapamaz/)
  })

  it('otomatik mod: aday beklemeden deneme alımına dönüşür', async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, autoBuySol: 0.05, maxOpenPositions: 50 }, 'auto')
    await engine.ctx.users.load()
    const m = mint()
    await signal(dev.client, m)
    const o = await waitFor(async () => {
      const { data } = await dev.client.from('orders').select('*').eq('mint', m).maybeSingle()
      return data?.status === 'confirmed' ? data : null
    })
    expect(o.amount_in).toBe('50000000')
    const { data: c } = await dev.client.from('candidates').select('status, auto').eq('mint', m).single()
    expect(c).toEqual({ status: 'approved', auto: true })
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 }, 'manual')
  })

  it('çağrıcı: gönderen kaydedilir; engelli kişinin çağrısı aday olmaz; "yalnız güvenilir" otomatik alımı kişiye göre ayırır', async () => {
    // Telegram grubundaki gibi: gönderen bilgisiyle sinyal (motorun kayıt fonksiyonu)
    const call = async (m: string, sender: string, name: string) => {
      const { error } = await admin.rpc('engine_record_signal', {
        p_user_id: dev.id,
        p_source_id: manualSource,
        p_msg_id: Date.now() + Math.floor(Math.random() * 1000),
        p_mint: m,
        p_raw_text: `CA ${m}`,
        p_msg_ts: new Date().toISOString(),
        p_sender_id: sender,
        p_sender_name: name,
        p_sender_handle: name.toLowerCase()
      })
      if (error) throw error
    }
    const processed = (m: string) =>
      waitFor(async () => {
        const { data } = await admin.from('signals').select('processed_at').eq('mint', m).single()
        return data?.processed_at
      })
    const sender = `tg-${tag}`
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, autoBuySol: 0.05, maxOpenPositions: 50 }, 'manual')
    await engine.ctx.users.load()

    // 1) normal kişi: sinyalde gönderen var, çağrıcı satırı açılır, aday oluşur
    const m1 = mint()
    await call(m1, sender, 'Alo')
    await waitFor(async () => (await dev.client.from('candidates').select('id').eq('mint', m1).maybeSingle()).data)
    const { data: s1 } = await admin.from('signals').select('sender_id, sender_name, sender_handle').eq('mint', m1).single()
    expect(s1).toEqual({ sender_id: sender, sender_name: 'Alo', sender_handle: 'alo' })
    const { data: c1 } = await dev.client.from('callers').select('name, handle, rule').eq('sender_id', sender).single()
    expect(c1).toEqual({ name: 'Alo', handle: 'alo', rule: 'normal' })

    // 2) engelli: sinyal işlenir ama aday ve GMGN kontrolü olmaz
    await dev.client.from('callers').update({ rule: 'blocked' }).eq('sender_id', sender)
    const m2 = mint()
    await call(m2, sender, 'Alo')
    await processed(m2)
    await new Promise((r) => setTimeout(r, 400))
    expect((await admin.from('candidates').select('id').eq('mint', m2)).data).toEqual([])
    // Bu token için GMGN güvenlik kontrolü hiç yapılmadı (takipçinin diğer fiyat sorguları sayılmaz)
    expect(gmgn.calls.filter((c) => c.fn === 'tokenInfo' && c.args === m2)).toEqual([])

    // 3) otomatik mod + yalnız güvenilir: normal kişi onaya düşer, güvenilir kişi 2x tutarla otomatik alınır
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, autoBuySol: 0.05, maxOpenPositions: 50, autoOnlyTrusted: true, trustedBuyMult: 2 }, 'auto')
    await engine.ctx.users.load()
    await dev.client.from('callers').update({ rule: 'normal' }).eq('sender_id', sender)
    const m3 = mint()
    await call(m3, sender, 'Alo')
    const c3 = await waitFor(async () => (await dev.client.from('candidates').select('status, auto').eq('mint', m3).maybeSingle()).data)
    expect(c3.status).toBe('pending')
    expect((await admin.from('orders').select('id').eq('mint', m3)).data).toEqual([])

    await dev.client.from('callers').update({ rule: 'trusted' }).eq('sender_id', sender)
    const m4 = mint()
    await call(m4, sender, 'Alo')
    const o4 = await waitFor(async () => {
      const { data } = await dev.client.from('orders').select('*').eq('mint', m4).maybeSingle()
      return data?.status === 'confirmed' ? data : null
    })
    expect(o4.amount_in).toBe('100000000') // 0.05 × 2

    // 4) kişiye özel tutar: çarpanın yerine geçer (işlem başı maks. tutarla sınırlı)
    await dev.client.from('callers').update({ buy_sol: 0.3 }).eq('sender_id', sender)
    const m5 = mint()
    await call(m5, sender, 'Alo')
    const o5 = await waitFor(async () => {
      const { data } = await dev.client.from('orders').select('*').eq('mint', m5).maybeSingle()
      return data?.status === 'confirmed' ? data : null
    })
    expect(o5.amount_in).toBe('300000000')
    await dev.client.from('callers').update({ buy_sol: 3 }).eq('sender_id', sender)
    const m6 = mint()
    await call(m6, sender, 'Alo')
    const o6 = await waitFor(async () => {
      const { data } = await dev.client.from('orders').select('*').eq('mint', m6).maybeSingle()
      return data?.status === 'confirmed' ? data : null
    })
    expect(o6.amount_in).toBe('1000000000') // maxBuySol = 1
    // 5 SOL üstü veritabanında reddedilir
    expect((await dev.client.from('callers').update({ buy_sol: 6 }).eq('sender_id', sender)).error).toBeTruthy()

    // 5) "Onaya düşsün": "yalnız güvenilir" kapalı ve otomatik modda bile onaya düşer
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, autoBuySol: 0.05, maxOpenPositions: 50 }, 'auto')
    await engine.ctx.users.load()
    await dev.client.from('callers').update({ rule: 'manual', buy_sol: null }).eq('sender_id', sender)
    const m7 = mint()
    await call(m7, sender, 'Alo')
    const c7 = await waitFor(async () => (await dev.client.from('candidates').select('status').eq('mint', m7).maybeSingle()).data)
    expect(c7.status).toBe('pending')
    await new Promise((r) => setTimeout(r, 400))
    expect((await admin.from('orders').select('id').eq('mint', m7)).data).toEqual([])

    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 }, 'manual')
    await engine.ctx.users.load()
  })

  it('deneme modu GMGN\'e swap göndermez; otomatik mod autoPreset ücretlerini kullanır', async () => {
    await admin
      .from('fee_presets')
      .upsert({ user_id: dev.id, slot: 3, kind: 'buy', priority_sol: 0.0033, tip_sol: 0.0044, slippage: 15, anti_mev: false }, { onConflict: 'user_id,slot,kind' })
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, autoBuySol: 0.05, maxOpenPositions: 50, autoPreset: 3 }, 'auto')
    await engine.ctx.users.load()
    const swapsBefore = gmgn.calls.filter((c) => c.fn === 'swap').length
    const m = mint()
    await signal(dev.client, m)
    const o = await waitFor(async () => {
      const { data } = await admin.from('orders').select('status, preset, request, is_dry_run').eq('mint', m).maybeSingle()
      return data?.status === 'confirmed' ? data : null
    })
    expect(o.is_dry_run).toBe(true)
    expect(o.preset).toBe(3)
    expect(o.request).toMatchObject({ priorityFeeSol: 0.0033, tipFeeSol: 0.0044, slippage: 15, antiMev: false })
    expect(gmgn.calls.filter((c) => c.fn === 'swap').length).toBe(swapsBefore)
    await admin.from('fee_presets').delete().eq('user_id', dev.id)
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 }, 'manual')
  })

  it('gerçek mod: swap → GMGN emir takibi → kesinleşince pozisyon (sahte GMGN)', async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: true, maxOpenPositions: 50 })
    gmgn.queryResults = ['pending', 'processed', 'confirmed']
    const m = mint()
    const { data } = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `live:${tag}`, side: 'buy', mint: m, amount_in: '50000000', is_dry_run: false })
      .select('id')
      .single()
    const done = await waitFor(async () => {
      const r = await order(data!.id)
      return r?.status === 'confirmed' || r?.status === 'failed' ? r : null
    })
    expect(done.status).toBe('confirmed')
    expect(done.gmgn_order_id).toMatch(/^ord-/)
    const swap = gmgn.calls.filter((c) => c.fn === 'swap').at(-1)!.args as { condition_orders?: unknown[]; priority_fee: string }
    expect(Number(swap.priority_fee)).toBeGreaterThan(0)
    const pos = await waitFor(async () => (await dev.client.from('positions').select('*').eq('buy_order_id', data!.id).maybeSingle()).data)
    expect(pos.amount_raw).toBe('75000000000')
    expect(pos.is_dry_run).toBe(false)
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 })
  })

  it("ücret preset'i: emir P2 ile gelirse ücretler P2 kaydından; anahtar kelime öneri terimi olur", async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: true, maxOpenPositions: 50, activePreset: 1 })
    const up = await dev.client
      .from('fee_presets')
      .upsert({ user_id: dev.id, slot: 2, kind: 'buy', priority_sol: 0.002, tip_sol: 0.003, slippage: null, anti_mev: false }, { onConflict: 'user_id,slot,kind' })
    expect(up.error).toBeNull()
    gmgn.queryResults = ['confirmed']
    const { data } = await dev.client
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `p2:${tag}`, side: 'buy', mint: mint(), amount_in: '10000000', is_dry_run: false, preset: 2 })
      .select('id')
      .single()
    const done = await waitFor(async () => {
      const r = await order(data!.id)
      return ['confirmed', 'failed'].includes(r?.status) ? r : null
    })
    expect(done.error_code).toBeNull()
    const swap = gmgn.calls.filter((c) => c.fn === 'swap').at(-1)!.args as Record<string, unknown>
    expect(swap.priority_fee).toBe('0.002')
    expect(swap.tip_fee).toBe('0.003')
    expect(swap.auto_slippage).toBe(true)
    expect(swap.is_anti_mev).toBe(false)
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 })

    // Anahtar kelime → öneri ızgarası arama terimi
    await dev.client.from('keywords').insert({ user_id: dev.id, pattern: 'kedi', match: 'word' })
    await engine.ctx.users.loadKeywords()
    gmgn.searchResults.set('kedi', [{ address: mint(), name: 'Kedi', symbol: 'KEDI', price: '0.01', mcp: '9000' }])
    const id = await engine.feed.ingest(dev.id, null, { platform: 'x', externalId: `kw-${tag}`, author: {}, body: 'bugün kedi günü' })
    const card = await waitFor(async () => (await dev.client.from('feed_items').select('suggestions').eq('id', id!).single()).data?.suggestions?.length ? true : null)
    expect(card).toBe(true)
  })

  it("deploy: deneme modunda GMGN'e gönderilmez, kaydedilir; aynı form iki kez gönderilemez", async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 })
    const form = {
      platform: 'pump' as const,
      name: 'Test Köpek',
      symbol: 'TKOPEK',
      image: { kind: 'url' as const, url: 'https://pbs.twimg.com/a.jpg' },
      twitter: 'https://x.com/a/status/1',
      buySol: 0.1,
      feeShares: [{ provider: 'twitter' as const, username: '@a', percent: 100 }],
      autoSell: [{ type: 'delay' as const, seconds: 60, percent: 50 }],
      preset: 1 as const
    }
    const before = gmgn.calls.filter((c) => c.fn === 'createToken').length
    const r = await runCommand(dev.client, dev.id, 'deploy.submit', { form, key: `k-${tag}-1` })
    expect(r.dryRun).toBe(true)
    expect(r.status).toBe('simulated')
    expect(r.request.dex).toBe('pump')
    expect(r.request.buy_amt).toBe('0.1')
    expect(r.request.pump_fee_share_list).toEqual([{ provider: 'twitter', username: 'a', basic_points: 10000 }])
    expect((r.request.sell_configs as { sell_ratio: string }[])[0].sell_ratio).toBe('0.5')
    expect(gmgn.calls.filter((c) => c.fn === 'createToken').length).toBe(before)
    await expect(runCommand(dev.client, dev.id, 'deploy.submit', { form, key: `k-${tag}-1` })).rejects.toThrow(/zaten gönderildi/)
    await expect(runCommand(dev.client, dev.id, 'deploy.submit', { form: { ...form, symbol: '' }, key: `k-${tag}-2` })).rejects.toThrow(/Sembol/)
    await expect(runCommand(asst.client, asst.id, 'deploy.submit', { form, key: `k-${tag}-3` })).rejects.toThrow(/yapamaz/)
    const { data: rows } = await dev.client.from('deploys').select('status, is_dry_run').eq('user_id', dev.id)
    expect(rows).toEqual([{ status: 'simulated', is_dry_run: true }])
  })

  it("deploy: gerçek modda GMGN'e gider, token adresi emir sorgusundan gelir (sahte GMGN)", async () => {
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: true, maxOpenPositions: 50 })
    gmgn.createdMint = mint()
    const form = { platform: 'bonk' as const, name: 'Gerçek', symbol: 'GRC', image: { kind: 'base64' as const, data: 'aGVsbG8=', bytes: 5 }, buySol: 0, feeShares: [], autoSell: [], preset: 2 as const }
    const r = await runCommand(dev.client, dev.id, 'deploy.submit', { form, key: `k-${tag}-live` })
    expect(r.dryRun).toBe(false)
    const d = await waitFor(async () => {
      const { data } = await dev.client.from('deploys').select('*').eq('id', r.id).single()
      return data?.status === 'confirmed' ? data : null
    })
    expect(d.mint).toBe(gmgn.createdMint)
    const sent = gmgn.calls.filter((c) => c.fn === 'createToken').at(-1)!.args as Record<string, unknown>
    expect(sent.image).toBe('aGVsbG8=')
    expect(d.request.image).toMatch(/^<base64/) // veritabanına görselin kendisi yazılmaz
    await setRule(dev.id, { maxBuySol: 1, dailyMaxSol: 100, liveTrading: false, maxOpenPositions: 50 })
  })

  it('tümünü sat: açık tüm pozisyonlar satılır', async () => {
    const r = await runCommand(dev.client, dev.id, 'positions.sell_all', {}, 30_000)
    expect(r.errors).toEqual([])
    await waitFor(async () => {
      const { data } = await dev.client.from('positions').select('id').eq('user_id', dev.id).eq('status', 'open')
      return data?.length === 0
    }, 20_000)
    const { data: panic } = await dev.client.from('positions').select('close_reason').eq('user_id', dev.id).eq('close_reason', 'panic')
    expect(panic?.length).toBeGreaterThan(0)
  })

  it('motor gönderim sırasında durduysa emir başarısız sayılır (otomatik tekrar yok)', async () => {
    const { data } = await admin
      .from('orders')
      .insert({ user_id: dev.id, idempotency_key: `stuck:${tag}`, side: 'buy', mint: mint(), amount_in: '1', is_dry_run: true, status: 'sending' })
      .select('id')
      .single()
    await engine.orders.recover()
    const r = await order(data!.id)
    expect(r.status).toBe('failed')
    expect(r.error_code).toMatch(/gönderim sırasında durdu/)
  })

  it('eski (60 sn+) niyet çalıştırılmaz', async () => {
    const { data } = await admin
      .from('orders')
      .insert({
        user_id: dev.id,
        idempotency_key: `old:${tag}`,
        side: 'buy',
        mint: mint(),
        amount_in: '1000',
        is_dry_run: true,
        created_at: new Date(Date.now() - 120_000).toISOString()
      })
      .select('id')
      .single()
    const r = await waitFor(async () => {
      const x = await order(data!.id)
      return x?.status === 'failed' ? x : null
    })
    expect(r.error_code).toMatch(/zamanında işlenemedi/)
  })

  it('X (XFlux): anahtar kaydedilir, izlenen hesabın yeni gönderisindeki adres sinyal olur', async () => {
    xMonitors = [{ id: 'mon-1', username: 'elon', hits: [] }]
    await runSealed(dev.client, dev.id, 'xflux.save', { apiKey: 'xflux_testanahtar123' })
    const st = await waitFor(async () => {
      const { data } = await dev.client.from('engine_user_state').select('x').eq('user_id', dev.id).single()
      return data?.x?.monitors?.length ? data.x : null
    })
    expect(st.state).toBe('polling')
    await dev.client
      .from('sources')
      .upsert({ user_id: dev.id, type: 'x', chat_id: 'mon-1', title: '@elon', is_active: true }, { onConflict: 'user_id,type,chat_id' })
    await engine.sources.reloadSources()
    const m = mint()
    xMonitors = [{ id: 'mon-1', username: 'elon', hits: [{ tweetId: '1900000000000000777', text: `yeni coin ${m}`, createdAt: Date.now() }] }]
    // Yoklama aralığı kotaya göre (en az 3 sn)
    const sig = await waitFor(async () => (await dev.client.from('signals').select('msg_id::text, mint').eq('mint', m).maybeSingle()).data, 25_000)
    expect(String(sig.msg_id)).toBe('1900000000000000777')

    // Aynı gönderi akışa kart olarak da düştü
    const card = await waitFor(async () => (await dev.client.from('feed_items').select('*').eq('external_id', '1900000000000000777').maybeSingle()).data)
    expect(card.platform).toBe('x')
    expect(card.mints).toEqual([m])
    expect(card.url).toBe('https://x.com/elon/status/1900000000000000777')
    await runCommand(dev.client, dev.id, 'xflux.clear', {})
  })

  it('X (TweetStream): anahtar denenir, hesap eklenir, itilen gönderi sinyal ve kart olur; kopunca yeniden bağlanır', async () => {
    const tsState = async () => (await dev.client.from('engine_user_state').select('x').eq('user_id', dev.id).single()).data?.x?.ts
    // Yanlış anahtar saklanmaz
    await expect(runSealed(dev.client, dev.id, 'tweetstream.save', { apiKey: 'yanlis-anahtar-123' })).rejects.toThrow(/reddedildi/)
    const saved = await runSealed(dev.client, dev.id, 'tweetstream.save', { apiKey: 'ts_test_key_1234' })
    expect(saved).toMatchObject({ ok: true, plan: 'ELITE', limit: 250 })
    await waitFor(async () => ((await tsState())?.state === 'live' ? true : null))

    // Hesap ekleme: geçersiz adlar ayıklanır, geçerliler TweetStream'e ve kaynaklara yazılır
    await expect(runCommand(dev.client, dev.id, 'tweetstream.add', { handles: ['bu ad olmaz!!'] })).rejects.toThrow(/Geçerli/)
    const added = await runCommand(dev.client, dev.id, 'tweetstream.add', { handles: ['@TsHesap', 'https://x.com/ikinci'] })
    expect(added.results.map((x: { state: string }) => x.state)).toEqual(['added', 'added'])
    expect([...ts.handles].sort()).toEqual(['ikinci', 'tshesap'])
    const { data: rows } = await dev.client.from('sources').select('chat_id, title, is_active').eq('user_id', dev.id).like('chat_id', 'ts:%').order('chat_id')
    expect(rows).toEqual([
      { chat_id: 'ts:ikinci', title: '@ikinci', is_active: true },
      { chat_id: 'ts:tshesap', title: '@tshesap', is_active: true }
    ])

    // İtilen gönderi: sinyal + kart (yoklama yok)
    const m = mint()
    const id = ts.push('tshesap', `yeni coin geliyor ${m}`)
    const sig = await waitFor(async () => (await dev.client.from('signals').select('msg_id::text, mint').eq('mint', m).maybeSingle()).data, 5_000)
    expect(String(sig.msg_id)).toBe(id)
    const card = await waitFor(async () => (await dev.client.from('feed_items').select('*').eq('external_id', id).maybeSingle()).data)
    expect(card).toMatchObject({ platform: 'x', mints: [m], url: `https://x.com/tshesap/status/${id}` })
    expect(card.author).toMatchObject({ handle: 'tshesap', verified: true, followers: 1234 })
    // X hesabı çağrıcıdır: sinyalde gönderen "x:<ad>", eklenen hesaplar Çağrıcılar'da hemen görünür
    expect((await admin.from('signals').select('sender_id').eq('mint', m).single()).data).toEqual({ sender_id: 'x:tshesap' })
    const { data: xc } = await dev.client.from('callers').select('sender_id, handle, rule').in('sender_id', ['x:ikinci', 'x:tshesap']).order('sender_id')
    expect(xc).toEqual([
      { sender_id: 'x:ikinci', handle: 'ikinci', rule: 'normal' },
      { sender_id: 'x:tshesap', handle: 'tshesap', rule: 'normal' }
    ])
    const st = await waitFor(async () => ((await tsState())?.events ? tsState() : null))
    expect(st.lastLatencyMs).toBeGreaterThanOrEqual(0)

    // İzlemeden çıkarılan hesabın gönderisi işlenmez
    await dev.client.from('sources').update({ is_active: false }).eq('user_id', dev.id).eq('chat_id', 'ts:ikinci')
    await engine.sources.reloadSources()
    const m2 = mint()
    const id2 = ts.push('ikinci', `gizli ${m2}`)
    await new Promise((res) => setTimeout(res, 800))
    expect((await dev.client.from('feed_items').select('id').eq('external_id', id2).maybeSingle()).data).toBeNull()

    // TweetStream panelinden eklenen (bilmediğimiz) hesap otomatik kaynak olur
    ts.handles.add('panelden')
    const m3 = mint()
    ts.push('panelden', `CA ${m3}`)
    await waitFor(async () => (await dev.client.from('signals').select('id').eq('mint', m3).maybeSingle()).data, 5_000)
    expect((await dev.client.from('sources').select('is_active').eq('user_id', dev.id).eq('chat_id', 'ts:panelden').single()).data).toEqual({ is_active: true })

    // Kopunca yeniden bağlanır
    const before = ts.connects
    ts.drop()
    await waitFor(async () => (ts.connects > before && (await tsState())?.state === 'live' ? true : null), 10_000)

    // Hesap çıkarma: TweetStream'den ve kaynaklardan silinir
    await runCommand(dev.client, dev.id, 'tweetstream.remove', { handle: '@tshesap' })
    expect(ts.handles.has('tshesap')).toBe(false)
    expect((await dev.client.from('sources').select('id').eq('user_id', dev.id).eq('chat_id', 'ts:tshesap').maybeSingle()).data).toBeNull()

    await runCommand(dev.client, dev.id, 'tweetstream.clear', {})
    await waitFor(async () => ((await tsState())?.state === 'no_key' ? true : null))
    expect(ts.sockets.size).toBe(0)
  })

  it('dashboard: motor GMGN trend, bakiye ve cüzdan istatistiklerini durum satırına yazar; anahtar silinince temizler', async () => {
    const dash = async () => (await dev.client.from('engine_user_state').select('gmgn').eq('user_id', dev.id).single()).data?.gmgn
    // Motorun kendi 15 sn'lik turu anahtar kaydedildikten sonra istediği an çalışabilir: sayım kayıttan önce başlar
    const before = gmgn.calls.length
    await runSealed(dev.client, dev.id, 'gmgn.save', { apiKey: 'dash-test-key', privateKeyPem: pem })
    const w = await runCommand(dev.client, dev.id, 'gmgn.wallets', {})
    await runCommand(dev.client, dev.id, 'gmgn.wallet', { address: w.wallets[0].address })
    await engine.dashboard.tick()
    const g = await waitFor(async () => {
      const x = await dash()
      return x?.dash?.at && x.dash.profits?.all ? x : null
    })
    expect(g.configured).toBe(true)
    expect(g.dash.error).toBeNull()
    expect(g.dash.balance).toBe(3)
    expect(g.dash.wallet).toBe(w.wallets[0].address)
    expect(g.dash.stats['7d']).toMatchObject({ realizedProfit: 125.5, unrealizedProfit: 12.1, winrate: 0.55, totalCost: 1000, buyCount: 12, sellCount: 9 })
    expect(g.dash.stats['30d'].realizedProfit).toBe(410.25)
    expect(g.dash.profits['1d']).toMatchObject({ totalProfit: 35, realizedProfit: 30 })
    expect(g.dash.trending.items).toHaveLength(1) // sembolsüz satır atlanır
    expect(g.dash.trending.items[0]).toMatchObject({ symbol: 'AAA', marketCap: 1_000_000, volume: 99_000, change: 12.5, holders: 800, launchpad: 'Pump.fun' })
    // trend + bakiye + 2 istatistik + 2 kâr = 6 GMGN çağrısı
    await waitFor(async () => gmgn.calls.slice(before).filter((c) => c.fn === 'walletProfits').length >= 2)
    const fns = gmgn.calls.slice(before).map((c) => c.fn)
    expect(fns.filter((f) => f === 'trending')).toHaveLength(1)
    expect(fns.filter((f) => f === 'walletStats')).toHaveLength(2)
    expect(fns.filter((f) => f === 'walletProfits')).toHaveLength(2)

    // Süresi dolmadan ikinci tur GMGN'e gitmez (hız sınırını harcamaz)
    const n = gmgn.calls.length
    await engine.dashboard.tick()
    expect(gmgn.calls.length).toBe(n)

    // Anahtar silinince eski veri gösterilmez
    await runCommand(dev.client, dev.id, 'gmgn.clear', {})
    const after = await waitFor(async () => {
      const x = await dash()
      return x && x.configured === false ? x : null
    })
    expect(after.dash).toBeUndefined()

    // Sonraki testler için anahtar ve cüzdan geri yüklenir
    await runSealed(dev.client, dev.id, 'gmgn.save', { apiKey: 'dash-test-key', privateKeyPem: pem })
    await runCommand(dev.client, dev.id, 'gmgn.wallet', { address: w.wallets[0].address })
  })

  it('akış kartı: öneri ızgarası GMGN aramasıyla dolar; kullanıcı sadece gizle/sabitle yapabilir', async () => {
    gmgn.searchResults.set('dog', [{ address: mint(), name: 'Dog', symbol: 'DOG', price: '0.001', mcp: '50000' }])
    const id = await engine.feed.ingest(dev.id, null, {
      platform: 'x',
      externalId: `t-${tag}`,
      author: { name: 'Test', handle: 'test' },
      body: 'Yeni $DOG çıktı "Big Dog"'
    })
    const card = await waitFor(async () => {
      const { data } = await dev.client.from('feed_items').select('*').eq('id', id!).single()
      return data?.suggestions ? data : null
    })
    expect(card.tickers).toEqual(['DOG'])
    expect(card.suggestions[0].symbol).toBe('DOG')
    expect(card.suggestions[0].mcapUsd).toBe(50000)

    const pin = await dev.client.from('feed_items').update({ pinned: true }).eq('id', id!).select('pinned')
    expect(pin.data?.[0]?.pinned).toBe(true)
    const bad = await dev.client.from('feed_items').update({ text: 'değiştirildi' }).eq('id', id!)
    expect(bad.error).toBeTruthy()
    const other = await asst.client.from('feed_items').select('id').eq('id', id!)
    expect(other.data ?? []).toEqual([])

    // Telegram görsel önizlemesi karta gömülür (herkese açık depoya gitmez); 7 günlük temizlik kartı siler
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9])
    await engine.feed.attachPhoto(dev.id, 'x', `t-${tag}`, jpeg)
    const { data: withPhoto } = await dev.client.from('feed_items').select('media').eq('id', id!).single()
    expect(withPhoto!.media[0].url).toMatch(/^data:image\/jpeg;base64,/)
    await engine.feed.attachPhoto(dev.id, 'x', `t-${tag}`, new Uint8Array(200 * 1024)) // büyük görsel atlanır
    expect((await dev.client.from('feed_items').select('media').eq('id', id!).single()).data!.media[0].url).toMatch(/^data:/)
    await admin.from('feed_items').update({ received_at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() }).eq('id', id!)
    expect(await engine.feed.cleanup()).toBeGreaterThan(0)
    expect((await admin.from('feed_items').select('id').eq('id', id!)).data).toEqual([])
  })

  it('founder herkesin motor durumunu okur, asistan sadece kendininkini', async () => {
    const f = await founder.client.from('engine_user_state').select('user_id').eq('user_id', dev.id)
    expect(f.data?.length).toBe(1)
    const a = await asst.client.from('engine_user_state').select('user_id').eq('user_id', dev.id)
    expect(a.data ?? []).toEqual([])
  })
})
