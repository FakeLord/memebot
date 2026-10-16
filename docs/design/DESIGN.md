# MemeBot — "Latent" tasarım dili

Tarih: 16 Ekim 2026 · Durum: **uygulanmadı — yerine J7 tarzı tasarım seçildi** (bkz. CLAUDE.md → Tasarım)

| Dosya | İçerik |
|---|---|
| `docs/design/design-dna.json` | Tasarımın tamamı makine okunur halde (renk, tipografi, boşluk, bileşen, efekt) |
| `docs/design/mockups/index.html` + `latent.css` | Tıklanabilir maketler. Chrome'da açın: `index.html#akis`, `#onay` … |
| `docs/design/screens/*.png` | 17 ekran görüntüsü (masaüstü 1440×900, telefon 390 px) |

---

## 1. Fikir: "Her token bir girdi. Her karar bir çıkarım."

**"Token" kelimesinin iki anlamı var:**
- **Dil modelinde:** metnin parçası. Model bunları okur, dikkat ağırlığı verir, olasılık hesaplar.
- **Kripto'da:** coin.

Latent bu çakışmayı arayüzün omurgası yapar. MemeBot ekranda bir yapay zekâ çıkarım motoru gibi davranır:

| Model kavramı | MemeBot'taki karşılığı | Ekranda nasıl görünür |
|---|---|---|
| Girdi (prompt) | Telegram/X gönderisi | **Token şeridi:** metin kelime kelime ince kutucuklara bölünür; önemli kelimelerin arkası mor tonla koyulaşır (dikkat ağırlığı) |
| Olasılık | Güvenlik skoru | **Güven çubuğu:** 20 ince dikey çizgi; dolu çizgi sayısı = skor (0.86 için 17 çizgi) |
| Çıkarım izi | Sinyalden emre giden yol | **Karar izi:** `01 SİNYAL · 02 GÜVENLİK · 03 KURAL · 04 ONAY · 05 EMİR` hücreleri; tamamlanan dolu, şu anki mor |
| Modelin açıklaması | Neden geçti/reddedildi | **Çıkarım satırı:** solda mor çizgi, mono yazı: `mint bırakılmış · rug 0.08 · likidite $41K · sonuç GEÇTİ` |
| Gizli uzay | Arkaplan | **Latent alan:** çok soluk 16 px nokta matrisi; yeni sinyal gelince bir satır kısa süre mora döner |
| Model düşünüyor | Motor değerlendirme yapıyor | **Düşünüyor göstergesi:** üç kısa mor çizgi sırayla yanar; dönen ikon yok |

---

## 2. Değişmez kurallar

1. **İkon ve emoji yok.** Hiçbir sayfada, hiçbir butonda; ok işareti (→ ↗) bile yok. Anlamı şunlar taşır:
   - **Metin:** "Satın al", "Kontrol", "GMGN".
   - **Mono kısaltma:** TG, X, SOL, EL.
   - **Sayı indeksi:** 01–09.
   - **Pip:** 6 px kare durum noktası.
   - **Çizgi:** segmentli çubuklar, güven çubuğu.
2. **Renk sadece anlam taşır:**

   | Renk | Kod | Anlamı |
   |---|---|---|
   | **Mor** | `#B6A6FF` | Yalnızca yapay zekâ etkinliği: çıkarım, dikkat, odak, seçili öğe. **Asla para anlamında kullanılmaz** |
   | Yeşil | `#57D9A3` | Kâr / geçti |
   | Kırmızı | `#F26D6D` | Zarar / red / gerçek para uyarısı |
   | Sarı | `#E8B95A` | Uyarı / veri eksik |
   | Gri tonlar | — | Geri kalan her şey |

3. **Tüm sayılar mono ve tabular:** fiyat, adres, saat, skor, tutar. Sayılar tablolarda sağa yaslanır.
4. **Derinlik gölgeyle değil, yüzey tonu ve 1 px çizgiyle** verilir. Tek istisna modal / yan panel gölgesi.
5. **Etiketler:** BÜYÜK HARF mono "overline" (10 px, %14 harf aralığı).
6. **Hareket sadece bilgi taşır:** yeni kart, karar izinin ilerlemesi, "düşünüyor" göstergesi. Süs animasyonu yok. `prefers-reduced-motion` açıksa hepsi durur.
7. **Buton etiketleri:** "Al" yerine **"Satın al"** yazılır. Geist fontunda küçük "l" büyük "I" gibi görünür; "Al" butonu "AI" diye okunuyor.

