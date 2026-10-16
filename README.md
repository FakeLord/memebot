# MemeBot

Telegram ve X (Twitter) sinyallerinden gelen Solana token adreslerini GMGN üzerinden güvenlik kontrolünden geçirip
kurallara göre onaylı ya da otomatik alım-satım yapan, gönderilerden token deploy edebilen uygulama.

- **Motor (MemeBot Engine):** 7/24 çalışan tek Node süreci — GMGN, Telegram, XFlux, karar motoru, emir motoru, takip, otomatik mod, deploy.
  Şimdilik masaüstü uygulamasının içinde arka planda, sonra VPS'te.
- **Arayüz:** Masaüstü (Windows, Electron) ve web (Chrome, Cloudflare Pages) — ikisi de aynı React arayüzü, sadece Supabase ile konuşur.
- **Veritabanı ve giriş:** Supabase (RLS her tabloda). **Güncellemeler:** GitHub Releases.

Belgeler: [docs/KURULUM-V2.md](docs/KURULUM-V2.md) (kurulum adımları) · [docs/HANDOFF.md](docs/HANDOFF.md) (teknik devir) ·
[docs/V2-PLAN.md](docs/V2-PLAN.md) (plan) · [docs/V2-TASLAK.md](docs/V2-TASLAK.md) (ekran analizi)

## Mimari

```
Arayüz (Chrome / masaüstü)  ──yazar──►  Supabase  ◄──dinler/yazar──  MemeBot Engine
  emir niyeti (orders)                  tablolar + realtime             GMGN · Telegram · XFlux
  komut (engine_commands)                                               karar · emir · takip · deploy
```

- Arayüz sadece **niyet** yazar; limitler, ücretler, TP/SL ve GMGN'e gönderim motorda.
- Sırlar arayüzde motorun açık anahtarıyla şifrelenir (mühürlü zarf), sadece motor açar ve kendi kasasında saklar.
- Tek motor kuralı: aynı anda tek etkin motor (`engine_claim`).

## Roller

| Yetki | Founder | Developer | Asistan |
|---|:-:|:-:|:-:|
| Canlı akış, token kontrol | ✓ | ✓ | ✓ |
| Kendi kaynakları, anahtar kelimeler, tema | ✓ | ✓ | ✓ |
| Kural, emir, deploy, ücret preset'i (işlem) | ✓ | ✓ | — |
| Herkesin verisini görme, ortak hesap havuzu | ✓ | — | — |
| Kullanıcı yönetimi, kill switch | ✓ | — | — |

## Para güvenliği

- Her emir benzersiz `idempotency_key`; durum geçişleri koşullu güncelleme
- GMGN'de `confirmed` görülmeden pozisyon yok; başarısız işlem otomatik tekrar denenmez
- Kill switch alımı ve deploy'u durdurur, satış serbest; emir başına 5 SOL mutlak sınır
- **Deneme modu** (varsayılan): alımlar GMGN teklifiyle simüle edilir, deploy isteği sadece hazırlanır — para harcanmaz

## Geliştirme

```bash
npm install          # postinstall Electron ikilisini indirir
npm run dev          # masaüstü (kurulu MemeBot açıksa tek-örnek kilidi yüzünden kapanır)
npm run dev:web      # web arayüzü
npm run build        # typecheck + masaüstü derlemesi (out/, motor: out/main/engine.js)
npm run build:web    # web sitesi (dist-web/)
npm test             # birim + entegrasyon testleri
npm run dist         # Windows kurulum dosyası (release/<sürüm>/)
npm run engine       # motoru düz Node ile çalıştır (.env.engine, bkz. .env.engine.example)
```

**Entegrasyon testleri** yerel Supabase ister (Docker): `npx supabase start`. Testler gerçek motoru yerel veritabanına karşı
sahte GMGN ile çalıştırır; gerçek projeye ve paraya dokunmaz. Yerel Supabase yoksa kendiliğinden atlanır.

**Arayüzü uçtan uca denemek:** `npx supabase start` → `npx tsx --env-file=<yerel ayar> scripts/dev-engine.mts` (sahte GMGN,
örnek gönderiler) → `npm run dev:web` (yerel `VITE_SUPABASE_*` ile).

## Yayın

`npm version 0.X.Y --no-git-tag-version` → commit → `git tag -a v0.X.Y` → push `main` + etiket → GitHub Actions derleyip yayınlar.
Web sitesi `main`'e her push'ta Cloudflare Pages tarafından güncellenir.
