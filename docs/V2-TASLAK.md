# MemeBot v2 — J7Tracker ekranlarından türetilen taslak

Tarih: 16 Ekim 2026 · Kaynak: kullanıcının paylaştığı 13 ekran görüntüsü (J7Tracker tanıtım videosu)
Durum: **taslak — karar bekleyen maddeler §8'de**

---

## 1. Kısa sonuç

J7Tracker bir **"haberi gör → token çıkar / al"** aracı. Ekranların çoğu üç şeye hizmet ediyor:

1. **Canlı akış:** binlerce sosyal hesabın gönderisi kart kart akıyor; her kartın altında konuyla eşleşen token önerileri ve tek tık "Deploy" var.
2. **Deploy:** gönderiden ad, sembol ve görsel önerip pump.fun benzeri platformlarda saniyeler içinde token çıkarıyor.
3. **Ayarlar:** takip listesi, anahtar kelime vurgusu, tema, ücret preset'leri, cüzdanlar, kısayollar.

MemeBot bugün daha çok **alım-satım** tarafında: sinyal, güvenlik, onay, alım, TP/SL. v2 ile akış ve deploy tarafını ekleyip ikisini birleştiriyoruz. Gerekenlerin büyük kısmı GMGN API'sinde zaten var:

| İhtiyaç | GMGN uç noktası |
|---|---|
| Token çıkarma | `POST /v1/cooking/create_token` |
| Konuya göre token önerisi | `GET /v1/market/search` |

**İki önemli not:**

- **Web erişimi bir mimari kararı gerektiriyor (§5).** Uygulamayı Chrome'da da açmak için bugün masaüstünde çalışan "motor"un (GMGN, Telegram, X dinleyicileri) bir sunucuya taşınması gerekiyor.
- **1.500 hesabı canlı izlemek pahalı (§6).** J7'nin kendi veri altyapısı var. Bizim XFlux ile bu ölçek ayda yüzlerce dolar tutar. Kapsamı birlikte belirlememiz gerekiyor.

---

## 2. Ekran ekran analiz

### 2.1 Ana akış (ekran 1)

| Öğe | J7'de ne yapıyor | MemeBot karşılığı | Kaynak |
|---|---|---|---|
| Üst araç çubuğu | Takip sayısı (1591), Ayarlar, hedef, arama, tam ekran, Site Chat, Vamp, Create, Deploy Settings | Ortalanmış araç çubuğu: takip sayısı, Ayarlar, arama, tam ekran, **Deploy**, Deploy ayarları | — |
| Gönderi kartı başlığı | Avatar, ad, onay rozeti, saniyeli saat (23.32.33), @kullanıcı, takipçi sayısı | Aynısı; saat yerine "x sn önce" ve alınma gecikmesi | XFlux / Telegram |
| Kart sağ üst | Kapat (gizle), **⚡ Deploy** | Gizle, **⚡ Deploy** (formu gönderiyle doldurur), **Al** (karttaki CA için) | GMGN |
| Gövde | Metin, link, görsel; anahtar kelimeler vurgulu ("Secretary-General") | Metin + medya + vurgu (§2.4 kurallarıyla) | — |
| Yanıt / alıntı | "Replying to" kutusu, alıntıda pembe sol kenar, $DOG etiketi | Gönderi türüne göre ince sol kenar (renk değil, kalınlık/gri ton) | — |
| **Öneri ızgarası** | Konuyla eşleşen 6 mevcut token: görsel, ad, $TICKER, N/T butonları, "Disable suggestions" | Vurgulanan kelimeler ve $TICKER ile GMGN aramasından 6 token; her birinde **Hızlı al (P1)** ve **GMGN** | `GET /v1/market/search` |
| Kart alt ikonları | Gizle, filtre, kopyala, ekran görüntüsü, bildirim, sabitle, saat, "View ↗" | Yazarı sessize al, metni/CA'yı kopyala, kartı görsel olarak kaydet (deploy görseli), bildirim, sabitle, X'te aç | — |
| Alt durum çubuğu | Connected, Layout, History, Fees P1, EUROPE 27ms | Bağlantı (Supabase + motor), Düzen, Geçmiş, **Aktif ücret preset'i**, GMGN gecikmesi (ms) | — |

### 2.2 Ayarlar → Tracker (ekran 2)

