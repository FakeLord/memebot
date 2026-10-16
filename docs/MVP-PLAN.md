# Meme Coin Otomasyonu — MVP Plan Taslağı

Tarih: 16 Ekim 2026 · Sürüm: v0.1 (taslak)

---

## 1. Tek cümlede ürün

Seçili Telegram kanallarından gelen kontrat adreslerini yakalayan, GMGN üzerinden güvenlik kontrolü yapan, kurallara uyan token'ları GMGN OpenAPI ile alan ve TP/SL ile yöneten; **sadece kurulu olduğu bilgisayardan erişilebilen**, çok kullanıcılı yerel bir uygulama.

## 2. J7Tracker analizinden aldıklarımız

| J7Tracker'dan alınan ders | Bizim projede karşılığı |
|---|---|
| "Haberi gör → değerlendir → aksiyon al" süresi ürünün özü | Sinyal → güvenlik → işlem zinciri tek süreçte, ölçülen gecikmeyle |
| Aynı olay tekrar tekrar kart olmamalı | Mint adresi bazlı dedupe + kullanıcı başına cooldown |
| Sunucunun isteği kabul etmesi ≠ zincirde kesinleşme | Emir durumları ayrı tutulur: `submitted → pending → confirmed / failed / expired` |
| Çift tıklama tek finansal talep üretmeli | Her emirde benzersiz `idempotency_key` |
| Anahtar ve oturum sırları loglara girmez | Tüm sırlar DB'de şifreli, log maskeleme zorunlu |
| İstek limiti aşımında geri çekil, `Retry-After`'a uy | Tek merkezi GMGN istek kuyruğu (rate-limit bilinçli) |
| Eklenti güvenlik skandalı (veri sızdırma) | Tarayıcı eklentisi yok; her şey yerel ve kendi kodumuz |
| İlk sürümde otomatik işlem varsayılan olmamalı | Varsayılan **manuel onay**; otomatik mod kural bazında ve sert limitlerle açılır |

J7Tracker'dan **almadıklarımız** (MVP dışı): token deploy, bundle/sniper, çoklu zincir, bölgesel sunucular, geliştirici API'si, slot satışı.

## 3. Güncellenmiş işlem ağacı

Orijinal ağaçtaki "İşlem Motoru (Jupiter/Jito)" kısmını **GMGN OpenAPI** üstleniyor: rota bulma, anti-MEV, priority/tip fee ve sunucu tarafı TP/SL GMGN'de. Bu, bizim tarafta Solana RPC / Jupiter / Jito entegrasyonu yazma ihtiyacını ortadan kaldırıyor.

```
Telegram (userbot) ──┐
                     ├─► Sinyal Motoru ─────► Güvenlik Kontrolü ─────► Karar Motoru ─────► İşlem Motoru ─────► GMGN OpenAPI ─► Solana
X/Twitter (Faz 2) ───┘   · adres ayıklama      · GET /v1/token/security  · kullanıcı kuralları  · idempotency       (route, anti-MEV,
                         · mint doğrulama      · GET /v1/token/info      · bütçe/limit          · POST /v1/trade/swap  TP/SL koşulları)
                         · dedupe/cooldown     · GET /v1/token/pool_info · manuel onay / oto    · GET /v1/trade/query_order
                                                                                                      │
                                                                                                      ▼
Web Panel (Next.js) ◄── Socket.IO ◄── Pozisyon Yöneticisi ◄───────────────────────────────────── emir sonucu
  · canlı sinyal akışı                 · durum takibi (pending→confirmed)
  · onay bekleyenler                   · fiyat/PnL gösterimi
  · pozisyonlar / geçmiş               · TP/SL = GMGN condition_orders (sunucu tarafı)
  · kurallar / ayarlar                 · acil durum: tümünü sat / kill switch
                         │
                         ▼
              PostgreSQL (yerel) — tüm olaylar, emirler, denetim kaydı
```

## 4. GMGN API analizi

### 4.1 Hangi API'yi kullanıyoruz?

| Seçenek | Durum | Karar |
|---|---|---|
| **GMGN OpenAPI** (`https://openapi.gmgn.ai`) | Resmi, belgelenmiş, API anahtarı + istek imzası | ✅ **Kullanılacak** |
| Eski router (`gmgn.ai/defi/router/v1/sol/tx/get_swap_route`, `submit_signed_transaction`) | Eski "cooperation" dokümanı; anahtarsız, yerel imzalı işlem | ❌ Güncelliği belirsiz, yeni sisteme taşınmış |
| gmgn.ai web sitesinin iç uç noktalarını kazımak | Cloudflare korumalı, belgelenmemiş, GMGN'in kendi reposu "web uç noktalarını doğrudan çağırmayın" diyor | ❌ Kullanılmayacak |

