<div align="center">

# Egehan

**Bir projenin soğuk `git log` geçmişini yaşayan bir kroniğe dönüştürür — çevrimdışı, deterministik, API anahtarı yok.**

[![Lisans: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-black.svg)](package.json)
[![.NET](https://img.shields.io/badge/.NET-8%20%7C%2010-black.svg)](packages/dotnet-tool)

[English](README.md) · [Mimari](docs/ARCHITECTURE.md) · [Katkı](CONTRIBUTING.md)

</div>

---

Her deponun içinde zaten bir hikaye vardır: bir yarış koşulunun sabaha karşı nihayet köşeye sıkıştırıldığı
gece, her şeyin aynı hafta bozulduğu dönem, bin satır silip projeyi daha iyi hâle getiren commit. `git log`
bunların hepsini kaydeder ve hiçbirini anlatmaz.

Egehan bu geçmişi okur ve hikayeyi yazar: commit'leyebileceğiniz bir Markdown kroniği ve her yerde
açılabilen, tek dosyalık interaktif bir HTML zaman tüneli. Tamamen sizin makinenizde çalışır — **yapay
zeka yok, API anahtarı yok, ağ erişimi yok** — ve aynı commit her zaman aynı cümleyi üretir.

## Neden yapay zeka yok

Bir hatıra on yıl sonra da, uçakta da, hiçbir yere yüklenmesine izin verilmeyen bir depoda da çalışmalı.
Bu yüzden anlatım bir model değil, commit verisi üzerinde çalışan bir kural motorudur:

- **Deterministik.** Seçilen cümle `parseInt(sha[0..8], 16) % kalıpSayısı` ile belirlenir. Aracı tekrar
  çalıştırmak geçmişi yeniden yazmaz; üretilen dosyalar temiz ve gözden geçirilebilir diff verir.
- **Çevrimdışı.** Hiçbir istek atılmaz. Deponuza dair hiçbir şey makinenizden çıkmaz.
- **Varsayılan olarak gizli.** Yazar e-posta adresleri, kimse kazara yayınlayamadan önce üretilen
  dosyalardan maskelenir.
- **Denetlenebilir.** Tüm eşik değerleri kodun içine dağılmış hâlde değil, tek bir okunabilir JSON
  dosyasında durur.

## Ne üretir

**Sınıflandırılmış ve anlatılmış bir geçmiş.** Her commit altı bölümden birine yerleşir — `Doğuş`,
`İlk Adımlar`, `Büyüme Sancıları`, `Gece Mesaisi`, `Dönüm Noktası`, `Olgunlaşma` — ve üç tondan biriyle
(`poetic`, `minimalist`, `humorous`) Türkçe veya İngilizce anlatılır.

```text
Ham:     fix: token refresh race condition   (2026-03-14 03:18, 4 dosya, +85/-42)

Poetik:  14 Mart gecesi saat 03:18 sularında, herkes uyurken 4 dosyada titiz bir
         çalışma yapıldı; «token refresh race condition» ile sistemin nefesi düzeltildi.
```

**Geliştirici Nabzı.** Kodlama kronotipi (Gece Kuşu, Sabah Mimarı, …), en verimli gün ve saat, üretilen
koda karşı iyileştirilen kod oranı ve en uzun kesintisiz commit seriniz.

**Yaşayan bir kronik.** Bir kez `egehan hook install` dersiniz; sonraki her commit hikayeyi sessizce
günceller. VS Code ve Visual Studio'da durum çubuğu nabzı görünür tutar, dönüm noktaları kendini duyurur.

Üretilmiş bir örnek [docs/example-chronicle.md](docs/example-chronicle.md) dosyasında duruyor — uyum
fixture'ından aracın kendisi tarafından üretiliyor, yani her zaman güncel motorun gerçek çıktısıdır.

## Projenin durumu

Egehan fazlar hâlinde geliştiriliyor. Bu tablo her fazın dürüst durumudur; hiçbir şey testleri yazılmadan
"bitti" olarak işaretlenmez.

| Faz | Teslim                                                                             | Durum     |
| --- | ---------------------------------------------------------------------------------- | --------- |
| 1   | `core-spec` — rapor şeması, motor kuralları, anlatı sözlükleri, uyum fixture'ları  | **bitti** |
| 1   | `egehan` npm CLI — git okuyucu, hikaye motoru, Markdown üreteci, Geliştirici Nabzı | **bitti** |
| 1   | `egehan-book.html` — tek dosyalık interaktif zaman tüneli, saf SVG, çevrimdışı     | **bitti** |
| 1   | `egehan capsule` — parolayla mühürlenen, tarayıcıda Web Crypto ile açılan mesaj    | **bitti** |
| 1   | `egehan hook install` — kendini güncel tutan kronik                                | **bitti** |
| 2   | VS Code eklentisi — durum çubuğu, zaman tüneli paneli, dönüm noktası bildirimleri  | planlandı |
| 3   | `Egehan.Cli` .NET global tool (`net8.0` + `net10.0`)                               | planlandı |
| 4   | Visual Studio 2022+ eklentisi (VSIX)                                               | planlandı |

## Komut sözleşmesi

Node CLI ve .NET aracı aynı yüzeyi sunar; React önyüzü ve .NET arka ucu olan bir ekip iki ayrı araç
öğrenmek zorunda kalmamalı:

```bash
egehan init                                  # etkileşimli kurulum, .egehanrc.json yazar
egehan generate --format both                # EGEHAN.md + egehan-chronicle.html
egehan generate --since v1.0.0 --output docs # kendine ait bir bölüm
egehan hook install                          # kroniği her commit'te güncel tut
egehan hook status                           # kancalar nerede, sahibi kim
egehan hook uninstall                        # kaldır, diğer kancalarına dokunma
egehan stats                                 # Geliştirici Nabzı, terminalde
egehan capsule --unlock-date 2044-02-01      # parolayla mühürlenmiş, geleceğe mektup
```

## Depo yapısı

```text
packages/core-spec     # yalnızca veri: şema, kurallar, sözlükler, HTML şablonu, fixture'lar
packages/node-cli      # `egehan` npm paketi
packages/dotnet-tool   # Egehan.Core + Egehan.Cli (NuGet global tool)
extensions/            # VS Code eklentisi ve Visual Studio VSIX
docs/ARCHITECTURE.md   # yukarıdakilerin ardındaki kararlar ve gerekçeleri
```

Kurallar ve anlatı kalıpları `core-spec` içinde **kod değil, veri** olarak durur; böylece iki motordan
biri sessizce spesifikasyona dönüşüp diğeri geride kalamaz. Gerekçesi:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Kendi dilinizi ekleme

`core-spec/dictionary/` her dil için bir JSON dosyası tutar. `narratives.en.json` dosyasını kopyalayın,
çevirin, `npm run spec:validate` komutunu çalıştırın; her iki motor da hiçbir kod değişikliği olmadan
dilinizi tanır. Doğrulayıcı, yapısı referanstan sapan ya da motorun sağlamadığı bir değişkeni kullanan
dosyaları reddeder.

## Zaman kapsülü hakkında

`egehan capsule` bir mesajı parolayla şifreler (PBKDF2-SHA-256, 600.000 iterasyon → AES-256-GCM) ve HTML
zaman tüneli açılma tarihine geri sayar. Bunun ne anlama geldiği konusunda net olalım: **geri sayım bir
ritüel, parola ise kilidin kendisidir.** Şifreli metin, yayınlayabileceğiniz bir dosyanın içinde seyahat
eder; dolayısıyla dosyanın kendi başına çözebildiği her şeyi, onu okuyan herkes de çözebilir. Parolasız
bir kapsül modunun hiç var olmamasının sebebi tam olarak budur. Kapsül dosyaları varsayılan olarak git
tarafından izlenmez.

## Lisans

MIT — [LICENSE](LICENSE) dosyasına bakın.
