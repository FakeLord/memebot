# MemeBot

Telegram sinyallerinden gelen Solana token adreslerini GMGN üzerinden kontrol edip alım-satım yapan masaüstü uygulaması (Windows).

- **Veritabanı ve giriş:** Supabase (birden fazla bilgisayardan aynı hesap)
- **Roller:** Founder · Developer · Asistan
- **Alım-satım:** GMGN OpenAPI (`openapi.gmgn.ai`)
- **Güncellemeler:** GitHub Releases → uygulama kendisi indirir

Plan ve mimari: [docs/MVP-PLAN.md](docs/MVP-PLAN.md)

## Roller

| Yetki | Founder | Developer | Asistan |
|---|:-:|:-:|:-:|
| Canlı akış, token kontrol | ✓ | ✓ | ✓ |
| Kendi sinyal kaynaklarını yönetme | ✓ | ✓ | ✓ |
| Kural, emir, pozisyon yazma (işlem) | ✓ | ✓ | — |
| Herkesin verisini görme | ✓ | — | — |
| Kullanıcı ekleme / rol değiştirme | ✓ | — | — |
| Tüm işlemleri durdurma (kill switch) | ✓ | — | — |

Kurallar veritabanında (RLS) uygulanır; arayüzü değiştirmek yetki kazandırmaz.

## Dışarıdan giriş neden mümkün değil

1. Supabase'de **açık kayıt kapalı** (aşağıdaki kurulum adımı 3).
2. Uygulamada kayıt ekranı yok; hesapları sadece founder oluşturur.
3. Bir şekilde oluşan hesap varsayılan olarak **pasif** açılır ve hiçbir veriyi göremez.
4. Kod public olsa da sırlar repoda değildir: GMGN anahtarları her bilgisayarda Windows tarafından şifrelenir, `service_role` anahtarı sadece Supabase Edge Function'da durur.

## Kurulum (bir kez)

1. **Supabase projesi** oluşturun → https://supabase.com
2. **Şema:** SQL Editor'da `supabase/migrations/20261016000000_init.sql` dosyasını çalıştırın
   (ya da `npx supabase link` + `npx supabase db push`).
3. **Açık kaydı kapatın:** Authentication → Sign In / Providers → *Allow new users to sign up* → **kapalı**.
4. **Kullanıcı yönetim fonksiyonu:** `npx supabase functions deploy manage-users`
5. **Kendinizi founder yapın:** Authentication → Users → *Add user* ile hesabınızı açın, sonra
   `supabase/bootstrap-founder.sql` dosyasındaki e-postayı değiştirip SQL Editor'da çalıştırın.
6. **Yerel ayar:** `.env.example` → `.env` olarak kopyalayın, Supabase URL ve anon anahtarı girin.

## Telegram bağlantısı

1. https://my.telegram.org → **API development tools** → bir uygulama oluşturup **API ID** ve **API Hash** alın.
2. Uygulamada **Kaynaklar** ekranında API ID, API Hash ve telefon numarasını girin, gelen kodu doğrulayın.
3. **Kanal ekle** ile izlemek istediğiniz kanal/grupları seçin.

Uygulama hesabınızla sadece okur, mesaj göndermez. Ana hesap yerine ayrı bir Telegram hesabı önerilir.
Oturum her bilgisayarda ayrı ve şifreli saklanır; aynı mesaj iki bilgisayarda yakalansa da bir kez sayılır.

## X / Twitter bağlantısı (XFlux)

1. https://www.xfluxapi.com adresinde hesap açın, API anahtarını (`xflux_...`) alın.
2. XFlux paneli → **Monitors**: izlemek istediğiniz her hesap için izleyici kurun.
   Ücretsiz plan 5 dk'da bir kontrol eder; token yakalamak için Starter ve üstü (1 sn) gerekir.
3. Uygulamada **Kaynaklar → X / Twitter**: anahtarı girin, listelenen izleyicilerde **İzle**'ye basın.

Uygulama kalan aylık kotaya göre yoklama hızını ayarlar. Aynı kullanıcı birden fazla bilgisayarda
açıksa sadece biri yoklar. Anahtar her bilgisayarda ayrı ve şifreli saklanır.

## Geliştirme

```bash
npm install
npm run dev
```

## Yeni sürüm yayınlama

1. `package.json` → `version` alanını artırın.
2. Etiketleyip gönderin:

```bash
git commit -am "v0.1.1" && git tag v0.1.1 && git push --follow-tags
```

GitHub Actions kurulum dosyasını derleyip Releases'e yükler. İlk seferde repo ayarlarına
(Settings → Secrets and variables → Actions → **Variables**) `VITE_SUPABASE_URL` ve
`VITE_SUPABASE_ANON_KEY` ekleyin.

## GMGN anahtarı

1. Ed25519 anahtar çifti üretin:

```bash
openssl genpkey -algorithm ed25519 -out gmgn.pem && openssl pkey -in gmgn.pem -pubout
```

2. Açık anahtarı https://gmgn.ai/ai adresine yükleyip API Key alın.
3. Uygulamada **Ayarlar → GMGN API** bölümüne API Key ve `gmgn.pem` içeriğini girin.
   `gmgn.pem` dosyasını sonra güvenli bir yere taşıyın; repo klasöründe bırakmayın.

## Durum

- [x] Supabase şeması, roller, RLS
- [x] Giriş, kullanıcı yönetimi, kill switch
- [x] GMGN istemcisi (imzalı istekler), token güvenlik kontrolü
- [x] GitHub Releases ile otomatik güncelleme
- [x] Telegram dinleyici (Faz 2) — migration: `supabase/migrations/20261016120000_signals.sql`
- [x] Otomatik güvenlik kontrolü + kurallar + manuel onay (Faz 3) — migration: `supabase/migrations/20261016150000_candidates.sql`
- [x] Alım-satım: deneme modu + gerçek mod, TP/SL, limitler, Emirler ekranı (Faz 4) — migration: `supabase/migrations/20261016180000_trading.sql`
- [x] Canlı fiyat/PnL, GMGN TP/SL eşitleme, Tümünü sat, otomatik mod (Faz 5) — migration: `supabase/migrations/20261016210000_positions_auto.sql`
