# MemeBot — Devir Dokümanı (Claude için)

Son güncelleme: 16 Ekim 2026 · Son yayınlanan sürüm: **v0.1.5**
Bu dosya, projeye sıfırdan katılan bir Claude oturumunun her şeyi anlayıp kaldığı yerden devam edebilmesi için yazıldı.
Önce bunu, sonra `docs/V2-TASLAK.md`'yi oku. Tarihçe için `docs/MVP-PLAN.md`.

> ⚠️ Bu repo **public**. Bu dosyada ve repoda hiçbir sır yok, olmamalı. Anahtarları asla commit'leme, loglara yazdırma, sohbete isteme.

---

## 0. Hızlı özet (30 saniyede)

- **Ne:** Telegram ve X (Twitter) sinyallerinden gelen Solana meme coin adreslerini yakalayıp **GMGN OpenAPI** ile güvenlik kontrolünden geçiren, kurallara göre onaylı ya da otomatik **alım-satım** yapan uygulama.
- **Şu anki yapı:** Electron + React masaüstü uygulaması (Windows). Veritabanı ve giriş **Supabase**'te. Güncellemeler **GitHub Releases** ile otomatik.
- **Durum:** MVP'nin 5 fazı + X kaynağı kodlandı ve yayınlandı (v0.1.0 → v0.1.5). **Gerçek GMGN cüzdanıyla tek bir işlem bile denenmedi.** Varsayılan mod "deneme" (para harcamaz).
- **Sıradaki iş:** v2. Kullanıcı J7Tracker benzeri akış/deploy/ayarlar ve **Chrome'dan erişim** istiyor. Mimari kararı verildi: **A — MemeBot Engine sunucusu** (§9).

---

## 1. Kullanıcı ve çalışma tarzı

- **Dil:** Kullanıcı Türkçe yazar. Yanıtlar, UI metinleri ve kod yorumları **Türkçe**.
- **Seviye:** Teknik değil ama hızlı karar verir. "Karışıklık istemiyorum" der: net, adım adım, kısa açıklama.
- **Tasarım:** **Sade, az renkli.** Tek tonlu koyu tema. Renk sadece anlam için: yeşil = kâr/geçti, kırmızı = zarar/red, sarı = uyarı.
- **Roller:** founder (kullanıcının kendisi), developer, assistant. Uygulamaya sahip olmayan kimse giriş yapamamalı.
- **Kullanıcının yaptığı işler:** Supabase'de **migration'ları SQL Editor'dan kendisi çalıştırır**. Her yeni migration'dan sonra "çalıştırdım" der, sonra yayın istenir.
- **Onay gerektirenler:** push, release ve public işlemler için her seferinde açık onay alınır. Kullanıcı genelde "Sürümü 0.1.x yap, push'la ve GitHub Releases'te yayınla" der.
- **Kullanıcının hesapları:**
  - GitHub: `FakeLord`.
  - Repo: https://github.com/FakeLord/memebot (public).
  - Proje klasörü: `C:\Users\civan\Desktop\PROJELER\memebot` (Windows 11).

---

## 2. Teknoloji ve yapı

| Katman | Seçim |
|---|---|
| Masaüstü | Electron 44 + electron-vite 6 + Vite 8 |
| Arayüz | React 19 + TypeScript 5.9 (düz CSS, tema CSS değişkenleriyle `src/renderer/src/styles.css`) |
| Veritabanı / giriş | Supabase (Postgres + Auth + Realtime + Edge Functions); RLS her tabloda açık |
| Alım-satım | GMGN OpenAPI (`https://openapi.gmgn.ai`) |
| Telegram | GramJS (`telegram` npm), kullanıcı hesabıyla **salt-okur** userbot |
| X / Twitter | XFlux (`https://www.xfluxapi.com/api/v1`), izleyici (monitor) yoklama |
| Paketleme / güncelleme | electron-builder (NSIS) + electron-updater ← GitHub Releases |
| CI | `.github/workflows/ci.yml` (push → build), `release.yml` (`v*` etiketi → derle + yayınla) |