---

## 3. Tasarım belirteçleri (token'lar)

### Renk

| Belirteç | Değer | Kullanım |
|---|---|---|
| `--bg` | `#08090A` | Zemin |
| `--card` | `#0F1012` | Kart |
| `--elev` | `#15171A` | Yükseltilmiş yüzey, satır üzeri |
| `--line` | `#1F2226` | İnce çizgi |
| `--line-2` | `#2A2E33` | Güçlü çizgi, buton kenarı |
| `--ink` | `#ECEDEE` | Ana metin, birincil buton zemini |
| `--ink-2` | `#C9CCD1` | Gövde vurgusu |
| `--mute` | `#8A8F98` | İkincil metin (zemine karşı 6.3:1) |
| `--faint` | `#555A62` | Sadece süs / devre dışı (metin için değil) |
| `--ai` | `#B6A6FF` | Yapay zekâ etkinliği |
| `--pos` / `--neg` / `--warn` | `#57D9A3` / `#F26D6D` / `#E8B95A` | Anlam renkleri |

### Tipografi

**Aileler:**
- **Arayüz:** Geist (400 / 500).
- **Veri:** Geist Mono (400 / 500).
- **Yedek:** Segoe UI Variable / Cascadia Mono.

| Rol | Boyut / ağırlık / satır | Not |
|---|---|---|
| Display | 44 / 500 / 1.0, −0.03em | Giriş sayfası |
| Başlık 1 | 22 / 500 / 1.2 | Sayfa içi büyük başlık |
| Başlık 2 | 15 / 500 / 1.3 | Üst çubuk sayfa adı |
| Gövde | 13 / 400 / 1.55 | Varsayılan |
| Küçük | 12 / 400 / 1.5 | Tablo, açıklama |
| Altyazı | 11 mono | Zaman, gecikme |
| Overline | 10 mono 500, %14, BÜYÜK HARF | Bölüm ve alan etiketleri |
| Büyük sayı | 30 mono 500, −0.03em | PnL, skor, kalan süre |

### Boşluk, şekil, yerleşim

- **Boşluk ölçeği:** 4 px taban → 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48.
- **Köşe yarıçapları:**

  | Öğe | Yarıçap |
  |---|---|
  | Etiket, küçük buton | 4 |
  | Buton, giriş alanı | 8 |
  | Kart | 12 |
  | Rozet | tam yuvarlak |

- **İskelet:**

  | Bölge | Boyut |
  |---|---|
  | Sol ray | 216 px |
  | Üst komut çubuğu | 56 px |
  | İçerik | — |
  | Alt durum çubuğu | 28 px |
  | Akış sütunu | 720 px |
  | Diğer sayfalar | en fazla 1120 px |
  | Sağ çıkarım paneli (isteğe bağlı) | 320 px |

- **Kırılım noktaları:**
  - **390 px:** telefon, alt metin sekmeleri.
  - **768 px:** ray daralır.
  - **1280 px:** masaüstü.
  - **1600 px:** sağ panel sabit.

### Hareket

- **Eğri:** `cubic-bezier(0.2, 0, 0, 1)`.
- **Süreler:** 120 ms (mikro) · 220 ms (normal) · 480 ms (büyük).
- **Karar izi:** hücreler soldan sağa 60 ms arayla yanar.
- **Çıkarım satırı:** daktilo efekti, karakter başına 12 ms.

---

## 4. Bileşenler