### 4.2 Kimlik doğrulama (resmi istemci kodundan çıkarıldı)

1. Yerelde Ed25519 anahtar çifti üretilir (`openssl genpkey -algorithm ed25519`).
2. Açık anahtar https://gmgn.ai/ai adresine yüklenir → **API Key** alınır (hesap başına en fazla 3 anahtar; salt-okunur ya da işlem yetkili).
3. Her istekte query'ye eklenir:
   - `timestamp` = Unix saniye (**sunucu ±5 sn tolerans** → Windows saat senkronu şart)
   - `client_id` = rastgele UUID (**7 sn içinde tekrar reddedilir** → replay koruması)
4. Header: `X-APIKEY: <api_key>`
5. İşlem/emir uç noktalarında ayrıca `X-Signature` gerekir:
   - İmzalanan metin: `{path}:{alfabetik_sıralı_query}:{body}:{timestamp}`
   - Ed25519 ile ham baytlar imzalanır, sonuç base64.
6. **Sadece IPv4** desteklenir (IPv6 → 401/403). Node'da IPv4 zorlanmalı.

Not: Bu imza anahtarı **cüzdan özel anahtarı değildir**; sadece API'ye kimlik kanıtlar. İşlem yapılan cüzdan (`from_address`) API anahtarına **bağlı** olmak zorunda.

```ts
// Ana fikir — resmi gmgn-cli/signer.ts ile aynı mantık
const ts = Math.floor(Date.now() / 1000);
const query = { ...params, timestamp: ts, client_id: crypto.randomUUID() };
const qs = Object.keys(query).sort()
  .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`).join("&");
