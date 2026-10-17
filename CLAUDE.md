# MemeBot — Claude için proje notları

Bu projeye yeni başlıyorsan **önce `docs/HANDOFF.md`'yi oku** (tam devir dokümanı), sonra `docs/V2-PLAN.md` ve `docs/KURULUM-V2.md`.

## Kısa kurallar

- Kullanıcıyla **Türkçe** konuş; UI metinleri ve kod yorumları Türkçe.
- **Tasarım (J7 tarzı):** kompakt koyu tema; ortalanmış üst menü, alt durum çubuğu (Ücret popover'ı orada), ikonlu sol menülü Ayarlar. Vurgu rengi (varsayılan indigo) sadece seçili öğe/birincil buton için; anlam renkleri sabit (yeşil kâr/geçti, kırmızı zarar/red, sarı uyarı). İkonlar `lucide-react`.
- Repo **gizli** (17.10.2026'dan beri; önceden public'ti, eski kopyalar dolaşmış olabilir): yine de sır yok, commit'lenmez, loglanmaz, sohbette istenmez.
- Güncellemeler **elle** dağıtılır: repo gizli olduğu için kurulu uygulamanın otomatik güncellemesi GitHub Releases'e ulaşamaz. Yeni sürüm = `npm run dist` → `release/<sürüm>/` zip'i ekibe gönderilir. Sırlar `safeStorage` ile yerelde (v2'de motor sunucusunda şifreli).
- Mimari: iş yapan her şey **motorda** (`src/engine`, Electron'a bağımlı değil). Arayüz sadece Supabase'e niyet/komut yazar.
- Para güvenliği sözleşmeleri:
  - emirlerde `idempotency_key`,
  - durum geçişleri koşullu güncelleme (`.eq('status', eski)`),
  - `confirmed` görülmeden pozisyon yok,
  - başarısız alım-satım otomatik tekrar denenmez,
  - kill switch alımı durdurur, satış serbest,
  - 5 SOL/emir mutlak sınır.
- Sırlar arayüzden motora sadece mühürlü zarfla (`runSealed`) gider; motor kasasında saklanır.
- Kapsam dışı: bundle/sniper, vamp, multi deploy, tarayıcı eklentisi.
- Hesap güvenliği: 2FA (Supabase TOTP) açıkken `my_role()` yalnız aal2 oturuma rol verir; böylece parola tek başına veriye yetmez. Üye 2FA sıfırlama `manage-users` edge function'ının `reset-mfa` eylemidir (yeniden `npx supabase functions deploy manage-users` gerekir). Yayında Supabase → Authentication → MFA'da TOTP açık olmalı.
- Supabase migration'larını kullanıcı SQL Editor'dan kendisi çalıştırır. Yeni migration → kullanıcıya söyle → "çalıştırdım" dedikten sonra yayın.
- Push ve release kullanıcı onayıyla yapılır. Akış: `npm version 0.1.X --no-git-tag-version` → commit → `git tag -a v0.1.X` → push main + etiket → Actions → release'i doğrula (tek kayıt, 3 dosya).
- Commit mesajları Türkçe, sonunda `Co-Authored-By` satırı.

## Komutlar

```bash
npm install        # postinstall Electron ikilisini indirir (web derlemesinde atlanır)
npm run dev        # geliştirme (kurulu MemeBot açıksa tek-örnek kilidi yüzünden kapanır)
npm run build      # typecheck + build — her değişiklikten sonra temiz olmalı
npm run build:web  # web sitesi (dist-web/)
npm test           # birim + entegrasyon (yerel Supabase gerekir: npx supabase start; yoksa atlanır)
npm run dist       # yerelde Windows kurulum dosyası (release/<sürüm>/)
npx tsx --env-file=<yerel ayar> scripts/dev-engine.mts   # sahte GMGN'li geliştirme motoru (sadece yerel Supabase)
```