| Bileşen | Tarif |
|---|---|
| **Sol ray** | Marka: `memebot` mono + yanıp sönen mor blok imleç. Gezinme sadece metin, solda iki haneli mono indeks (`01 Akış`). Gruplar: (başlıksız) Akış / Onay / Pozisyonlar / Emirler · GİRDİLER Kaynaklar / Token Kontrol · MODEL Kurallar / Ayarlar / Kullanıcılar. Seçili öğenin solunda 2 px mor çizgi. Onay sayısı mor rozet |
| **Komut çubuğu** | Üstte ortada: `> Adres, @hesap ya da komut yazın` + `CTRL K`. Adres yapıştırılırsa Token Kontrol, @hesap yazılırsa hesap, "durdur" yazılırsa kill switch onayı açılır |
| **Üst sağ** | Mod etiketi (DENEME gri / GERÇEK kırmızı dolu), motor pip'i, founder için "Tümünü durdur" (kırmızı çerçeveli) |
| **Alt durum çubuğu** | mono 11 px: Bağlı · Motor · sunucu · GMGN ms · mod · Ücret P1 P2 P3 · düşünüyor göstergesi + "2 token değerlendiriliyor" · sağda Web/Masaüstü + sürüm |
| **Kart** | `--card`, 1 px çizgi, 12 px köşe, 16 px iç boşluk. Başlık: overline + sağda mono meta |
| **Buton** | Birincil açık zemin + koyu metin; ikincil şeffaf + çizgi; tehlike kırmızı metin + kırmızı çizgi. Kısayol sağda mono rozet (`ENTER`, `B`, `1`) |
| **Giriş alanı** | Zemin `--bg`, odakta mor çizgi + 3 px yumuşak halka. Sayısal alan mono, birim sağ içte (`SOL`, `%`, `$`) |
| **Segment seçici** | Sekme yerine; seçili parça `--elev` |
| **Anahtar** | 28×16; açık beyaz; "Gerçek işlem" açıkken kırmızı |
| **Tablo** | Başlık overline, satır 40 px, sayılar sağa mono, satır üzeri `--elev` |
| **Güven çubuğu** | 20 × (2×14 px) çizgi + mono skor; renk sonuca göre |
| **Karar izi** | 5 hücre; tamamlanan `--card`, şu anki mor zemin %14, bekleyen soluk |
| **Token şeridi** | Kelime kutucukları; dikkat ağırlığı 3 kademe (mor %7 / %16 / %30); mint adresi mono kutucuk |
| **Adres** | 4'lü mono gruplar, baştaki ve sondaki gruplar açık renk. Kısa hali `7GCi hgDB · · · uHYm W2hr` |
| **Monogram** | Token logosu yokken 32 px kare, mono 2 harf |
| **Yaşam döngüsü çubuğu** | Emirlerde 4 segment: HAZIR · GÖNDERİLDİ · İŞLENİYOR · KESİN |

---

## 5. Sayfalar

Her sayfa için: görsel · düzen · içerik · durumlar.

### 01 Giriş — `screens/01-giris.png`
- **Düzen:** İki sütun.
  - **Sol:** marka, `SİNYAL · ÇIKARIM · EMİR` overline, display başlık "Her token bir girdi. Her karar bir çıkarım.", kısa açıklama, örnek karar izi. Altta sürüm satırı.
  - **Sağ:** 340 px form: e-posta, parola, `Giriş yap ENTER`, "Açık kayıt kapalı · yeni hesaplar pasif açılır".
- **Durumlar:** hatalı giriş → alanın altında kırmızı tek satır; pasif hesap → sarı tek satır.

### 02 Akış — `screens/02-akis.png`
- **Düzen:** 720 px kart sütunu. Üstte segment `Tümü · X · Telegram · Sadece CA`, sağda kaynak sayıları.
- **Gönderi kartı:**
  1. avatar monogram, ad, @kullanıcı, kaynak etiketi (TG/X), `saat · alındı +gecikme`, sağda `YENİ` (mor), Gizle, **Deploy**;
  2. **token şeridi** halinde metin, yanıt/alıntı kutusu, medya;
  3. **CA varsa çıkarım kutusu:** kısa adres, GÜVEN çubuğu + skor, Kontrol / Kopyala / **Satın al 0.1 SOL `B`**, çıkarım satırı, karar izi;
  4. **CA yoksa öneri ızgarası:** 3 sütun; monogram, ad, `$TICKER · MC`, skor, Satın al;
  5. alt satır: Sessize al · Metni kopyala · Görsel olarak kaydet · Sabitle · X'te aç.
- **Durumlar:** yeni kart mor çerçeveyle girer, 8 sn sonra normale döner.