const message = `${path}:${qs}:${bodyJson}:${ts}`;
const signature = crypto.sign(null, Buffer.from(message), privateKeyPem).toString("base64");
// headers: { "X-APIKEY": apiKey, "X-Signature": signature, "Content-Type": "application/json" }
```

### 4.3 MVP'de kullanılacak uç noktalar

| Amaç | Metot + yol | Auth | Ağırlık* |
|---|---|---|---|
| Token bilgisi (fiyat, mcap, likidite, dev, top10) | `GET /v1/token/info?chain=sol&address=` | Key | — |
| Güvenlik (mint/freeze renounce, vergi, rug_ratio) | `GET /v1/token/security?chain=sol&address=` | Key | 1 |
| Havuz bilgisi | `GET /v1/token/pool_info?chain=sol&address=` | Key | — |
| Teklif (dry-run / kağıt işlem) | `GET /v1/trade/quote` | Key + imza | 10 |
| **Al / Sat** | `POST /v1/trade/swap` | Key + imza | 10 |
| **Emir durumu** | `GET /v1/trade/query_order?order_id=&chain=` | Key + imza | 5 |
| TP/SL stratejileri listele / iptal | `GET /v1/trade/strategy/orders`, `POST /v1/trade/strategy/cancel` | Key + imza | 1 / 2 |
| Cüzdan bakiyeleri | `GET /v1/user/wallet_holdings` | Key + imza | — |
| Bağlı cüzdanlar / hesap | `GET /v1/user/info` | Key | — |
| Gas / fee önerisi | `GET /v1/trade/gas_price?chain=sol` | Key | 1 |

\* Rate-limit ağırlığı (leaky bucket). Plan kapasiteleri: Free 5/5, Plus 20/20, Pro 50/50. 429 → `RATE_LIMIT_EXCEEDED` / `RATE_LIMIT_BANNED` (+`reset_at`, en fazla 5 dk ban).

### 4.4 Swap isteği (alım örneği)

```json
POST /v1/trade/swap
{
  "chain": "sol",
  "from_address": "<API key'e bağlı cüzdan>",
  "input_token":  "So11111111111111111111111111111111111111112",
  "output_token": "<mint adresi>",
  "input_amount": "100000000",          // 0.1 SOL (lamport cinsinden!)
  "slippage": 20,                        // ya da "auto_slippage": true
  "is_anti_mev": true,
  "priority_fee": "0.0005",
  "tip_fee": "0.001",
  "condition_orders": [
    {"order_type": "profit_stop", "side": "sell", "price_scale": "100", "sell_ratio": "50"},
    {"order_type": "profit_stop", "side": "sell", "price_scale": "300", "sell_ratio": "100"},
    {"order_type": "loss_stop",   "side": "sell", "price_scale": "40",  "sell_ratio": "100"}
  ],
  "sell_ratio_type": "hold_amount"
}
```

- **Satış:** `input_token` = mint, `output_token` = SOL; yüzde satış için `input_amount_bps` (örn. `"5000"` = %50).
- **TP/SL:** `condition_orders` ile alımla birlikte GMGN tarafında kurulur → bilgisayar kapansa bile çalışır. Türler: `profit_stop`, `loss_stop`, `profit_stop_trace` (trailing), `loss_stop_trace`. En fazla 10 alt emir.
- **Yanıt:** `order_id`, `hash`, `status`. Durum akışı: `pending → processed → confirmed` ya da `failed / expired`. `confirmed` görülmeden "başarılı" denmez.
- **Miktarlar her zaman en küçük birimde** (SOL = 10⁹ lamport). Arayüz insan-okur değer alır, motor dönüştürür.

### 4.5 Kritik çıkarımlar

1. **Cüzdan modeli:** GMGN dokümanı "GMGN hosted wallet" mimarisinden bahsediyor; işlem cüzdanı API anahtarına bağlı. Yani bizim uygulamamız **hiçbir Solana özel anahtarı tutmaz** → büyük güvenlik kazancı. Karşılığında fonlar GMGN'in barındırdığı cüzdanda durur (saklama riski GMGN'de). → *Faz 0'da doğrulanacak.*
2. **Rate limit tasarımı belirler:** Swap ağırlığı 10, Free planın kapasitesi 5. Free planda swap'ın hiç çalışmayabileceği ihtimali var → *Plus/Pro gerekliliği Faz 0'da test edilecek.* Tüm GMGN çağrıları **tek bir öncelikli kuyruktan** geçecek: `işlem > emir durumu > güvenlik > fiyat`.
3. **Solana'da honeypot alanı yok** (`is_honeypot` yalnızca BSC/Base). SOL'da güvenlik = mint/freeze renounce + rug_ratio + holder dağılımı + dev davranışı + likidite.
4. **Token metadata'sı güvenilmez veri:** İsim, sembol, açıklama tamamen saldırgan kontrolünde. Panelde sadece metin olarak gösterilir, HTML olarak işlenmez.
5. **Ücret:** Üçüncü taraf kaynaklar işlem başına %1 diyor; resmi tarife doğrulanmadı.

## 5. Erişim ve çoklu kullanıcı modeli

**Kural: Uygulamaya sahip olmayan dışarıdan biri giriş yapamaz.**

| Katman | Uygulama |
|---|---|
| Ağ | Sunucular **yalnızca `127.0.0.1`'e** bağlanır. Dış ağdan port bile görünmez. Windows Güvenlik Duvarı'nda gelen bağlantı kuralı yok. |
| Kayıt | **Açık kayıt yok.** İlk kurulumda CLI ile admin oluşturulur; diğer kullanıcıları sadece admin panelden ekler. |
| Giriş | Kullanıcı adı + parola (argon2id), HttpOnly + SameSite=Strict oturum çerezi, 5 hatalı denemede geçici kilit. |
| Roller | `admin` (kullanıcı ve sistem ayarları) · `trader` (kendi kaynakları, kuralları, işlemleri) |
| Veri ayrımı | Her kayıt `user_id` taşır; her sorgu kullanıcıya göre filtrelenir. Kullanıcı başkasının sinyalini, pozisyonunu, anahtarını göremez. |
| Sırlar | GMGN API key + imza anahtarı, Telegram oturumu → DB'de **AES-256-GCM** ile şifreli. Ana anahtar `.env`'de değil, Windows DPAPI ile korunan dosyada (ya da açılışta girilen ana parola). |
| Her kullanıcının kendi hesapları | Her trader **kendi GMGN API anahtarını** ve **kendi Telegram hesabını** bağlar. Böylece rate limit, cüzdan ve sorumluluk kullanıcıya ait olur. |

İleride aynı yerel ağdaki başka bir bilgisayardan erişim istenirse: LAN IP'ye bağlanma + IP beyaz liste + HTTPS (self-signed) eklenir. MVP'de yok.

## 6. Teknoloji yığını (sade tutuldu)

| Parça | Seçim | Neden |
|---|---|---|
| Dil | **TypeScript** (Node.js 22 LTS) | GMGN'in resmi istemcisi TS; tek dil = tek bakım |
| Motor (backend) | Fastify + Socket.IO | Uzun süre çalışan worker'lar (userbot, takip) için ayrı süreç |
| Panel | Next.js 15 (App Router) + Tailwind | Orijinal ağaçla uyumlu |
| Veritabanı | **PostgreSQL 16** (Windows yerel kurulum) + Prisma | Panel ve motorun eşzamanlı yazması için sağlam; yedeklemesi kolay |
| Telegram | GramJS (`telegram` npm) — userbot | MTProto ile kullanıcı hesabı olarak kanal dinleme |
| Süreç yönetimi | PM2 (Windows servisi olarak) | Bilgisayar açılınca otomatik başlar, çökünce yeniden başlar |
| Kuyruk | Uygulama içi (p-queue + token bucket) | MVP'de Redis gereksiz karmaşıklık |

Proje yapısı:

```
memebot/
├─ apps/
│  ├─ engine/        # Fastify API + Socket.IO + worker'lar
│  │  ├─ sources/    # telegram.ts (Faz 2: twitter.ts)
│  │  ├─ signal/     # extract.ts, dedupe.ts
│  │  ├─ safety/     # checks.ts, scoring.ts
│  │  ├─ decision/   # rules.ts, limits.ts
│  │  ├─ trade/      # gmgnClient.ts, signer.ts, orders.ts, queue.ts
│  │  └─ positions/  # tracker.ts, pnl.ts
│  └─ web/           # Next.js panel
├─ packages/
│  ├─ db/            # Prisma şema + migration
│  └─ shared/        # tipler, sabitler (SOL/USDC mint adresleri)
└─ scripts/          # create-admin, backup, keygen
```

## 7. Modüllerin MVP davranışı

### 7.1 Sinyal Motoru
- **Girdi:** Kullanıcının seçtiği Telegram kanal/grupları (her mesaj + düzenlenen mesaj).
- **Adres ayıklama:** Base58 32–44 karakter regex + bilinen link kalıpları (`pump.fun/…`, `gmgn.ai/sol/token/…`, `dexscreener.com/solana/…`, `birdeye.so/token/…`).
- **Eleme:** SOL/USDC/USDT gibi bilinen mint'ler, kullanıcı kara listesi, cüzdan adresi olanlar (token/info boş dönenler).
- **Dedupe:** `(user_id, mint)` için ilk görülme kaydı; ayarlanabilir cooldown (vars. 30 dk). Aynı mint farklı kanalda tekrar gelirse yeni işlem değil, **"çağrı sayısı +1"** olarak işlenir (bu da bir sinyal gücü).
- **Kayıt:** Ham mesaj, kanal, zaman damgası (Telegram zamanı + alınma zamanı → gecikme ölçümü).

### 7.2 Güvenlik Kontrolü (kullanıcı başına ayarlanabilir eşikler)

| Kontrol | Kaynak alan | Varsayılan |
|---|---|---|
| Mint yetkisi bırakılmış | `renounced_mint` | `true` zorunlu |
| Freeze yetkisi bırakılmış | `renounced_freeze_account` | `true` zorunlu |
| Rug riski | `rug_ratio` | `< 0.3` |
| Top 10 holder oranı | `stat.top_10_holder_rate` | `< 0.35` |
| Dev ekip payı | `stat.dev_team_hold_rate` | `< 0.10` |
| Dev seri token çıkarıcı mı | `dev.creator_open_count` | `< 20` |
| Alım/satım vergisi | `buy_tax` / `sell_tax` | `0` |
| Likidite / mcap | `token/info`, `pool_info` | min. likidite ayarlanır |

Sonuç: `GEÇTİ / UYARI / RED` + hangi kuralın neden düştüğü panelde görünür.

### 7.3 Karar Motoru
- **Mod (kural bazında):** `sadece_izle` → `manuel_onay` (varsayılan) → `otomatik`.
- **Sert limitler (otomatik modda bile aşılamaz):** işlem başına max SOL, günlük max harcama, aynı anda max açık pozisyon, aynı token'a tek giriş, günlük max zarar → aşılınca otomatik mod kendini kapatır.
- **Kill switch:** Panelde tek tuş → tüm otomatik alımlar durur.

### 7.4 İşlem Motoru
- Her emir: `idempotency_key` (kullanıcı + mint + karar id) → aynı karar iki kez emir üretemez.
- Akış: emir DB'ye `created` → GMGN `swap` → `submitted (order_id)` → `query_order` ile 2–5 sn aralıkla takip → `confirmed / failed / expired`.
- **Dry-run modu:** `swap` yerine `quote` çağrılır, sonuç "kağıt pozisyon" olarak açılır. MVP'nin ilk haftalarında gerçek para olmadan uçtan uca test için.
- Hata yönetimi: 429 → `reset_at`'e kadar bekle; 5xx → üstel geri çekilme (max 3); `failed` → panelde hata kodu ile gösterilir, **otomatik tekrar alım yapılmaz.**

### 7.5 Pozisyon Yöneticisi
- TP/SL **GMGN `condition_orders`** ile kurulur (sunucu tarafı, bilgisayar kapalıyken de çalışır).
- Yerel taraf: açık pozisyonların fiyatı 10–15 sn aralıkla (rate limit bütçesine göre) çekilir → PnL hesaplanır → Socket.IO ile panele basılır.
- Manuel aksiyonlar: %25 / %50 / %100 sat, TP/SL düzenle (strategy cancel + yeniden kur).
- **Acil durum:** "Tümünü sat" butonu.

### 7.6 Web Panel (MVP ekranları)

| Ekran | İçerik | Kabul ölçütü |
|---|---|---|
| Giriş | Kullanıcı adı / parola | Kayıt linki yok; dış ağdan erişilemez |
| Canlı Akış | Sinyal kartları: kanal, mint, güvenlik sonucu, çağrı sayısı, gecikme | Aynı mint tekrar kart açmaz, sayaç artar |
| Onay Bekleyenler | Güvenlikten geçen + manuel mod sinyaller; "Al 0.1 / 0.5 / 1 SOL" | Çift tıklama tek emir üretir |
| Pozisyonlar | Giriş fiyatı, anlık fiyat, PnL, TP/SL durumu, sat butonları | Durum `confirmed` olmadan pozisyon "açık" görünmez |
| Geçmiş | Emir id, hash (Solscan linki), durum, hata kodu | Kabul / gönderim / zincir sonucu ayrı |
| Kurallar | Kaynak kanallar, güvenlik eşikleri, mod, limitler, TP/SL şablonu | Kaydedilen kural anında motora yansır |
| Bağlantılar | GMGN API durumu, Telegram oturumu, saat sapması, rate-limit doluluğu | Kesinti sessizce gizlenmez |
| Admin | Kullanıcı ekle / kilitle / sil, sistem logları | Sadece admin görür |

## 8. Veritabanı şeması (MVP tabloları)

```
users                 id, username, password_hash, role, is_locked, created_at
sessions              id, user_id, expires_at, ip, user_agent
credentials           id, user_id, kind(gmgn|telegram), enc_payload, iv, tag, created_at
wallets               id, user_id, address, label, is_default        -- GMGN'e bağlı cüzdanlar
sources               id, user_id, type(telegram), chat_id, title, is_active
signals               id, user_id, source_id, raw_text, msg_ts, received_at, mint
tokens                mint(PK), symbol, name, first_seen_at
signal_hits           user_id, mint, first_seen_at, hit_count, last_seen_at   -- dedupe
safety_checks         id, mint, result(pass|warn|fail), reasons(json), raw(json), checked_at
rules                 id, user_id, mode, thresholds(json), limits(json), tp_sl_template(json)
orders                id, user_id, idempotency_key(UNIQUE), side, mint, amount_in,
                      status, gmgn_order_id, tx_hash, error_code, request(json), report(json),
                      is_dry_run, created_at, updated_at
