# MemeBot v2 — Kurulum (senin yapacakların)

Bu adımlar bir kez yapılır. Sırayla git; her adımın sonunda neyi görmen gerektiği yazıyor.

> Sırlar (service_role, GMGN, XFlux, Telegram) **hiçbir yere** yapıştırılmaz: ne sohbete ne GitHub'a. Sadece aşağıda söylenen ekranlara girilir.

---

## 1. Veritabanı (Supabase → SQL Editor)

Aşağıdaki dosyaları **bu sırayla** SQL Editor'da çalıştır. Her birinde dosyanın tamamını kopyala, yapıştır, **Run**.

1. `supabase/migrations/20261017000000_engine.sql` — motor tabloları, emir/pozisyon yazma yetkisi motora geçer
2. `supabase/migrations/20261018000000_feed.sql` — canlı akış kartları
3. `supabase/migrations/20261019000000_settings.sql` — anahtar kelimeler, ücret preset'leri, tema, ortak havuz
4. `supabase/migrations/20261020000000_deploys.sql` — deploy kayıtları
5. `supabase/migrations/20261021000000_wallets.sql` — cüzdan etiketleri

**Görmen gereken:** her birinde "Success. No rows returned".

> ⚠️ 1. dosyadan sonra eski uygulama (0.1.x) alım-satım yapamaz ve "Güncelleme gerekli" der. Bu beklenen durum. Yeni sürüm (0.2.0) GitHub'dan otomatik iner.

---

## 2. Motoru bu bilgisayarda başlat (VPS'e geçene kadar)

1. Yeni sürümü (0.2.0) kurduktan sonra MemeBot'u aç, founder hesabınla gir.
2. **Ayarlar → GMGN ve motor → Bu bilgisayarda motor** bölümüne in.
3. Supabase → **Project Settings → API Keys** → **service_role** (ya da "secret") anahtarını kopyala, bu alana yapıştır, **Kaydet**.
4. **"Motor bu bilgisayarda çalışsın"** kutusunu işaretle.

**Görmen gereken:** birkaç saniye içinde üst çubukta **"Motor çalışıyor"** (yeşil). "Motor günlüğünü göster" ile ayrıntıyı görebilirsin.

- Eski sürümde girdiğin GMGN / XFlux / Telegram anahtarları motora **otomatik aktarılır**; yeniden girmen gerekmez.
- Bilgisayar ya da uygulama kapanınca motor da durur (sinyal işlenmez). VPS'e geçince bu sorun kalkar.
- Sadece **bir** bilgisayarda motoru aç. İkinci bir motor açılırsa kendiliğinden bekleme moduna geçer, çift işlem olmaz.

---

## 3. Web sitesi (Chrome'dan açmak için) — Cloudflare Pages

1. https://dash.cloudflare.com → hesap aç (ücretsiz).
2. **Workers & Pages → Create → Pages → Connect to Git** → GitHub'da `FakeLord/memebot` reposunu seç.
3. Ayarlar:
   - **Production branch:** `main`
   - **Build command:** `npm run build:web`
   - **Build output directory:** `dist-web`
4. **Environment variables** (Production):
   - `VITE_SUPABASE_URL` = Supabase proje adresin (GitHub Actions'taki ile aynı)
   - `VITE_SUPABASE_ANON_KEY` = anon anahtar (GitHub Actions'taki ile aynı; gizli değil)
   - `NODE_VERSION` = `22`
5. **Save and Deploy**.

**Görmen gereken:** `https://memebot-xxx.pages.dev` gibi bir adres. Chrome'da aç, aynı hesapla gir. Her `main` push'unda site kendiliğinden güncellenir.

> Açık kayıt yine kapalı: siteyi bulan biri hesap açamaz, sadece founder'ın eklediği kullanıcılar girer.

---

## 4. Kaynaklar

- **Telegram:** Kaynaklar → API ID, API Hash, telefon → kod. Sonra "Kanal ekle" ile izlenecek kanalları seç.
- **X (ücretsiz plan):** xfluxapi.com → anahtar (`xflux_…`) → Kaynaklar → X'e yapıştır. XFlux panelinde 1 izleyici kur (ücretsiz plan 5 dk'da bir kontrol eder) → listede **İzle**.

**Görmen gereken:** Canlı Akış'ta gönderiler kart kart görünür.

---

## 5. Kontrol listesi

- [ ] 5 migration çalıştı
- [ ] Uygulama 0.2.0'a güncellendi
- [ ] "Motor çalışıyor" yeşil
- [ ] Ayarlar → GMGN: "Anahtar kayıtlı", cüzdan ★ seçili
- [ ] Web sitesi açılıyor, giriş yapılıyor
- [ ] Kurallar → Gerçek işlem **kapalı** (Faz 8'e kadar)

Gerçek parayla test (Faz 8) ve VPS'e taşıma (Faz 9) ayrı yapılacak; o zaman adım adım birlikte gideriz.