### 03 Sinyaller — `screens/03-sinyaller.png`
- Akış'ın tablo görünümü (`Kartlar · Sinyaller` segmenti).
- **Sütunlar:** Zaman · Kaynak (+TG/X/EL) · Token · Güven · Çağrı (birden fazlaysa mor `3×`) · Gecikme · Karar (ONAYDA / UYARI / RED · neden / ALINDI / TEKRAR) · Kontrol.

### 04 Onay — `screens/04-onay.png`
- **Üstte çıkarım satırı:** mod, bekleme süresi, işlem modu.
- **Aday kartı:**
  - monogram, `$TICKER`, ad, platform, tam adres;
  - sağda **KALAN** büyük mono sayaç;
  - 4 metrik: Güven çubuğu, Piyasa değeri, Likidite, Holder;
  - sorun etiketleri (sarı/kırmızı), çıkarım satırı, karar izi;
  - butonlar: **Dene/Satın al 0.1 SOL `1`**, 0.25 `2`, 0.5 `3`, Reddet `R`; sağda Ayrıntı · GMGN.
- **Altta "Son kararlar" tablosu:** Onaylandı / Reddedildi / Süresi doldu / Otomatik (mor).
- **Gerçek modda:** birincil buton "Satın al" olur, üstteki çıkarım satırında `GERÇEK — onay SOL harcar` kırmızı yazar.

### 05 Pozisyonlar — `screens/05-pozisyonlar.png`
- **4 metrik kartı:** Açık toplam (büyük yeşil/kırmızı) · Bugün gerçekleşen · Açık pozisyon `4 / 5` · Günlük harcama `1.10 / 2`.
- **Tablo:** Token (monogram + adres + DENEME etiketi) · **İz (1 sa)** 96 px mini çizgi, uç noktası anlam renginde · Giriş · Şimdi · Maliyet · Kâr / zarar (SOL + %) · TP / SL · `%25 %50 %100`.
- **Kart başında:** "Tümünü sat". Altında `*` tahmin notu.

### 06 Emirler — `screens/06-emirler.png`
- **Segmentler:** `Emirler · Deploy'lar` ve `Tümü · Gerçek · Deneme`.
- **Yaşam döngüsü sütunu:** 4 segmentli çubuk + durum metni. Gönderim ile zincirde kesinleşme ayrı görünür.
- **Zincir kaydı:** kısa hash.

### 07 Kaynaklar — `screens/07-kaynaklar.png`
- **Telegram kartı:** bağlı hesap, "salt okur" çıkarım satırı, kanal arama, kanal tablosu (sinyal/gün, İzle / İzleniyor).
- **X · XFlux kartı:** kalan kota (büyük sayı), yoklayan motor, izleyici tablosu.
- **Altta "Elle girdi":** adres/mesaj yapıştır + `Akışa ekle ENTER`.

### 08 Token Kontrol — `screens/08-kontrol.png`
- **Üstte:** büyük mono giriş alanı (yapıştırınca otomatik çalışır).
- **Özet kartı:** kimlik, sağda büyük **GÜVEN** skoru + çubuk, 4 metrik, çıkarım satırı (`9 kontrolden 8'i geçti …`).
- **Kontrol tablosu:** Kontrol · Değer · Eşik · **Katkı** (güven çubuğu) · Sonuç etiketi.

### 09 Kurallar — `screens/09-kurallar.png`
- **Mod:** 3 seçim kartı (İzle / Manuel onay / Otomatik); seçili kart mor çerçeve + mor zemin %14.
- **Gerçek işlem:** kırmızı çerçeveli satır + anahtar. Açılınca onay penceresi çıkar.
- **Güvenlik eşikleri:** 3×3 mono sayı alanı + 3 anahtar; başlıkta "model girdisi".
- **Alt satır:** Limitler kartı ve TP / SL tablosu yan yana. TP yeşil `+%100`, SL kırmızı `−%40`.
- **Kaydet:** `Kaydet CTRL S`.

### 10–14 Ayarlar — `screens/10…14-*.png`
- **İç gezinme:** soldaki metin listesi.
  - MOTOR: Motor ve GMGN · Cüzdanlar
  - TAKİP: Hesaplar · Anahtar kelimeler · Görünüm
  - İŞLEM: Ücret preset'leri · Deploy · Kısayollar