### Dosya haritası

```
src/main/                 Electron ana süreci (Node) — sırlar ve dış API çağrıları BURADA
  index.ts                pencere, IPC kayıtları, tek-örnek kilidi
  secrets.ts              GMGN / Telegram / XFlux sırları → safeStorage (Windows DPAPI) ile userData/secrets/<userId>.<tür>
  updater.ts              electron-updater (açılışta + 30 dk'da bir)
  gmgn/signer.ts          GMGN istek imzası (Ed25519)
  gmgn/client.ts          GMGN HTTP istemcisi (IPv4 zorunlu, öncelikli hız sınırlayıcıdan geçer)
  gmgn/limiter.ts         sızdıran kova + öncelik (Trade > Order > Safety > Price), 429'da duraklama
  gmgn/trade.ts           buy/sell/quote/queryOrder/holdings/wallets + mutlak üst sınır (5 SOL/emir)
  telegram/service.ts     GramJS giriş akışı (kod + 2FA), sohbet listesi, mesaj dinleme
  xflux/client.ts         XFlux yoklama + belgelenmemiş yanıtı esnek ayrıştırma
src/preload/              contextBridge → window.api (tipler: src/shared/types.ts MemeBotApi)
src/shared/               iki tarafta ortak: extract.ts (mint ayıklama), safety.ts (güvenlik puanı), types.ts
src/renderer/src/
  App.tsx                 sağlayıcı zinciri + sayfa yönlendirme (state tabanlı, router yok)
  lib/auth.tsx            Supabase oturumu + profil (pasif/profilsiz hesap girişte atılır)
  lib/killswitch.tsx      founder'ın "Tümünü durdur" anahtarı (app_settings.kill_switch, realtime)
  lib/telegram.tsx        Telegram sağlayıcı: izlenen sohbetler → record_signal RPC
  lib/xsource.tsx         X sağlayıcı: XFlux yoklama, engine_leases ile tek bilgisayar, kotaya göre aralık
  lib/pipeline.tsx        Karar motoru: yeni sinyal → GMGN güvenlik → kural → candidates (onay adayı)
  lib/orders.tsx          Emir motoru: limitler, idempotency, swap/quote, takip, kurtarma, otomatik mod, Tümünü sat
  lib/tracker.tsx         Açık pozisyonlarda canlı fiyat/PnL + GMGN TP/SL sonrası bakiye eşitleme
  pages/                  Feed, Approvals, Positions, Orders, Sources, TokenCheck, Rules, Settings, Users, Login
supabase/
  migrations/             5 dosya, TARİH SIRASIYLA çalıştırılır (§4)
  functions/manage-users  founder'ın kullanıcı oluşturma/silme Edge Function'ı (service_role burada)
  bootstrap-founder.sql   ilk kurulumda kendini founder yapma
docs/                     MVP-PLAN.md, V2-TASLAK.md, HANDOFF.md (bu dosya)
```

Sağlayıcı sırası (`App.tsx`):
`AuthProvider > KillSwitch > Telegram > XSource > Pipeline > Orders > Tracker > Layout`

---

## 3. Güvenlik modeli (bozma!)

- **Açık kayıt kapalı** (Supabase Auth ayarı). Uygulamada kayıt ekranı yok; kullanıcıyı sadece founder **Kullanıcılar** ekranından ekler (`manage-users` Edge Function).
- **Yeni profil varsayılan olarak pasif:** `handle_new_user` tetikleyicisi profili `is_active=false` açar. `my_role()` pasif kullanıcı için NULL döner ve tüm RLS politikaları NULL'da reddeder.
- **Rol yetkileri:**
  - `can_trade()` = founder veya developer. Asistan sinyal, akış ve kontrol görebilir; emir, pozisyon ve kural yazamaz.
  - founder herkesin verisini okur ve kullanıcıları yönetir.
