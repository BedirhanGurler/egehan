# Yayınlama — adım adım

Bu belge, Egehan'ı üç yere birden yayınlamak için ne yapmanız gerektiğini sırayla anlatır.
İngilizcesi ve geri alma kuralları [RELEASING.md](../RELEASING.md) içinde.

Üç paket, tek sürüm, tek etiket:

| Ne               | Nerede              | Adı                            |
| ---------------- | ------------------- | ------------------------------ |
| CLI              | npm                 | `egehan`                       |
| CLI              | NuGet               | `Egehan.Cli`                   |
| Editör eklentisi | VS Code Marketplace | `bedirhangurler.egehan-vscode` |

Yayınlamayı başlatan tek şey **bir git etiketi**. Normal bir `git push` hiçbir yere bir şey
göndermez.

---

## 0. Önce bir kez: hesaplar ve anahtarlar

Bu bölümü yalnızca ilk sürümden önce yapıyorsunuz. Üç anahtar üretip GitHub'a gireceksiniz.

### 0.1 npm anahtarı

1. [npmjs.com](https://www.npmjs.com/) adresinde hesap açın.
2. Hesap ayarlarından **iki adımlı doğrulamayı açın.** npm, yayın yapan hesaplarda bunu zaten
   zorunlu tutuyor.
3. Sağ üstteki avatara tıklayın → **Access Tokens** → **Generate New Token** → **Granular Access
   Token**.
4. Şunları seçin:
   - **Expiration**: istediğiniz süre (90 gün makul; dolduğunda yenilersiniz)
   - **Packages and scopes** → **Read and write**
   - Paket seçimi: `egehan` henüz yayınlanmadığı için listede **görünmez**. Bu yüzden ilk sürümde
     **All packages** seçin. İlk yayından sonra token'ı yalnızca `egehan` ile sınırlayan yenisiyle
     değiştirebilirsiniz.
5. Üretilen token'ı kopyalayın. **Sayfadan çıkınca bir daha göremezsiniz.**

### 0.2 NuGet anahtarı

1. [nuget.org](https://www.nuget.org/) adresinde hesap açın (Microsoft hesabıyla giriş yapılıyor).
2. İki adımlı doğrulamayı açın.
3. Sağ üstteki kullanıcı adınıza tıklayın → **API Keys** → **Create**.
4. Şunları doldurun:
   - **Key Name**: `egehan-release` (sizin için, önemli değil)
   - **Select Scopes**: **Push** → **Push new packages and package versions**
   - **Select Packages** → **Glob Pattern**: `Egehan.*`
5. **Create** deyip anahtarı kopyalayın. Bu da bir kez gösteriliyor.

### 0.3 VS Code Marketplace: yayıncı + Trusted Publishing

Burada **anahtar üretmiyorsunuz.** Marketplace, GitHub Actions'ın kimliğini OIDC ile doğruluyor;
saklanacak, süresi dolacak bir token yok. (Azure DevOps'un global PAT'leri 1 Aralık 2026'da
emekliye ayrıldı; yeni bir Azure DevOps organizasyonu açmak da artık ücretli bir Azure aboneliği
istiyor. Bu yol ikisini birden ortadan kaldırıyor.)

1. Yayıncıyı oluşturun:
   [marketplace.visualstudio.com/manage/createpublisher](https://marketplace.visualstudio.com/manage/createpublisher)
   — Microsoft hesabıyla giriliyor, Azure DevOps organizasyonu gerekmiyor.
   - **ID**: `bedirhangurler` ← bu alan `extensions/vscode-extension/package.json` içindeki
     `publisher` değeriyle **harfi harfine** aynı olmalı, yoksa yayın reddedilir
   - **Name**: görünen adınız (serbest)
2. Yayıncı panelinde sol menüden **Trusted Publishing** → **Create** bölümünü açın ve doldurun:

   | Alan             | Değer              |
   | ---------------- | ------------------ |
   | Policy name      | `Release workflow` |
   | Repository owner | `BedirhanGurler`   |
   | Repository       | `egehan`           |
   | Workflow         | `release.yml`      |
   | Environment      | boş bırakın        |

3. **Create** deyin. Depo herkese açık olduğu için politika hemen geçerli. (Özel depolarda
   politika 48 saat içinde kullanılmazsa iptal oluyor.)

İş akışındaki `vscode` işi `id-token: write` izniyle çalışıp `vsce publish --oidc` komutunu
kullanıyor; Marketplace'in verdiği geçici kimlik 15 dakika yaşıyor.

### 0.4 İki anahtarı GitHub'a girin

GitHub'da depoya gidin → **Settings** → sol menüde **Secrets and variables** → **Actions** →
**New repository secret**. İki kez tekrarlayın:

| Name (birebir bu) | Secret                          |
| ----------------- | ------------------------------- |
| `NPM_TOKEN`       | 0.1'de aldığınız npm token'ı    |
| `NUGET_API_KEY`   | 0.2'de aldığınız NuGet anahtarı |

> İsimleri değiştirmeyin. İş akışı tam olarak bu iki adı arıyor. VS Code tarafı için gizli
> anahtar yok; 0.3'teki politika yeterli.

---

## 1. Provayı çalıştırın

Gerçek yayından önce bir kuru prova yapın. Hiçbir yere bir şey gönderilmez.

1. GitHub'da depoda **Actions** sekmesi → sol listeden **Release**.
2. Sağda **Run workflow** düğmesi → `dry-run` kutusu **işaretli** kalsın → **Run workflow**.
3. Koşu bitince (5–10 dakika) yeşil olduğundan emin olun.
4. Koşu sayfasının en altındaki **Artifacts** bölümünden `nuget` ve `vsix` dosyalarını indirin.

İndirdiklerinizi yerelde deneyin:

```bash
code --install-extension egehan.vsix
```

```bash
dotnet tool install -g --add-source . Egehan.Cli
```

Çalıştığını gördükten sonra temizleyin:

```bash
dotnet tool uninstall -g Egehan.Cli
```

---

## 2. Gerçek yayın

Prova yeşilse sıra asıl sürümde. Dört komut.

**Adım 1 — sürüm numarasını üç manifestte birden ayarlayın:**

```bash
node scripts/set-version.mjs 0.1.0
```

> Üçü zaten `0.1.0`, yani bu komut şimdilik bir şeyi değiştirmeyecek ve bunu size söyleyecek.
> İleride `0.2.0` yapacağınız zaman tek yapmanız gereken bu komut. Elle üç dosya düzenlemeyin —
> iş akışı üçü etiketle aynı değilse yayını reddediyor.

**Adım 2 — değişiklikleri yazın:**

`CHANGELOG.md` dosyasını açın, en üstteki `## [0.1.0] — unreleased` satırındaki `unreleased`
yerine bugünün tarihini yazın:

```text
## [0.1.0] — 2026-11-21
```

**Adım 3 — commit'leyin:**

```bash
git add -A
```

```bash
git commit -m "chore(release): 0.1.0"
```

**Adım 4 — etiketleyip gönderin:**

```bash
git tag v0.1.0
```

```bash
git push origin main --follow-tags
```

Bu son komut yayını başlatır. `--follow-tags` hem commit'i hem etiketi gönderir; etiketi
göndermezseniz hiçbir şey olmaz.

---

## 3. Sonrasında ne olacak

Etiket GitHub'a ulaşınca **Release** iş akışı kendiliğinden başlar ve şu sırayla ilerler:

1. **verify** — bütün testleri koşar (253 test), biçimi denetler, üç manifestin etiketle aynı
   sürümü söylediğini doğrular. Burada bir şey kırmızıysa **hiçbir şey yayınlanmaz.**
2. **npm** — `egehan` paketini provenance imzasıyla yayınlar
3. **nuget** — `Egehan.Cli` paketini gönderir
4. **vs code marketplace** — eklentiyi yayınlar
5. **github release** — `v0.1.0` sürümünü oluşturur, `.nupkg` ve `.vsix` dosyalarını ekler

Actions sekmesinden canlı izleyebilirsiniz. Bittiğinde şunları kontrol edin:

```bash
npm view egehan
```

```bash
npx egehan --version
```

```bash
dotnet tool install -g Egehan.Cli
```

- **npm sayfası**: [npmjs.com/package/egehan](https://www.npmjs.com/package/egehan) — README
  görünüyor mu, yanında yeşil **Provenance** rozeti var mı
- **NuGet**: [nuget.org/packages/Egehan.Cli](https://www.nuget.org/packages/Egehan.Cli) — ilk
  yayından sonra aramada çıkması 10–15 dakika sürebilir, panik yok
- **Marketplace**: eklenti sayfasında simge, README ve ekran görüntüleri yerinde mi
- **Son kontrol**: Egehan'ın kendi deposu dışında bir projede `npx egehan` çalıştırın

---

## 4. Bir şey ters giderse

| Belirti                                                   | Sebebi genelde                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **verify** kırmızı, "X is 0.1.0 but the release is 0.2.0" | Etiketi attınız ama `set-version.mjs` çalıştırmadınız                        |
| **npm** adımı 403 veriyor                                 | Token süresi dolmuş veya paket kapsamı dışında                               |
| **vs code** adımı 401 veriyor                             | PAT "All accessible organizations" seçilmeden üretilmiş, ya da süresi dolmuş |
| **vs code** adımı "publisher not found"                   | Marketplace yayıncı ID'si `bedirhangurler` değil                             |
| **nuget** adımı sessizce geçiyor ama paket görünmüyor     | İndeksleme gecikmesi — 15 dakika bekleyin                                    |

Yanlış bir sürüm yayınlandıysa, geri alma kuralları her registry'de farklı ve hiçbiri "geri al"
düğmesi değil:

- **npm**: 72 saat içinde `npm unpublish egehan@0.1.0` mümkün. Sonrası için `npm deprecate` ve
  yama sürümü.
- **NuGet**: bir sürüm **asla silinemez.** `dotnet nuget delete` yalnızca listeden kaldırır,
  kurulabilir kalır. Tek çözüm yama sürümü yayınlamak.
- **VS Code Marketplace**: sürüm kaldırılabilir, sayfada geçmiş kalır.

İş akışının yayınlamadan önce bütün testleri koşmasının sebebi tam olarak bu: üçten ikisinde
yayın, yere değdiği anda kalıcı.

---

## 5. Sonraki sürümler

Birincisinden sonrası çok daha kısa:

```bash
node scripts/set-version.mjs 0.2.0
```

```bash
git add -A && git commit -m "chore(release): 0.2.0" && git tag v0.2.0 && git push origin main --follow-tags
```

Anahtarları tekrar üretmeniz gerekmez — süreleri dolana kadar.
