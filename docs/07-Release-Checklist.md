# Release Checklist

Bu belge Channel Foundry Studio + Web paketinin yerel doğrulanması ve yapılandırılmış bir hedefe yayınlanması için son kontrol listesidir.

## 1. Yerel doğrulama

Repo kökünde:

```bash
npm ci
npm run verify:release
```

Bu zincir Studio ve Web build'lerini, temel veri/yayın sözleşmelerini ve publication kontrollerini doğrular. Hata varsa deploy yapılmamalıdır.

## 2. Studio smoke testi

```bash
npm run start:studio
```

Kontrol edilecek ana akış:

- Studio sıfır veya mevcut yerel veriyle açılır.
- Video Arşivi kaynak kataloğunu gösterir.
- Altyazı ve AI Atölyesi akışı çalışır.
- `01 → 06` üretim aşamaları açılır.
- Editoryal onay ile AI önerisi birbirinden ayrıdır.
- Yayınlama ekranı local publication paketini oluşturabilir.

Public kaynak ağacında demo/gerçek Studio verisi bulunmamalıdır; test verisi çalışma sırasında yerelde üretilmelidir.

## 3. Web deploy öncesi

Önce build ve farkları doğrula:

```bash
npm run build:web
npm run deploy:web -- --dry-run
```

Deploy scripti için en az şu değişkenler açıkça tanımlanmış olmalıdır:

```bash
CHANNEL_FOUNDRY_DEPLOY_HOST=user@example.com
CHANNEL_FOUNDRY_DEPLOY_ROOT=/srv/www/site
```

HTTP smoke testi istenirse ayrıca:

```bash
CHANNEL_FOUNDRY_PUBLIC_URL=https://example.com
```

Script hiçbir gerçek production hedefini varsayılan olarak kullanmaz.

## 4. Korunan canlı içerik

Web kodu deploy edilirken Studio tarafından yönetilen şu alanlar korunmalıdır:

- `content/publication.json`
- `content/community-credits.json`
- `content/assets/`
- `*.bak-*`

Bu sınır sayesinde arayüz/API kodu güncellenirken editoryal publication paketi istemeden silinmez.

## 5. Web kodunu yayınla

```bash
npm run deploy:web
```

Script build, PHP syntax, SSH hedefi, staging alanı, uzak yedek ve rsync karşılaştırmasını yürütür. `CHANNEL_FOUNDRY_PUBLIC_URL` verilmişse sonunda HTTP smoke testi de yapılır.

GitHub Actions üzerinden deploy kullanılacaksa `.github/workflows/deploy-web.yml` yalnız manuel tetiklenir ve repository secrets içinde şu değerleri bekler:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PASSWORD`
- `DEPLOY_PATH`
- isteğe bağlı `PUBLIC_URL`

## 6. Studio içeriğini yayınla

Editoryal içerik veya görsel değiştiyse:

1. Hedef web bağlantısını Studio içinde doğrula.
2. Publication farklarını ve readiness durumunu kontrol et.
3. Taslak/ham çalışma verisinin public pakete girmediğini doğrula.
4. Yalnız onaylı publication paketini hedef sunucuya gönder.

AI önerileri kullanıcı onayı olmadan public içerik sayılmaz.

## 7. Canlı smoke testi

Hedef kurulumun sunduğu özelliklere göre en az:

- ana Web kabuğu,
- publication okuma akışı,
- arşiv/referans geçişleri,
- Community sağlık ucu,
- Studio publish sağlık ucu,
- desktop ve dar ekran davranışı

kontrol edilmelidir.

## 8. Public kaynak kontrolü

Bir public snapshot/repo üretmeden önce ayrıca şunlar kontrol edilmelidir:

- `local-data/` takip edilmiyor.
- `.env`, API anahtarı, parola veya gerçek hosting kimlik bilgisi yok.
- Gerçek kanal transkriptleri ve yerel SQLite dosyaları yok.
- Session devir notları, kişisel checkpoint'ler ve coding-agent oturum talimatları yok.
- Deploy dosyalarında gerçek production hostu, kullanıcı adı, uzak yol veya canlı URL için gömülü fallback yok.
- Repoya uygun lisans kararı ayrıca verilmiş.

## 9. Release candidate ölçütü

Aşağıdakilerin tamamı sağlandığında kaynak ağacı release candidate kabul edilebilir:

- `npm run verify:release` başarılı.
- Studio ana üretim zinciri uçtan uca çalışıyor.
- Public publication yalnız onaylı veriyi içeriyor.
- Web build ve yayın sözleşmesi doğrulanıyor.
- Yerel/özel çalışma verisi kaynak ağacına sızmıyor.
- Deploy hedefi kurulum sahibinin açık yapılandırmasına bağlı.
- Bilinen kritik veri kaybı hatası yok.
