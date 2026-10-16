# MemeBot — Devir Dokümanı (Claude için)

Son güncelleme: 16 Ekim 2026 · Yayınlanan son sürüm: **v0.1.5** · Kodda hazır: **v2 Faz 1–7 (0.2.0 adayı)**
Bu dosya, projeye sıfırdan katılan bir Claude oturumunun her şeyi anlayıp kaldığı yerden devam edebilmesi için yazıldı.
Sırayla oku: bu dosya → `docs/V2-PLAN.md` (fazlar, kararlar) → `docs/KURULUM-V2.md` (kullanıcının adımları) → `docs/V2-TASLAK.md` (J7 ekran analizi).

> ⚠️ Repo **public**. Hiçbir sır yok, olmamalı. Anahtarları commit'leme, loglama, sohbete isteme.

---

## 0. Hızlı özet

- **Ne:** Telegram + X sinyallerinden Solana token adreslerini yakalar, GMGN ile güvenlik kontrolü yapar, kurallara göre onaylı/otomatik alım-satım yapar; J7Tracker tarzı canlı akış, öneri ızgarası ve token deploy formu.
- **Mimari (v2):** **MemeBot Engine** (tek Node süreci) her işi yapar; masaüstü (Electron) ve web (Cloudflare Pages) aynı React arayüzü, sadece Supabase ile konuşur.
- **Motorun yeri:** şimdilik kullanıcının bilgisayarında, masaüstü uygulamasının içinde (utilityProcess). Sonra VPS (Faz 9).
- **Durum:** Faz 1–7 kodlandı, test edildi, `main`'e yerel commit'lendi. **Push/yayın kullanıcı onayı bekliyor** (§7). Gerçek GMGN cüzdanıyla hâlâ hiç işlem yapılmadı (Faz 8). Varsayılan mod **deneme**.

---

## 1. Kullanıcı ve çalışma tarzı