- **Sırlar:**
  - **GMGN anahtarı + Ed25519 imza anahtarı, Telegram oturumu, XFlux anahtarı:** Supabase'e gitmez; her bilgisayarda `safeStorage` ile şifreli dosyada durur.
  - **Supabase anon anahtarı:** uygulamaya gömülüdür (tasarım gereği; koruma RLS'te).
  - **`service_role`:** sadece Edge Function'da.
- **Para güvenliği kuralları:**
  - **Tek emir:** her emir benzersiz `idempotency_key` ile yazılır; çift tıklama ya da iki bilgisayar tek emir üretir.
  - **Koşullu güncelleme:** durum geçişleri (`pending → approved`, `submitted → confirmed`) `.eq('status', eski)` ile yapılır. Geçişi "kazanan" bilgisayar yan etkiyi uygular.
  - **Pozisyon açılışı:** GMGN'de `confirmed` görülmeden pozisyon açılmaz.
  - **Tekrar deneme:** başarısız alım-satım **otomatik tekrar denenmez**.
  - **Üst sınır:** ana süreçte 5 SOL/emir mutlak sınır (`HARD_MAX_BUY_SOL`).
  - **Kill switch:** alımları durdurur; satışlar her zaman serbest.
- **Kapsam dışı (bilinçli):** Bundle/sniper (çıkışta çoklu cüzdanla gizli alım), Vamp (başka token'ın kimliğini kopyalama), Multi deploy, tarayıcı eklentisi. Gerekçe `V2-TASLAK.md §3`. Kullanıcı bunları istese bile manipülasyon/yanıltma riski nedeniyle yapma; nedenini kısaca açıkla.

---

## 4. Veritabanı (Supabase)

Migration'lar **sırasıyla** (kullanıcı hepsini çalıştırdı):

| Dosya | İçerik |
|---|---|
| `20261016000000_init.sql` | enum'lar, `profiles`, `app_settings` (kill_switch, min_app_version), `sources`, `signals`, `signal_hits`, `safety_checks`, `rules`, `orders`, `positions`, `engine_leases`, `audit_log`, RLS, realtime yayını |
| `20261016120000_signals.sql` | `signals.msg_id` + tekrar indeksi; **`record_signal()` RPC** (aynı mesaj/mint iki kez sayılmaz, `signal_hits` sayacı) |
| `20261016150000_candidates.sql` | `sources.type` += `manual`; `rules` kullanıcı başına tek; **`candidates`** (onay adayları, `pending` için tekil); `expire_candidates()` |
| `20261016180000_trading.sql` | `orders` += candidate_id, position_id, sell_percent, symbol; `positions` += buy_order_id (unique), symbol, entry_mcap, cost_sol, proceeds_sol; açık pozisyon tekilliği |
| `20261016210000_positions_auto.sql` | `positions` += amount_initial_raw, decimals, proceeds_estimated, close_reason; `candidates.auto` |

Önemli JSON alanları:
- **`rules.thresholds`** (`SafetyThresholds`, `src/shared/safety.ts`):
  - mint/freeze renounce, rug_ratio, top10, dev ekip, insider, bundler, vergi, wash trading,
  - min likidite, mcap aralığı.
- **`rules.limits`** (`RuleLimits`, `lib/pipeline.tsx`):
  - onay: allowWarn, approvalTtlMin, buyPresetsSol, maxBuySol,
  - işlem: **liveTrading** (false = deneme), slippage | 'auto', priorityFeeSol, tipFeeSol, antiMev,
  - limitler ve otomatik mod: dailyMaxSol, maxOpenPositions, autoBuySol, dailyLossLimitSol.
- **`rules.tp_sl_template`:** GMGN `condition_orders` dizisi.
- **`rules.mode`:** `watch` | `manual` | `auto`.

**Yeni migration eklerken:** dosya adı tarih sırasını korumalı. Kullanıcıya "SQL Editor'da şu dosyayı çalıştır" diye söyle. Yayın, kullanıcı çalıştırdım dedikten sonra.

---

## 5. Veri akışı

```
Telegram (GramJS, ana süreç) ─┐
XFlux yoklama (renderer)      ├─► record_signal RPC ─► signals / signal_hits (realtime)
Elle ekleme (Canlı Akış)      ┘                              │
                                                             ▼
                        pipeline: GMGN token/info + security (3 dk ortak önbellek: safety_checks)
                        → kullanıcının eşikleri → GEÇTİ/UYARI/RED
                        → mode≠watch ve geçti → candidates (pending, süreli)
                                                             │
           manuel: Onay Bekleyenler'de "Al/Dene"     otomatik: orders.tsx candidates INSERT'i dinler,
                                                     günlük zarar sınırı → aşıldıysa mod=manual
                                                             ▼
                        orders.buy(): limitler → orders satırı (idempotency) → GMGN swap (gerçek) / quote (deneme)
                        → query_order takibi (3 sn, ~3 dk) → confirmed → positions
                                                             ▼
                        tracker: 15 sn'de bir fiyat + (gerçekte) wallet_holdings ile TP/SL sonrası bakiye eşitleme
```

---

## 6. Dış API notları (doğrulanmış ve belirsiz olanlar)

### GMGN OpenAPI

Kaynak: resmi istemci https://github.com/GMGNAI/gmgn-skills → `src/client/OpenApiClient.ts`, `signer.ts`, `skills/*/SKILL.md`

- **Kimlik doğrulama:**
  - `X-APIKEY` başlığı.
  - Query'ye `timestamp` (Unix sn, **±5 sn**) ve `client_id` (UUID, 7 sn içinde tekrar reddedilir) eklenir.
  - İşlem rotalarında ayrıca `X-Signature` gerekir: Ed25519 imzası, base64. İmzalanan metin: `{path}:{alfabetik_sıralı_query}:{body}:{timestamp}`.
- **IPv4 zorunlu** (IPv6 → 401/403). İstemci `family: 4` kullanıyor.
- **Hız sınırı** (sızdıran kova, rate/kapasite): Free 5/5, Plus 20/20, Pro 50/50.

**Uç noktalar ve ağırlıklar:**

| Uç nokta | Ağırlık |
|---|---|
| `GET /v1/token/info` · `/v1/token/security` · `/v1/token/pool_info` | 1 |
| `GET /v1/trade/quote` | 10 (imzasız) |
| `POST /v1/trade/swap` | 10 |
| `GET /v1/trade/query_order` | 5 |
| `GET /v1/user/info` | 2 |
| `GET /v1/user/wallet_holdings` | 2 (yanıt `{list:[{token:{token_address,price}, balance}], next}`) |
| `POST /v1/cooking/create_token` (deploy, v2'de kullanılacak) | 5 |
| `GET /v1/market/search` (token önerisi, v2) | — |

**Alanlar:**
- `price` bir **nesne**: `price.price`.
- Likidite `liquidity`; mcap = `price × circulating_supply`.
- SOL'de honeypot alanı yok.
- Swap: miktar **en küçük birimde** (lamport).
- `slippage` 0–100 tamsayı.
- Yüzdeyle satış: `input_amount:"0"` + `input_amount_bps`.
- TP/SL: `condition_orders` (`profit_stop`, `loss_stop`, `*_trace`). `priority_fee` + `tip_fee` zorunlu.
- Emir durumu: `pending → processed → confirmed | failed | expired`.

**Belirsiz (gerçek yanıtla doğrulanmadı):**
- `/v1/user/info` cüzdan şeması (`trade.ts extractWallets` esnek tarar),
- swap/query_order `report` alanları,
- işlem cüzdanının GMGN'de barındırılıp barındırılmadığı,
- işlem ücreti,
- Free planda swap çalışıyor mu (ağırlık 10 > kapasite 5).

### XFlux

Kaynak: xfluxapi.com/docs/api, /docs/monitors, /docs/limits

- **Kimlik doğrulama:** `X-API-Key: xflux_...`.
- **İzleyiciler:** sadece **panelden** kurulur; API ile okunur: `GET /monitors?include_hits=1&hit_limit=N`.
- **Planlar:** Free 1 izleyici / **5 dk**, Starter $19 → 3 izleyici / 1 sn / 150k çağrı/ay, Growth 8, Pro 20, Scale 50.
- **429:** `QUOTA_EXCEEDED` | `RATE_LIMIT_EXCEEDED` + `Retry-After`. Başlıklar: `X-Quota-Remaining`.
- **Hit JSON şeması belgelenmemiş:** `parseMonitors/parseHit` esnek. Tweet kimliği sayısal (19 hane, **metin olarak** RPC'ye gider). Metin/URL alanları taranır, profil/medya URL'leri hariç.

### Telegram

- `my.telegram.org`'dan API ID/Hash alınır.
- Giriş kod (+2FA) ile yapılır. Hesabı olmayan numarada **yeni hesap açılmaz** (`firstAndLastNames` hata fırlatır).
- Mesaj metni + `MessageEntityTextUrl` + inline buton URL'leri taranır.
- **Kullanıcı Telegram'ı henüz bağlamadı.**

---

## 7. Yayın (release) süreci

1. Kod değişikliği → `npm run build` temiz olmalı (typecheck + build).
2. Commit. Mesaj Türkçe; sonuna şu satır eklenir:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
3. Kullanıcı onay verince:
   - `npm version 0.1.X --no-git-tag-version`
   - commit `v0.1.X`
   - `git tag -a v0.1.X -m "..."`
   - `git push origin main && git push origin v0.1.X`
4. GitHub Actions `release.yml` çalışır:
   - etiket ile `package.json` sürümünü karşılaştırır,
   - **taslak release** açar, electron-builder yükler, sonra taslağı yayına alır.
   (Bu sıra v0.1.0'da yaşanan "çift release" sorununa karşı.)
5. Kontrol et: `gh api repos/FakeLord/memebot/releases` → tek kayıt, 3 dosya (`.exe`, `.exe.blockmap`, `latest.yml`), `releases/latest` yeni sürüm.
6. Repo Actions **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (tanımlı). Eksikse derlenen uygulama "Yapılandırma eksik" ekranında kalır.

**Sürüm geçmişi:**

| Sürüm | İçerik |
|---|---|
| 0.1.0 | İskelet: Supabase, roller, GMGN istemcisi, Token Kontrol, güncelleme |
| 0.1.1 | Telegram dinleyicisi |
| 0.1.2 | Otomatik güvenlik kontrolü, Kurallar, Onay ekranı, GMGN kuyruğu |
| 0.1.3 | Alım-satım (deneme + gerçek), TP/SL, Emirler, cüzdan seçimi |
| 0.1.4 | Canlı PnL, TP/SL eşitleme, Tümünü sat, otomatik mod |
| 0.1.5 | X/Twitter (XFlux) |

---

## 8. Ortam tuzakları (Windows)

- **Claude masaüstü uygulamasının terminali yalıtılmış AppData kullanır:** kullanıcının oradaki `gh` "not logged in" der. `gh` girişi Claude'un Bash aracında (Windows kimlik deposu) çalışıyor. `workflow` izni daha önce verildi (`gh auth refresh -s workflow`, cihaz kodu akışıyla).
- **Electron ikilisi:** npm install betikleri kapalı geldiği için `package.json`'da `postinstall: node node_modules/electron/install.js` var.
- **Tek-örnek kilidi:** kurulu MemeBot açıkken `npm run dev` hemen kapanır. Test için `electron.exe . --user-data-dir=<kısa yol>` kullan. Uzun yol "dosya adı çok uzun" hatası verir.
- **Electron süreçlerini kapatırken** isimle değil **yol filtresiyle** kapat. Claude uygulaması da Electron, onu öldürme:
  `Get-Process electron | ? Path -like '...memebot\node_modules\electron\*'`
- **Node 26 strip-types** `enum` ve parameter property desteklemiyor. Hızlı test için `npx tsc ... --module esnext --moduleResolution bundler` ile geçici klasöre derleyip çalıştır. (Kalıcı test altyapısı yok, §10.)
- **Python ile toplu düzenleme yaparken** `'...\'...'` kaçışları bozuluyor. Türkçe kesme işaretli metinlerde çift tırnaklı string kullan.
- **Sırları okuma:** bir güvenlik kancası `.env` okumayı engelliyor; doğru davranış bu. Varlığını `Glob` ile kontrol et.

---

## 9. v2 — kararlar ve sıradaki işler

Ayrıntılar: `docs/V2-TASLAK.md`. Kullanıcı J7Tracker videosundaki ekranları istiyor (akış kartları, öneri ızgarası, ayarlar, ücret preset'leri, deploy formu, cüzdanlar) ve **Chrome'da da açılmasını** istiyor.

**Verilen karar:** Web mimarisi **A — MemeBot Engine**.
- Ana süreçteki mantık 7/24 çalışan tek bir Node servisine taşınır: GMGN, Telegram, XFlux, pipeline, emir motoru, tracker, otomatik mod.
- Web ve masaüstü sadece arayüz olur.
- Arayüz komutları Supabase'e yazar (ör. `orders` `created` → motor çalıştırır).
- Sırlar motorda şifreli tutulur.
- Arayüz statik siteye taşınır (Netlify, Vercel ya da Cloudflare Pages); giriş yine Supabase.

**Kullanıcıdan beklenen açık kararlar** (`V2-TASLAK.md §8`):
1. **Motorun yeri:** VPS (~$5–6/ay, 7/24) mi, kullanıcının bilgisayarında Windows servisi mi?
2. **X kapsamı ve bütçe:** XFlux az hesap gerçek zamanlı, TweetAPI ile geniş liste.
3. **AI ad/görsel önerisi:** Claude API ile, istiyor mu?
4. **Sıra:** önerilen önce **v2-0 gerçek GMGN doğrulaması**.

**Faz planı:**
- v2-0 doğrulama
- v2-1 motor + web
- v2-2 akış v2
- v2-3 ayarlar v2 (ücret preset'leri P1–P3 dahil)
- v2-4 deploy (GMGN `create_token`)
- v2-5 cüzdanlar

Yeni tablolar taslağı `V2-TASLAK.md §7`'de.

---

## 10. Bilinen eksikler ve riskler

- **Gerçek doğrulama yok:** GMGN alım-satım, XFlux yanıtları ve Telegram canlı dinleme hiç gerçek hesapla denenmedi. İlk iş: kullanıcıyla küçük tutarlı (0.01–0.05 SOL) bir gerçek döngü. Hata çıkarsa Emirler ekranındaki hata metnine bak.
- **Otomatik test yok.** Önceki oturumda bir test altyapısı görevi önerildi (Vitest; extract/safety/signer/limiter/toRaw/extractWallets). Başlatıldıysa ayrı bir dalda olabilir, `main`'e birleşmedi; `git branch -a` ile kontrol et.
- **Kod imzası yok:** kurulumda Windows "bilinmeyen yayıncı" uyarısı çıkar.
- **TP/SL tahmini:** GMGN'de tetiklenen satışın getirisi bilinmiyor; o anki fiyattan **tahmin** ediliyor (`proceeds_estimated`).
- **X maliyeti:** XFlux Free planı 5 dk gecikmeli, pratikte işe yaramaz.
- **Engine lease:** tek bilgisayar kuralı (`engine_leases`) sadece X yoklamasında kullanılıyor. v2 motoruyla tümüne genişlemeli.
- **Renderer bundle ~1.3 MB:** önemsiz ama code-split yapılabilir.

---

## 11. Bir sonraki Claude için ilk adımlar

1. `git pull` → `npm install` → `npm run build` temiz mi kontrol et.
2. Kullanıcıya §9'daki açık kararları sor (özellikle motorun nerede çalışacağı).
3. Önce v2-0'ı öner: deneme modunda bir tur, sonra gerçek küçük tutar. Sorunları düzelt, sürüm çıkar.
4. Sonra v2-1'e (motor + web) başla. Mevcut sözleşmeleri koru: idempotency, koşullu durum geçişleri, otomatik tekrar yok, kill switch, roller ve RLS.