- **Motor ve GMGN:**
  - motor metrikleri: sunucu, sürüm, gecikme, kuyruk;
  - "kasa" çıkarım satırı (anahtarlar mühürlü zarfla gider);
  - GMGN kartı: anahtar asla gösterilmez, sadece "son 4"; plan segmenti.
- **Anahtar kelimeler:**
  - üstte canlı **dikkat önizlemesi** (token şeridi);
  - tablo: kelime, eşleşme, **ağırlık** (3 mor kademe), ses, bildirim;
  - ekleme satırı: Kısmi / Tam / Regex.
- **Ücret preset'leri:**
  - `P1 hızlı · P2 dengeli · P3 ucuz` segmenti, `F1 F2 F3`;
  - 3 kart (Alım / Satış / Deploy): öncelik, tip, slippage, Anti-MEV;
  - tahmini maliyet çıkarım satırı.
- **Görünüm:**
  - tema kartları: **Latent** (varsayılan), Grafit (eski sade tema), Gece, **Kağıt** (açık tema);
  - özel palet: 6 renk, JSON kopyala / yapıştır.
- **Cüzdanlar:**
  - "uygulama özel anahtar tutmaz" çıkarım satırı;
  - tablo: etiket, adres, bakiye, VARSAYILAN, Gizle.

### 15 Kullanıcılar — `screens/15-kullanicilar.png`
- **Sol:** ekip tablosu. Rol etiketi (FOUNDER mor), durum pip'i, son giriş, Pasifleştir / Sil.
- **Sağ:** yeni kullanıcı formu. Rol segmenti varsayılan **Asistan**.

### 16 Deploy paneli — `screens/16-deploy.png`
- Akış üzerinde sağdan 480 px yan panel; Ayarlar → Deploy'dan ortada modal da seçilebilir.
- **Başlık:** kaynak gönderi, cüzdan + bakiye, `Kapat ESC`.
- **Ad ve sembol:** karakter sayaçlı; altında **gönderiden çıkarılan adlar** çipleri (ilki mor = modelin önerisi).
- **Görsel:** 5'li ızgara (gönderi medyası + Yükle).
- **Diğer alanlar:**
  - web sitesi ve gönderi linki;
  - platform segmenti: `pump · bonk · bags`;
  - geliştirici alımı ve otomatik satış;
  - ücret paylaşımı tablosu (toplam %100).
- **Ön kontrol:** çıkarım satırı.
- **Alt satır:** preset ve tahmini ücret + `Deploy et ENTER`.

### 17 Telefon / web — `screens/17-mobil.png`
- **Üst:** marka, mod etiketi, motor pip'i.
- **Alt metin sekmeleri:** Akış · Onay 3 · Pozisyon · Emirler · Daha. Seçilinin üstünde mor çizgi.
- **Kart:** sıkışık sürüm. Çıkarım kutusunda tam genişlik **Satın al 0.1 SOL** + Reddet.
- **Altında:** açık pozisyon özeti.

---

## 6. Prompt'lar

### 6.1 Ana prompt (tüm sayfalar için önce bunu verin)

> **MemeBot "Latent"** — bir meme coin işlem terminali için arayüz tasarla. Konsept: "Her token bir girdi, her karar bir çıkarım". Uygulama bir yapay zekâ çıkarım motoru gibi görünür: gönderi metni kelime kelime ince kutucuklara (token) bölünür ve önemli kelimelerin arkası soluk morla vurgulanır (dikkat ağırlığı); güvenlik skoru 20 ince dikey çizgiden oluşan bir güven çubuğu; her sinyalin yolu "01 SİNYAL · 02 GÜVENLİK · 03 KURAL · 04 ONAY · 05 EMİR" hücrelerinden oluşan bir karar izi; botun gerekçesi solunda mor çizgi olan tek satırlık mono "çıkarım" metni.
>
> **Görsel dil:**
> - Koyu zemin `#08090A`, kart `#0F1012`, yükseltilmiş yüzey `#15171A`, çizgiler `#1F2226` / `#2A2E33`.
> - Metin `#ECEDEE` / `#8A8F98`. Tek imza rengi mor `#B6A6FF`, sadece yapay zekâ etkinliği için.
> - Yeşil `#57D9A3` kâr/geçti, kırmızı `#F26D6D` zarar/red, sarı `#E8B95A` uyarı.
> - Font: Geist (arayüz) ve Geist Mono (tüm sayılar, adresler, saatler, etiketler).
> - Bölüm etiketleri 10 px BÜYÜK HARF mono, geniş harf aralığı.
> - 12 px köşeli kartlar, 1 px çizgiler, gölge yok.
> - Arkaplanda çok soluk 16 px nokta matrisi.
>
> **Yerleşim:**
> - Sol 216 px metin rayı: `01 Akış`, `02 Onay` … iki haneli mono indeks; seçili öğede solda 2 px mor çizgi.
> - Üstte ortada komut çubuğu: `> Adres, @hesap ya da komut yazın   CTRL K`.
> - Altta 28 px mono durum çubuğu.
>
> **KESİNLİKLE ikon, emoji, ok işareti, illüstrasyon kullanma.** Anlamı metin, mono kısaltmalar (TG, X, SOL), 6 px kare durum noktaları ve çizgiler taşısın. Sade, sessiz, hassas, teknik; Türkçe arayüz metinleri.

