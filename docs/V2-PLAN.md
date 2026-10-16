# MemeBot v2 — Uygulama planı

Tarih: 16 Ekim 2026 · Ayrıntılı ekran analizi: `V2-TASLAK.md`

## Kararlar (kullanıcı, 16 Ekim 2026)

| Konu | Karar |
|---|---|
| Web mimarisi | **A — MemeBot Engine** (7/24 çalışan Node servisi) |
| Motorun yeri | Proje bitene kadar **kullanıcının bilgisayarında** (masaüstü uygulaması açılınca arka planda başlar). Sonra **VPS**. Kod baştan VPS'e taşınabilir yazılır (Windows'a özgü bağımlılık yok). |
| Web sitesi | Cloudflare Pages (statik), giriş Supabase |
| X / Twitter | Şimdilik ücretli plan yok; XFlux **ücretsiz plan** (1 izleyici, 5 dk) ile temsili akış |
| AI ad/görsel önerisi | Sonraya |
| Gerçek alım-satım testi | Sonraya (Faz 8) — o zamana kadar her şey **deneme modunda** test edilir |

## Fazlar

Durum (16 Ekim 2026): **Faz 1–7 tamam** (kodlandı, test edildi, yerelde commit'lendi; yayın kullanıcı onayı bekliyor → tek sürüm **0.2.0**). Faz 8–9 kullanıcıyla.

| Faz | Kapsam | Sürüm |
|---|---|---|
| 1 Hazırlık ✅ | Plan dokümanı, Vitest, CI'da test | — |
| 2 Motor ✅ | `src/engine/`: GMGN, Telegram, XFlux, karar motoru, emir motoru, takip, otomatik mod. Komutlar Supabase (`engine_commands`), sırlar motorda şifreli (mühürlü zarf), tek motor kuralı | — |
| 3 Web + kabuk ✅ | Arayüz sadece Supabase ile konuşur; Cloudflare Pages; masaüstü = kabuk + motor sunucusu + güncelleme | 0.2.0 (hepsi tek sürüm) |
| 4 Akış v2 ✅ | `feed_items`, gönderi kartları, vurgu, öneri ızgarası (GMGN arama), kart aksiyonları, durum çubuğu | 0.2.0 |
| 5 Ayarlar v2 ✅ | Hesap havuzu + CSV, anahtar kelimeler, görünüm/temalar, kısayollar, ücret preset'leri P1–P3 | 0.2.0 |
| 6 Deploy ✅ | GMGN `create_token` formu — deneme modunda (gönderilmez) | 0.2.0 |
| 7 Cüzdanlar ✅ | Liste, etiket, varsayılan, bakiye | 0.2.0 |
| 8 Gerçek doğrulama | 0.01 SOL alım/satım, TP/SL, otomatik mod, test token'ı | — |
| 9 VPS | Sunucuya taşıma | 1.0.0 |

## Motor mimarisi (Faz 2–3)

```
Arayüz (Chrome / masaüstü)  ──yazar──►  Supabase  ◄──dinler/yazar──  MemeBot Engine (Node)
  orders (created)                      tablolar + realtime              GMGN · Telegram · XFlux
  engine_commands (pending)                                              pipeline · emirler · takip
  okur: engine_status, engine_user_state, positions, candidates…
```

- **Motorun Supabase erişimi:** `service_role` anahtarı. Bilgisayarda: masaüstü uygulamasında founder bir kez girer, Windows şifrelemesiyle saklanır. VPS'te: sunucudaki `.env`. Repoya asla girmez.
- **Sırlar (GMGN, XFlux, Telegram):** arayüz, motorun yayınladığı açık anahtarla (RSA-OAEP + AES-GCM) şifreleyip komut olarak yazar. Motor açar, kendi diskinde ana anahtarla (AES-256-GCM) şifreli saklar ve komuttaki şifreli metni siler.
- **Emirler:** arayüz sadece niyet yazar (token, tutar, aday/pozisyon). Ücret, slippage, TP/SL ve tüm limitler motorda kuraldan hesaplanır. Durumlar: `created → sending → submitted → pending/processed → confirmed | failed | expired`. Motor `sending`'de durursa emir **başarısız** işaretlenir, otomatik tekrar yok.
- **Tek motor:** `engine_claim()` ile tek etkin motor; ikinci açılan bekler.
- **Para sözleşmeleri korunur:** idempotency, koşullu durum geçişleri, `confirmed` görülmeden pozisyon yok, otomatik tekrar yok, kill switch alımı durdurur (satış serbest), 5 SOL/emir.

## Test

- `npm test` (Vitest): ortak fonksiyonlar + motor çekirdeği (sahte GMGN ve sahte veritabanı ile).
- Yerel Supabase (Docker, `supabase start`) ile migration ve RLS testleri, motorun uçtan uca deneme akışı.