| Öğe | MemeBot karşılığı |
|---|---|
| Sol menü grupları: TRACKER / DEPLOY / APP | Aynı gruplama: **Takip** (Hesaplar, Görünüm, Anahtar kelimeler, Kontratlar) · **Deploy** (Genel, Cüzdanlar, Öneriler) · **Uygulama** (Kısayollar, Gelişmiş) |
| "Search and add accounts" | Hesap ekleme (X @kullanıcı, Telegram kanalı) |
| Platform sekmeleri (X, Truth, Instagram, TikTok, YouTube, Telegram…) | **İlk sürümde X ve Telegram.** Diğerleri veri sağlayıcısı bulunursa eklenir |
| Available / Custom Accounts | **Ortak havuz** (founder'ın eklediği, herkesin görebildiği) / **Benim hesaplarım** |
| Satır: Muted, kopyala, deploy, ekran görüntüsü, sabitle | Sessize al, bildirim aç, sabitle, kaldır |
| Sayfalama (1–21 / 1499), Import / Export / Manage | Sayfalama, **CSV içe/dışa aktar**, toplu düzenle |

### 2.3 Ayarlar → Appearance (ekran 3)

| Öğe | MemeBot karşılığı |
|---|---|
| Theme / Layout / Feed / Deploy sekmeleri | Aynı 4 sekme |
| Canlı önizleme kartı | Aynısı; değişiklik anında uygulanır |
| 19 hazır tema + Custom | **Varsayılan tema bizim sade tek tonlu temamız kalır.** Birkaç koyu varyant (Slate, Midnight vb.) + Açık tema |
| Custom palette: Background, Cards, Accent, Text, Muted text, Borders | Aynı 6 renk; mevcut CSS değişkenlerimize birebir oturuyor |
| Copy JSON / Paste JSON / Export | Temayı JSON olarak paylaşma; tema kullanıcıya özel olarak Supabase'de saklanır |

### 2.4 Ayarlar → Keywords (ekran 4)

| Öğe | MemeBot karşılığı |
|---|---|
| Hazır vurgular: `$TICKER`, "Quoted text", AI predicted name | `$TICKER` ve "tırnak içi" — ilk sürümde. **AI ile ad tahmini** isteğe bağlı (§8) |
| Özel kelimeler (coin, deploy, inu, baby, dog…), eşleşme: Partial / Full word | Aynı; eşleşme türü: kısmi / tam kelime / regex |
| Satırda sessize al, düzenle, kopyala, sil, renk | Aynı + **ses** ve **masaüstü bildirimi** seçeneği |
| Not | Vurgulanan kelimeler **öneri ızgarasına arama terimi** olarak da gider |

### 2.5 Ücret preset'leri (ekran 5)

| Öğe | MemeBot karşılığı |
|---|---|
| Preset 1/2/3 | Aynı; alt çubuktan ve kısayolla (F1/F2/F3) değişir |
| Deploy / Buy / Sell sekmeleri | Aynı üç sekme |
| Priority (SOL), Bribe (SOL), GWEI (EVM, Auto) | Öncelik ücreti, **tip** (bribe), slippage, anti-MEV. GWEI sadece BSC deploy'u eklenirse gelir |
| Reset Preset | Varsayılana dön |

Bugün bu değerler Kurallar ekranında tek set halinde. v2'de 3 preset'e bölünür; otomatik mod hangi preset'i kullanacağını seçer.

### 2.6 Deploy Settings → General (ekran 6)

| Öğe | MemeBot karşılığı | GMGN |
|---|---|---|
| Deploy / Tweets / Auto-fill sekmeleri | Deploy / Otomatik doldurma (Tweets §2.9'da) | — |
| Default platform (Pump.fun) | Varsayılan platform: **pump · bonk · bags** (SOL), fourmeme · flap (BSC, sonra) | `dex` |
| Open after deploy: Axiom / Terminal / GMGN / None | Deploy sonrası aç: **GMGN / Solscan / Hiçbiri** | — |
| Deploy form: Modal / Side panel | Aynı iki yerleşim | — |

### 2.7 Cüzdanlar (ekran 7–10)

| Öğe | J7 | MemeBot önerisi |
|---|---|---|
| Liste: yıldız (varsayılan), ad, adres, bakiye | ✓ | ✓ GMGN'e bağlı cüzdanlar, etiket, varsayılan, bakiye (`/v1/user/info`) |
| Create → SOL/EVM, "özel anahtar bir kez gösterilir" | Uygulama cüzdan üretip anahtarı **kendisi saklıyor** | ⚠️ **Önerilmez.** Bizim modelimizde işlem GMGN'e bağlı cüzdandan yapılıyor; uygulama özel anahtar tutmuyor (en büyük güvenlik avantajımız). "Oluştur" butonu GMGN'in cüzdan sayfasını açar |
| Delete wallet | ✓ | Listeden gizle (GMGN'deki cüzdan silinmez) |
| Claim Fees | Creator ücretlerini toplama | Araştırılacak: GMGN'de karşılığı belgelenmemiş |
| Distribute | Cüzdanlar arasında SOL dağıtma | ❌ GMGN API'sinde transfer uç noktası yok |

### 2.8 Token Deploy formu (ekran 11, 13)

| Alan | MemeBot karşılığı | GMGN `create_token` alanı |
|---|---|---|
| Name (0/32), Symbol (0/13), "Auto" | Aynı sınırlar; **Auto** = gönderiden doldur | `name`, `symbol` |
| Ad önerileri (çipler: "ify", "Justice For"…) | Vurgulanan kelimelerden ve tırnak içinden öneri çipleri | — |
| Website | ✓ | `website` |
| Post (x.com linki) | Kaynak gönderinin linki otomatik gelir | `twitter` |
| Select image: gönderideki görseller, AI, Upload, arama | Gönderi medyası + kartın ekran görüntüsü + yükle. AI görsel sonra | `image` (base64, ≤2 MB) / `image_url` |
| Platformlar: Pump, OTC, Stonk, four.meme, ETH, Argus | **Pump, Bonk, BAGS** (SOL). OTC/Stonk/ETH/Argus GMGN'de yok | `dex` |
| Dividends, NVDA-1%, Tasks | J7'ye özel; anlamı ekranlardan çıkmıyor | — (kapsam dışı) |
| **Fee Split** (ekran 13): cüzdan + %, Charity, Turbo | Ücret paylaşımı: cüzdan / X kullanıcısı + yüzde, toplam %100 kontrolü | `pump_fee_share_list` / `bags_fee_share_list` (`provider`, `username`, `basic_points`) |
| Multi | Aynı token'ı birden fazla kez çıkarmak gibi görünüyor | ❌ Kapsam dışı (§3) |
| **Bundle** (2b) | Çıkış anında birden fazla cüzdanla alım | ❌ Kapsam dışı (§3) |
| Alım tutarı (≡ 1) | Geliştirici alımı (SOL) | `buy_amt` |
| Deploy (Enter), # sayaç | Enter ile gönder; aynı form iki kez gönderilmez (idempotency) | — |
| Üstte cüzdan + bakiye | Varsayılan cüzdan seçici | `from_address` |
| — | **Otomatik satış:** X sn sonra ya da şu piyasa değerinde %Y sat | `sell_configs` (`delay_sell` / `limit_order`) |

### 2.9 X hesabı bağlama + gönderi (ekran 12)

| Öğe | Not |
|---|---|
| Connect X account, gönderi yazma, Drafts, Community, "Auto-deploy" | Kendi X hesabından gönderi atıp aynı anda deploy etmek. **X'e yazmak resmi X API (OAuth, ücretli) gerektirir**; XFlux'ta gönderi atma "yakında" görünüyor. Sonraki faza bırakılır |
| **Vamp tweet** | Başkasının gönderisini/kimliğini kopyalama — ❌ kapsam dışı (§3) |

---

## 3. Bilerek almadıklarımız

| J7 özelliği | Neden almıyoruz |
|---|---|
| **Bundle / Sniper** (çıkışta çoklu cüzdanla alım) | Geliştiricinin gerçek payını gizlemeye yarar; rug pull'larda kullanılan bir piyasa manipülasyonu yöntemi. Bizim güvenlik kontrolümüz başkalarının yaptığı bu işi zaten tespit edip reddediyor |
| **Vamp** (var olan token'ın/gönderinin kimliğini kopyalama) | Alıcıyı yanıltmaya dayalı; hukuki ve itibar riski |
| **Multi** (aynı token'ı çoklu çıkarma) | Aynı sebep |
| Tarayıcı eklentisi (Extension) | J7 adlı bir eklentinin cüzdan verisi sızdırdığı raporlandı (ilk analiz §8); kendi eklentimizi yapmıyoruz |
| Site Chat, Cashback, Rewards, Affiliate Tags | J7'nin iş modeli (kullanıcı topluluğu ve gelir) — iç kullanım uygulamasına gerekmiyor |
| OTC, Stonk, Argus, ETH platformları | GMGN API'si desteklemiyor |

---

## 4. Tasarım dili

- **Yerleşim J7'ye benzer:** üstte ortalı araç çubuğu, ortada tek sütun kart akışı (~850 px), altta ince durum çubuğu, ayarlarda sol menü + sağ içerik.
- **Renk bizim sade dilimiz:** tek tonlu koyu zemin; renk sadece anlam taşır (yeşil = kâr/geçti, kırmızı = zarar/red, sarı = uyarı). J7'nin mavi vurgusu ve rengarenk anahtar kelime vurguları yerine:
  - **Vurgu:** açık gri zemin + koyu metin.
  - **Kullanıcının seçtiği renkler:** yalnızca kendi teması/kelimeleri için.
- J7'nin logosu, isimleri ve görsel varlıkları kullanılmaz; ürün kendi kimliğiyle kalır.
- **Kart anatomisi:** başlık satırı → gövde → (varsa) alıntı kutusu → medya → öneri ızgarası (katlanabilir) → alt ikon satırı.

---

## 5. Chrome'da açılması: mimari karar

**Sorun:** Bugün işin ağır kısmı Electron'un ana sürecinde, kullanıcının bilgisayarında çalışıyor:
- GMGN istek imzası,
- Telegram dinleyici,
- XFlux yoklama,
- otomatik mod,
- fiyat takibi.

Anahtarlar da o bilgisayarda Windows şifrelemesiyle duruyor. Tarayıcı bunların hiçbirini yapamaz:
- GMGN tarayıcıdan gelen istekleri muhtemelen kabul etmez (CORS),
- anahtarların tarayıcıda durması güvensiz,
- Telegram oturumu sekmeyle kapanır.

| Seçenek | Nasıl | Artı | Eksi |
|---|---|---|---|
| **A — Motor sunucusu (önerilen)** | Ana süreçteki mantık tek bir Node servisine ("MemeBot Engine") taşınır; 7/24 çalışır (küçük VPS ~$5–6/ay ya da founder'ın bilgisayarında Windows servisi). Web ve masaüstü sadece arayüz olur; Supabase üzerinden okur ve komut yazar (ör. `orders` satırı "created" → motor çalıştırır) | Otomatik mod bilgisayar kapalıyken de çalışır; tüm cihazlar aynı motoru görür; Chrome, masaüstü ve ileride telefon aynı arayüz | Anahtarlar artık sunucuda (şifreli saklanır); sunucu bakımı gerekir |
| B — Supabase Edge Function aracı | GMGN çağrıları Edge Function üzerinden; dinleyiciler masaüstünde kalır | Sunucu yok | Web sürümü yarım kalır (sinyal dinlemez); uzun süren dinleyiciler Edge Function'da çalışamaz |
| C — Sadece tarayıcı | Anahtarlar tarayıcıda, CORS için aracı | En kolay | **Güvensiz** — önermiyorum |

**A seçilirse:**
- Web arayüzü: mevcut React kodu statik site olarak yayınlanır (Netlify, Vercel ya da Cloudflare Pages). Giriş yine Supabase'den, açık kayıt yine kapalı.
- Masaüstü uygulaması: aynı arayüzü gösteren ince bir kabuk olarak kalır.
- GitHub ile güncelleme akışı değişmez; web sürümü her push'ta otomatik güncellenir.

---

## 6. Veri kaynağı ölçeği (karar gerekiyor)

J7 ~1.500 hesabı 200 ms altında izlediğini söylüyor; bunun için kendi veri altyapısı var. Bizde:

| Kaynak | Kapasite | Maliyet |
|---|---|---|
| XFlux Starter | 3 hesap, 1 sn | $19/ay |
| XFlux Scale | 50 hesap, 1 sn | $249/ay |
| TweetAPI (X listesi yoklama) | 1 liste (yüzlerce hesap), 5 sn'de bir ≈ 17.000 istek/gün | ≈ $8–9/gün |
| Telegram | Sınırsız kanal | Ücretsiz |

**Önerim:**
- **X:** XFlux ile en önemli 3–8 hesap (gerçek zamanlı) + TweetAPI ile geniş liste (5–10 sn gecikmeyle).
- **Telegram:** ana kaynak olarak kalır.
- Hangi hesapların izleneceğine sen karar ver.

---

## 7. v2 faz planı

| Faz | Süre (tahmini) | Kapsam | Bitti sayılır… |
|---|---|---|---|
| **v2-0 Doğrulama** | 1–2 gün | Mevcut alım-satımın gerçek GMGN ile küçük tutarlı testi (hâlâ yapılmadı) | Bir alım + satış gerçek cüzdanda kesinleşti |
| **v2-1 Motor + Web** | ~1 hafta | Ana süreç mantığı → MemeBot Engine; arayüz → statik web sitesi; masaüstü = kabuk; komutlar Supabase üzerinden | Chrome'da giriş yapıp sinyal görme ve deneme alımı yapma |
| **v2-2 Akış v2** | ~1,5 hafta | Gönderi tablosu (`feed_items`); J7 tarzı kartlar (medya, yanıt/alıntı, vurgu); öneri ızgarası + hızlı al; kart aksiyonları; alt durum çubuğu | Aynı gönderi tek kart; öneriler 1 sn içinde |
| **v2-3 Ayarlar v2** | ~1 hafta | Hesap havuzu (ortak / benim) + CSV; anahtar kelimeler (kısmi/tam/regex, ses, bildirim); görünüm (temalar, palet, JSON); kısayollar; **ücret preset'leri P1–P3** | Tüm ayarlar cihazlar arası senkron |
| **v2-4 Deploy** | ~1 hafta | GMGN `create_token`; modal/yan panel; gönderiden otomatik doldurma; görsel; ücret paylaşımı; geliştirici alımı; otomatik satış; deploy sonrası aç; Enter ile gönder | Pump.fun'da deneme token'ı kesinleşti |
| **v2-5 Cüzdanlar v2** | 2–3 gün | GMGN cüzdan listesi, etiket, varsayılan, bakiyeler | — |
| Sonra | — | X'e gönderi + otomatik deploy (resmi X API), AI ad/görsel önerisi, BSC (fourmeme/flap), Claim Fees | — |

**Toplam:** v2-0 ile v2-5 arası yaklaşık 5–6 hafta.

### Yeni tablolar (taslak)

```
feed_items        id, user_id?, platform, external_id, author, author_meta(json), text, media(json),
                  kind(post|reply|quote|repost), ref(json), created_at, received_at, deleted
tracked_accounts  id, owner_id (null = ortak havuz), platform, handle, muted, notify, pinned
keywords          id, user_id, pattern, match(partial|word|regex), color, sound, notify, muted
fee_presets       user_id, slot(1-3), kind(deploy|buy|sell), priority_sol, tip_sol, slippage, anti_mev
deploys           id, user_id, idempotency_key, request(json), status, mint, tx_hash, error, created_at
ui_settings       user_id, theme(json), layout(json), keybinds(json)
```

---

## 8. Senden karar beklenenler

1. **Web mimarisi:** ✅ **A — MemeBot Engine sunucusu** (16 Ekim 2026). Açık kalan: sunucu nerede çalışsın, VPS mi kendi bilgisayarın mı?
2. **X kapsamı ve bütçesi:** kaç hesap ve aylık ne kadar? (§6)
3. **AI ad/görsel önerisi** istiyor musun? (Claude API ile; gönderi başına küçük bir maliyet)
4. **Sıra:** önce v2-0 (gerçek GMGN doğrulaması) — önerim bu — sonra v2-1?

---

## Kaynaklar

- Kullanıcının paylaştığı J7Tracker ekran görüntüleri (13 adet, video: youtube.com/watch?v=RvsSVGHX40g)
- GMGN token oluşturma: github.com/GMGNAI/gmgn-skills → `skills/gmgn-cooking/SKILL.md`
- GMGN arama: `skills/gmgn-market/SKILL.md`
- XFlux planları: xfluxapi.com/docs/limits · TweetAPI fiyatları: tweetapi.com/docs
- İlk analiz: `j7tracker-analiz-ve-taslak.md` (eklenti güvenlik bulgusu §8)