### 6.2 Sayfa prompt'ları (ana prompt'tan sonra)

| Sayfa | Prompt |
|---|---|
| Giriş | İki sütunlu giriş ekranı. Solda `memebot` mono marka ve mor blok imleç, "SİNYAL · ÇIKARIM · EMİR" overline, 44 px başlık "Her token bir girdi. Her karar bir çıkarım.", kısa açıklama ve örnek karar izi. Sağda 340 px form: E-POSTA, PAROLA, açık zeminli "Giriş yap ENTER" butonu, altında "Açık kayıt kapalı" notu |
| Akış | 720 px gönderi kartı akışı. Kart: monogram avatar, ad, @kullanıcı, TG/X etiketi, saat ve gecikme, sağda YENİ (mor), Gizle, Deploy. Gövde token şeridi (önemli kelimeler mor tonlu). CA varsa iç kutu: kısa adres, GÜVEN çubuğu 0.86, Kontrol/Kopyala/"Satın al 0.1 SOL B", çıkarım satırı, 5 hücreli karar izi (04 ONAY mor). CA yoksa 3 sütunlu öneri ızgarası. Alt satır metin bağlantıları |
| Sinyaller | Sinyal tablosu: Zaman, Kaynak + TG/X/EL etiketi, kısa adres, güven çubuğu + skor, Çağrı (3× mor), Gecikme, Karar etiketi (ONAYDA mor, UYARI sarı, RED kırmızı + neden, ALINDI yeşil), Kontrol |
| Onay | Onay bekleyen aday kartları: monogram, $TICKER, platform, tam adres, sağda büyük mono KALAN sayaç 7:42; 4 metrik (güven çubuğu, piyasa değeri, likidite, holder); sarı sorun etiketleri; çıkarım satırı; karar izi; "Dene 0.1 SOL 1 · 0.25 SOL 2 · 0.5 SOL 3 · Reddet R". Altta son kararlar tablosu |
| Pozisyonlar | 4 büyük mono metrik kartı (Açık toplam +0.412 yeşil, Bugün gerçekleşen −0.081 kırmızı, Açık pozisyon 4/5, Günlük harcama 1.10/2). Tablo: token, 96 px mini fiyat izi (uç noktası yeşil/kırmızı kare), giriş, şimdi, maliyet, kâr/zarar SOL ve %, TP/SL metni, %25 %50 %100 butonları; "Tümünü sat" kırmızı çerçeveli |
| Emirler | Emir tablosu; yaşam döngüsü sütununda 4 segmentli çubuk (HAZIR, GÖNDERİLDİ, İŞLENİYOR, KESİN) ve durum metni; zincir kaydı kısa hash; üstte iki segment seçici |
| Kaynaklar | İki kart: Telegram (bağlı hesap, salt okur çıkarım satırı, kanal tablosu İzle/İzleniyor) ve X · XFlux (kalan kota büyük sayı, yoklayan motor, izleyici tablosu). Altta tam genişlik "Elle girdi" satırı |
| Token Kontrol | Büyük mono adres alanı; özet kartında kimlik, sağda büyük GÜVEN 0.86 ve çubuk, 4 metrik, çıkarım satırı; altında kontrol tablosu: Kontrol, Değer, Eşik, Katkı (güven çubuğu), Sonuç etiketi |
| Kurallar | Mod için 3 seçim kartı (seçili mor çerçeve), kırmızı çerçeveli "Gerçek işlem" anahtarı, 3×3 mono eşik alanları ve 3 anahtar, Limitler kartı ve TP/SL tablosu yan yana, "Kaydet CTRL S" |
| Ayarlar | Sol iç metin menüsü (MOTOR / TAKİP / İŞLEM grupları). Motor kartı metrikleri, "kasa" çıkarım satırı, GMGN kartı (anahtar gizli, "son 4"), plan segmenti |
| Anahtar kelimeler | Üstte canlı dikkat önizlemesi (token şeridi), altta tablo: kelime, eşleşme, 3 kademeli mor ağırlık çubuğu, ses ve bildirim anahtarları; ekleme satırı Kısmi/Tam/Regex |
| Ücret preset'leri | P1 hızlı / P2 dengeli / P3 ucuz segmenti ve F1 F2 F3; Alım, Satış, Deploy kartlarında öncelik, tip, slippage, Anti-MEV; tahmini maliyet çıkarım satırı |
| Görünüm | 4 tema kartı (Latent varsayılan, Grafit, Gece, Kağıt açık), özel palet 6 renk alanı, JSON kopyala/yapıştır |
| Cüzdanlar | "uygulama özel anahtar tutmaz" çıkarım satırı, GMGN cüzdan tablosu: etiket, kısa adres, bakiye, VARSAYILAN etiketi |
| Kullanıcılar | Solda ekip tablosu (FOUNDER mor etiket, durum noktası, son giriş), sağda yeni kullanıcı formu ve rol segmenti |
| Deploy | Akışın üstünde sağdan 480 px yan panel: ad/sembol sayaçlı, gönderiden çıkarılan ad çipleri (ilki mor), 5'li görsel ızgarası, web/gönderi, pump/bonk/bags segmenti, geliştirici alımı, otomatik satış, ücret paylaşımı tablosu, ön kontrol çıkarım satırı, "Deploy et ENTER" |
| Telefon | 390 px: üstte marka ve mod, altta 5 metin sekmesi (seçilinin üstünde mor çizgi), sıkışık kart ve tam genişlik "Satın al 0.1 SOL" |