positions             id, user_id, mint, entry_price, amount, status(open|closed), pnl, opened_at, closed_at
audit_log             id, user_id, action, detail(json), created_at
```

## 9. Plan program (fazlar)

Süreler tek geliştirici için tahmini iş günüdür.

| Faz | Süre | Kapsam | Bitti sayılır… |
|---|---|---|---|
| **0 — Doğrulama** | 2–3 gün | GMGN hesabı + API key, bir script ile `token/info`, `security`, `quote`, **küçük tutarlı gerçek `swap`** (0.01 SOL), `query_order`, `condition_orders`. Hosted wallet ve plan/rate-limit gerçeği netleşir. | Bir alım-satım döngüsü script ile uçtan uca başarılı; açık sorular (§10) cevaplı |
| **1 — İskelet** | 4–5 gün | Monorepo, PostgreSQL + Prisma şema, engine + web iskeleti, yerel giriş, admin CLI, roller, sır şifreleme, 127.0.0.1 bağlama, PM2 | Admin giriş yapar, kullanıcı ekler; başka makineden erişim yok |
| **2 — Sinyal** | 4–5 gün | GramJS userbot bağlama (panelden), kanal seçimi, adres ayıklama, dedupe, canlı akış (Socket.IO) | Seçili kanalda paylaşılan CA 1 sn içinde panelde, tekrarlar sayaç olarak |
| **3 — Güvenlik + Karar** | 3–4 gün | GMGN güvenlik çağrıları, eşik ayarları, puanlama, rate-limit kuyruğu, manuel onay ekranı | Her sinyal GEÇTİ/UYARI/RED ve nedenleriyle görünür |
| **4 — İşlem (dry-run → gerçek)** | 5–6 gün | GMGN istemcisi + imza, idempotency, emir takibi, dry-run modu, gerçek mod, TP/SL şablonu | Dry-run'da 1 hafta sorunsuz; sonra küçük tutarla gerçek işlem |
| **5 — Pozisyon + Otomatik mod** | 4–5 gün | Pozisyon ekranı, PnL, manuel satışlar, tümünü sat, otomatik mod + sert limitler + kill switch, geçmiş | Otomatik mod limit aşınca kendini kapatır; tüm olaylar audit_log'da |
| **MVP toplam** | **~4–5 hafta** | | |
| Faz 6 (MVP sonrası) | — | X/Twitter kaynağı, LAN erişimi, Telegram bildirim botu, çoklu cüzdan (`multi_swap`), backtest/istatistik, BSC/Base | — |

**X/Twitter neden Faz 2'de değil:** Resmi X API'nin gerçek zamanlı okuma planları pahalı; MVP'yi tek kaynakla (Telegram) doğrulamak J7Tracker analizindeki önerinin de kendisi.

## 10. Faz 0'da cevaplanması gereken açık sorular

1. GMGN işlem cüzdanı tamamen GMGN tarafından mı barındırılıyor? Para yatırma/çekme nasıl? (Saklama riski kabul edilebilir mi?)
2. Free planda `swap` çalışıyor mu, yoksa Plus/Pro mu gerekiyor? Planların ücreti?
3. GMGN'in işlem başı ücreti nedir (%1 iddiası doğru mu)?
4. Bir cüzdan birden fazla API anahtarına bağlanabilir mi? (Çok kullanıcı modeli buna göre netleşir.)
5. `condition_orders` alımla birlikte kurulduğunda, manuel satışta otomatik iptal oluyor mu?
6. IP beyaz liste özelliği nasıl yapılandırılıyor? (Ev internetinde IP değişirse ne olur?)

## 11. Riskler

| Risk | Önlem |
|---|---|
| Para kaybı (meme coin doğası, rug) | Varsayılan manuel onay, sert limitler, dry-run haftası, küçük tutarla başlama |
| GMGN'e bağımlılık (API değişir/kapanır) | Tüm GMGN çağrıları tek `gmgnClient` modülünde; ileride Jupiter adaptörü eklenebilir |
| Telegram userbot hesabının kısıtlanması | Ana hesap değil ayrı bir hesap kullanılması; sadece okuma, mesaj gönderme yok |
| Saat kayması (±5 sn) → tüm istekler reddedilir | Açılışta saat sapması kontrolü, panelde uyarı |
| Sırların sızması | Şifreli saklama, log maskeleme, sadece localhost, `.env` dosyalarına sır yazmama |
| Rate limit ban (5 dk'ya kadar) | Merkezi öncelikli kuyruk, işlemler her zaman önce |

## Kaynaklar

- GMGN OpenAPI istemci kaynak kodu — [GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills) (`src/client/OpenApiClient.ts`, `src/client/signer.ts`, `src/config.ts`)
- Swap parametreleri ve emir durumları — [gmgn-swap/SKILL.md](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-swap/SKILL.md)
- Token güvenlik alanları — [gmgn-token/SKILL.md](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md)
- [GMGN Agent API dokümanı](https://docs.gmgn.ai/index/gmgn-agent-api)
- Eski router API — [GMGN Cooperation API](https://gmgnai.gitbook.io/index/cooperation-api-integrate-gmgn-solana-trading-api)
- J7Tracker analiz dokümanı (kullanıcı tarafından sağlandı)