- Türkçe; teknik değil ama hızlı karar verir. Net, adım adım, kısa.
- **Tasarım (J7 tarzı):** kompakt koyu tema; ortalanmış üst menü, alt durum çubuğu (Ücret popover'ı orada), ikonlu sol menülü Ayarlar. Vurgu rengi (varsayılan indigo) sadece seçili öğe/birincil buton için; anlam renkleri sabit (yeşil kâr/geçti, kırmızı zarar/red, sarı uyarı). İkonlar `lucide-react`.
- Roller: founder (kullanıcı), developer, assistant. Açık kayıt kapalı.
- **Migration'ları kullanıcı SQL Editor'dan çalıştırır**; "çalıştırdım" dedikten sonra yayın.
- Push / release / public işlemler her seferinde açık onayla.
- GitHub `FakeLord/memebot` · klasör `C:\Users\civan\Desktop\PROJELER\memebot` (Windows 11).

**Kullanıcı kararları (16 Ekim 2026):** motor önce kendi bilgisayarında, sonra VPS · X için şimdilik ücretli plan yok (XFlux ücretsiz, temsili) · AI ad/görsel önerisi sonra · gerçek para testi sonra (Faz 8) · web Cloudflare Pages.

---

## 2. Teknoloji ve dosya haritası

Electron 44 + electron-vite 6 + Vite 8 · React 19 + TS 5.9 (düz CSS, tema = CSS değişkenleri) · Supabase (Postgres, Auth, Realtime) ·
GMGN OpenAPI · GramJS · XFlux · Vitest 5 · electron-builder/updater ← GitHub Releases · Cloudflare Pages (web).

```
src/engine/            MOTOR (Node, Electron'a bağımlı DEĞİL) → out/main/engine.js
  index.ts             giriş: ortam değişkenleri, kasa, Supabase(service_role), Engine.start
  engine.ts            tek motor kilidi (engine_claim), realtime + yedek yoklama, modülleri bağlar
  context.ts           EngineContext: db, kasa, Users (profil/kural/anahtar kelime önbelleği), StateWriter (engine_user_state)
  vault.ts             kasa: AES-256-GCM (ENGINE_MASTER_KEY), kullanıcı sırları + mühürlü zarf RSA anahtar çifti
  commands.ts          engine_commands işleyicileri (gmgn.*, token.check, xflux.*, telegram.*, positions.sell_all, deploy.submit)
  orders.ts            emir motoru: created→sending→submitted→…→confirmed; limitler, preset ücretleri, takip, pozisyon
  pipeline.ts          sinyal → güvenlik (3 dk ortak önbellek) → aday → otomatik mod
  tracker.ts           15 sn'de bir fiyat (positions.last_price_usd) + GMGN TP/SL bakiye eşitleme
  sources.ts           kullanıcı başına Telegram oturumu ve XFlux yoklayıcı → sinyal + akış kartı
  feed.ts              feed_items yazıcı, öneri ızgarası (GMGN market/search), 7 gün temizlik
  deploy.ts            create_token (deneme: sadece kayıt), emir takibi, report.output_token
  gmgn/                client (IPv4, imza, hız sınırlayıcı), signer, limiter, trade (saf fonksiyonlar)
  telegram/service.ts  GramJS giriş + dinleme (kullanıcı başına örnek)
  xflux/client.ts      yoklama + esnek ayrıştırma (yazar, medya, alıntı)
src/main/              Electron kabuğu: pencere, updater, engineHost.ts (motoru utilityProcess ile çalıştırır)
src/preload/           window.desktop (sadece masaüstünde): sürüm, updater, motor ayarı
src/shared/            ortak: types, rules, safety, extract, seal (mühürlü zarf), engine (komut sözleşmesi),
                       engineClient (komut gönder/bekle), feed (vurgu, ticker), settings (preset, tema, CSV), deploy
src/renderer/src/
  lib/                 auth, engine (motor durumu + run/runSealed), pipeline (kural), orders (niyet), prefs (tema/kısayol/
                       anahtar kelime/preset/bildirim), wallets, killswitch, platform (masaüstü mü)
  components/          Layout (menü, üst çubuk, durum çubuğu), FeedCard, DeployPanel
  pages/               Feed (Akış/Sinyaller), Approvals, Positions, Orders (+deploy geçmişi), Sources, TokenCheck, Rules,
                       Settings (+settings/: Accounts, Keywords, Appearance, Presets, DeploySettings, Wallets, Shortcuts), Users
supabase/migrations/   10 dosya (§4) · supabase/config.toml: yerel geliştirme (Docker)
tests/unit, tests/integration (yerel Supabase + sahte GMGN) · scripts/dev-engine.mts (sahte GMGN'li geliştirme motoru)
vite.web.config.mts    web derlemesi → dist-web/ · build/csp.ts: CSP'ye derleme anındaki Supabase adresini ekler
```

---

## 3. Güvenlik modeli (bozma!)

- Açık kayıt kapalı; yeni profil pasif; `my_role()` pasifte NULL → tüm RLS reddeder.
- **Arayüz sadece niyet yazar.** `orders` insert: sadece `status='created'`, kendi `user_id`, `can_trade()`. Güncelleme/silme ve `positions` yazma **sadece motor** (service_role). `feed_items`: kullanıcı sadece `hidden`/`pinned` (sütun yetkisi).
- **Motor:** `service_role` ile çalışır; bu yüzden rol, kill switch, mod, limitleri kendisi ve **taze veriyle** uygular. Ücret/slippage/TP-SL'yi kuraldan ve preset'ten kendisi hesaplar.
- **Sırlar:** GMGN anahtarı + Ed25519 PEM, XFlux, Telegram oturumu motorun kasasında (AES-256-GCM). Arayüz → motor: **mühürlü zarf** (RSA-OAEP 3072 + AES-GCM, aad = kullanıcı + komut türü); motor üstlenirken komut `payload`'ını siler. Motor ana anahtarı: masaüstünde `safeStorage` (host.bin), VPS'te `.env.engine`.
- **service_role:** masaüstünde founder Ayarlar'dan bir kez girer (safeStorage); VPS'te `.env.engine`. Repoya asla.
- **Para kuralları:** idempotency · koşullu durum geçişleri · `confirmed` olmadan pozisyon yok · otomatik tekrar yok · 'sending'de motor durursa emir **başarısız** (tekrar yok) · 60 sn'den eski niyet çalıştırılmaz · kill switch alım+deploy durdurur, satış serbest · 5 SOL/emir · deneme modu varsayılan.
- **Tek motor:** `engine_claim(instance, 30sn)`; 10 sn'de bir kalp atışı. İkinci motor bekler; kilidi kaybeden bırakır.
- Regex anahtar kelimeleri motorda çalıştırılmaz (ReDoS); sadece kullanıcının tarayıcısında.
- Telegram görsel önizlemeleri herkese açık depoya gitmez: karta data URL (≤150 KB), RLS altında.
- **Kapsam dışı:** bundle/sniper, vamp, multi deploy, tarayıcı eklentisi (V2-TASLAK §3) — deploy isteğinde bu alanlar bilinçli olarak yok.

---

## 4. Veritabanı

Sırayla (ilk 5'i kullanıcı çalıştırdı; **6–10 yeni**, KURULUM-V2 §1):

| # | Dosya | İçerik |
|---|---|---|
| 1–5 | `20261016…` | ilk şema, sinyaller, adaylar, alım-satım, pozisyon/otomatik (v0.1.x) |
| 6 | `20261017000000_engine.sql` | `sending` durumu, emir/pozisyon yazma motora, `engine_status` + `engine_claim()`, `engine_user_state`, `engine_commands`, `engine_record_signal()`, `signals.processed_at`, `positions.last_price_usd`, engine_leases kaldırıldı, min_app_version 0.2.0 |
| 7 | `20261018000000_feed.sql` | `feed_items` (gizle/sabitle sütun yetkisi) |
| 8 | `20261019000000_settings.sql` | `sources.muted/notify`, `shared_accounts`, `keywords`, `fee_presets`, `ui_settings`, `orders.preset` |
| 9 | `20261020000000_deploys.sql` | `deploys` |
| 10 | `20261021000000_wallets.sql` | `wallet_prefs` |

`rules.limits` yeni alanlar: `activePreset`, `autoPreset` (1–3). Ücret alanları (`priorityFeeSol` vb.) preset kaydı yoksa varsayılan P1 olarak kullanılır.

**Yeni migration:** tarih sırası korunur, kullanıcıya söylenir, yerelde `npx supabase migration up` / `db reset` ile denenir.

---

## 5. Veri akışı

```
Telegram / XFlux (motor) ─► engine_record_signal ─► signals ─► pipeline (motor) ─► candidates
        └──────────────────► feed_items (kart) ─► öneri ızgarası (GMGN arama)
Arayüz: elle sinyal → record_signal RPC                    │
Onay (arayüz) / otomatik mod (motor) ─► orders (created) ─► orders.ts (motor) ─► GMGN ─► positions
Komutlar: arayüz engine_commands (pending) ─► motor (running → done/failed, sonuç satıra)
Motor durumu: engine_status (tek satır), engine_user_state (kullanıcı başına) ─► arayüz (realtime)
```

---

## 6. Dış API notları

**GMGN** (`openapi.gmgn.ai`, kaynak: github.com/GMGNAI/gmgn-skills): `X-APIKEY` + `timestamp`(±5 sn) + `client_id`; işlem rotalarında
Ed25519 `X-Signature`. **IPv4 zorunlu.** Hız: Free 5 · Plus 20 · Pro 50.
Ağırlıklar: token/info·security 1, quote 10, swap 10, query_order 5, user/info 2, wallet_holdings 2, **market/search 1** (`q`, `chain`,
`order_by=weight` → `coins[]`: address, name, symbol, price, `mcp`), **cooking/create_token 5** (imzalı; `buy_amt` SOL düz sayı; `image`
base64 ≤2 MB ya da `image_url`; `pump_fee_share_list`/`bags_fee_share_list` `basic_points` toplam 10000; `sell_configs`; sonuç
`query_order` → `report.output_token`).
**Belirsiz (gerçek yanıtla doğrulanmadı):** user/info cüzdan şeması, swap/query_order report alanları, Free planda swap, market/search
`logo` alanının adı, create_token yanıtı.

**XFlux:** `X-API-Key`; izleyiciler panelden; `GET /monitors?include_hits=1`. Hit şeması belgelenmemiş — `parseHit` X v1/v2 biçimlerini
esnek okur. Free: 1 izleyici / 5 dk. Tweet kimliği 19 hane → **metin** olarak taşınır (JS sayısı son haneleri bozar).

**Telegram:** my.telegram.org API ID/Hash; kod + 2FA; hesap yoksa açılmaz. Kullanıcı henüz bağlamadı.

---

## 7. Yayın (0.2.0 — kullanıcı onayı bekleniyor)

1. Kullanıcı 6–10 numaralı migration'ları çalıştırır ("çalıştırdım").
2. `npm version 0.2.0 --no-git-tag-version` → commit `v0.2.0` → `git tag -a v0.2.0 -m "..."` → `git push origin main && git push origin v0.2.0`.
3. Actions `release.yml` → tek kayıt, 3 dosya (`.exe`, `.blockmap`, `latest.yml`) doğrula: `gh api repos/FakeLord/memebot/releases`.
4. Kullanıcı: uygulama güncellenir → Ayarlar → service_role → motoru aç (KURULUM-V2 §2); Cloudflare Pages (§3).
CI (`ci.yml`) artık `npm test` ve `npm run build:web` de çalıştırır.

---

## 8. Ortam tuzakları (Windows)

- Claude masaüstü uygulamasının terminali yalıtılmış; `gh` Claude'un Bash aracında çalışıyor.
- **postinstall:** `scripts/postinstall.cjs` Electron ikilisini indirir; `CF_PAGES` ya da `ELECTRON_SKIP_BINARY_DOWNLOAD` varsa atlar (Electron 44 kendi atlama ayarını desteklemiyor).
- Tek-örnek kilidi: kurulu MemeBot açıkken `npm run dev` kapanır → `electron.exe . --user-data-dir=C:\mbt`.
- Electron süreçlerini **yol filtresiyle** kapat (Claude uygulaması da Electron).
- **Yerel Supabase:** Docker Desktop (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`) → `npx supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta`. Yerel anahtarlar `npx supabase status -o env` (yerel demo anahtarları).
- Geliştirmede motoru masaüstünde denemek: paketlenmemiş uygulama `MEMEBOT_DEV_SERVICE_KEY` / `MEMEBOT_DEV_MASTER_KEY` ortam değişkenlerini okur (paketlide yok sayılır).
- `scripts/dev-engine.mts` **yerel** veritabanında açık kalırsa testlerle yarışır; testler bunu bekleyerek çözer (11 sn).
- Python ile toplu düzenlemede Türkçe kesme işaretli JS dizgileri bozulabilir (`'GMGN'e'`) → çift tırnak kullan.
- `.env` okumayı bir güvenlik kancası engelliyor (doğru davranış).

---

## 9. Sıradaki işler

- **Yayın 0.2.0** (§7) — kullanıcı onayı.
- **Faz 8 — gerçek doğrulama** (kullanıcıyla, 0.01–0.05 SOL): alım/satım, TP/SL eşitleme, otomatik mod, deploy. §6'daki belirsiz alanları gerçek yanıtla netleştir.
- **Faz 9 — VPS:** Ubuntu + Node 22, `npm ci --omit=dev && npm run build`, `.env.engine`, systemd; NTP; IPv4; gelen port yok. Masaüstünde motoru kapat.
- Sonra: AI ad/görsel, ücretli X planı, X'e gönderi, BSC.

## 10. Bilinen eksikler

- Gerçek GMGN/XFlux/Telegram yanıtlarıyla hiç denenmedi (sadece sahte GMGN + yerel Supabase).
- Kod imzası yok (Windows uyarısı). Renderer paketi ~1.4 MB (code-split yapılabilir).
- TP/SL getirisi tahmini (`proceeds_estimated`).
- Masaüstünde motor sadece uygulama açıkken çalışır.