---

## 7. Uygulamaya taşıma (sonraki adım)

Mevcut kod zaten CSS değişkenleriyle çalışıyor (`src/renderer/src/styles.css`). Taşıma kabaca şu sırada:

1. **Belirteçler:**
   - `styles.css` `:root` değerlerini §3'tekilerle değiştir.
   - Geist ve Geist Mono'yu uygulamaya göm (OFL lisanslı). Çevrimdışı çalışsın diye Google Fonts'tan değil, yerel dosyadan yükle.
2. **İskelet:**
   - `Layout.tsx`: indeksli ray, komut çubuğu, durum çubuğundaki düşünüyor göstergesi.
3. **İmza bileşenler** (yeni dosyalar):

   | Bileşen | Dosya |
   |---|---|
   | Güven çubuğu | `components/Confidence.tsx` |
   | Karar izi | `components/Trace.tsx` |
   | Token şeridi | `components/TokenStrip.tsx` |
   | Adres | `components/Address.tsx` |
   | Çıkarım satırı | `components/Inference.tsx` |
   | Latent alan | `components/LatentField.tsx` |

4. **Sayfalar:** sırayla Akış, Onay, Pozisyonlar, Token Kontrol. En çok kullanılanlar önce.
5. **Tema seçimi:** Görünüm sayfasındaki tema kartlarına Latent'i varsayılan, eski sade temayı "Grafit" olarak ekle.

Kontrol listesi:
- [ ] ikon / emoji / ok yok,
- [ ] mor hiçbir yerde para anlamında değil,
- [ ] tüm sayılar mono,
- [ ] gövde metni kontrastı ≥ 4.5:1,
- [ ] `prefers-reduced-motion` açıkken latent alan ve daktilo efekti duruyor,
- [ ] "Al" yerine "Satın al" yazıyor.
