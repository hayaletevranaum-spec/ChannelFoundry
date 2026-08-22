# Yerel Mimari ve Yayın

Bu belge Channel Foundry'nin yerel çalışma verisi, public yayın paketi ve sunucu sınırlarını tanımlar. Channel Foundry'ye özgü ürün dili korunurken, public kaynak ağacı herhangi bir gerçek hesap veya üretim sunucusuna bağlı değildir.

## Kaynakların Önceliği

Ürün ve mimari kararlarında `docs/` klasörü ana kaynaktır. Görsel örnekler atmosfer referansıdır; veri sözleşmesi ve ürün belgelerinin önüne geçmez.

## Web

Web sunum katmanıdır.

- Studio çalışmıyorken de çalışabilmelidir.
- Yerel SQLite veya yerel AI servislerine doğrudan bağlanmaz.
- Yalnız publication katmanında yayınlanmasına izin verilen içeriği tüketir.
- Community verisi ana editoryal publication verisinden ayrı tutulur.

## Studio

Studio local-first üretim merkezidir.

- Veri işlemleri yerel bilgisayarda yürür.
- AI anahtarları public web paketine gönderilmez.
- Kalıcı çalışma verisi SQLite üzerinde tutulabilir.
- Yerel veri, cache, transkript, AI config/debug ve görsel çalışma dosyaları `local-data/` altında yaşar ve Git kapsamı dışındadır.
- YouTube, altyazı, AI ve editoryal işlemler tek Studio üretim akışının parçalarıdır.

Ana üretim hattı:

```text
Video Arşivi
    ↓
Altyazılar
    ↓
AI Atölyesi
    ↓
01 Çözümleme
    ↓
02 Ayıklama
    ↓
03 Evrene İşleme
    ↓
04 İnceleme
    ↓
05 Hikâyeleştir
    ↓
06 Görsel Tamamlama
    ↓
Yayınlama
```

Varsayılan yerel veri yapısı:

```text
local-data/
├── studio/
│   ├── channel-foundry-studio.sqlite
│   ├── youtube-thumbnails/
│   ├── visual-assets/
│   ├── ai-config.json
│   ├── ai-debug/
│   └── public-export/
└── runtime/
```

Varsayılan kök `CHANNEL_FOUNDRY_DATA_ROOT` ile değiştirilebilir. Public kaynak dağıtımı hiçbir gerçek `local-data/` içeriği taşımaz.

## Kaynak Arşivi Sınırı

Kanalın video kataloğu ile public Evren aynı veri kümesi değildir.

Yerel kaynak arşivinde kanal metadata'sı, thumbnail cache, transkriptler, AI işleri ve editoryal taslaklar bulunabilir. Bunların tamamı public publication paketine çıkmaz. Bir kayıt ancak ilgili editoryal onay kapılarından geçtikten sonra yayın verisine dahil edilebilir.

## Community Veri Sınırı

Üyelik ve forum verileri public ziyaretçiler arasında ortak kullanıldığı için Studio'nun yerel SQLite dosyasından ayrıdır.

- Üyelik, oturum ve forum verileri sunucu tarafında ayrı bir depoda tutulur.
- Community deposu public web kökünden doğrudan indirilebilir olmamalıdır.
- Community API ana publication JSON'unu değiştirmez.
- Yetki gerektiren alanlar yalnız yetkili kullanıcıya döndürülür.

Örnek sunucu ayrımı:

```text
/srv/channel-foundry/
├── www/
│   ├── index.html
│   ├── assets/
│   ├── content/
│   └── api/
└── data/
    └── community.sqlite
```

Bu yalnız örnek dizilimdir; public repo belirli bir hosting sağlayıcısına veya hesaba bağlı değildir.

## Public Publication

Studio yerel çalışma verisinden temiz bir public paket üretir.

- Ham transkriptler, AI çalışma verisi, API anahtarları ve Studio'ya özel alanlar publication katmanına çıkmaz.
- Legacy Web için `universe.json` sözleşmesi korunabilir.
- Kitap teması `publication.json` schema v2 ve content-addressed asset yapısını kullanır.
- Stable `sectionId`, `entityId` ve `assetId` kimlikleri presentation katmanından bağımsızdır.
- Readiness ve yerel çalışma durumu public JSON'a karıştırılmaz.

Örnek yerel export:

```text
public-export/
└── content/
    ├── universe.json
    ├── publication.json
    └── assets/
```

## Yayınlama Sınırı

Kaynak repo gerçek production SSH hostu, kullanıcı adı, parola, web kökü veya canlı URL için varsayılan değer taşımaz.

Yerel deploy scripti açık yapılandırma ister:

```bash
export CHANNEL_FOUNDRY_DEPLOY_HOST=user@example.com
export CHANNEL_FOUNDRY_DEPLOY_ROOT=/srv/www/site
export CHANNEL_FOUNDRY_PUBLIC_URL=https://example.com

npm run deploy:web -- --dry-run
npm run deploy:web
```

`CHANNEL_FOUNDRY_DEPLOY_HOST` ve `CHANNEL_FOUNDRY_DEPLOY_ROOT` zorunludur. `CHANNEL_FOUNDRY_PUBLIC_URL` yalnız HTTP smoke testi için isteğe bağlıdır.

Deploy sırasında Studio tarafından yönetilen şu alanlar korunur:

- `content/publication.json`
- `content/community-credits.json`
- `content/assets/`
- sunucudaki `*.bak-*` dosyaları

GitHub Actions deploy workflow'u otomatik `main` push deploy'u yapmaz; yalnız manuel tetiklenir ve hedef bilgilerini repository secrets üzerinden bekler. Böylece fork veya yeni kurulumlar kendiliğinden bir production hedefine yazmaz.

## YouTube Kanal Otomasyonu

YouTube entegrasyonunun ana modeli yerel kanal kataloğudur.

- Katalog senkronizasyonu video dosyalarını indirmeden metadata üzerinden yapılabilir.
- Thumbnail cache yerelde tutulur.
- Bir kanal videosu editoryal Evren'e otomatik eklenmez.
- Kullanıcı kaynağı çalışmaya aldığında editoryal kayıtla ilişkilendirilir.
- Aynı video kimliğinin yanlışlıkla ikinci kez kaynaklaştırılması engellenir.

## Altyazı / Transkript

Transkriptler yerel çalışma verisidir.

- Public kaynak repoya veya publication paketine girmez.
- YouTube altyazısı `yt-dlp` ile alınabilir veya elle eklenebilir.
- Büyük arşivlerde işler tekrar çalıştırılabilir ve hata toleranslı olmalıdır.
- Bir videodaki hata toplu kuyruğun geri kalanını bozmamalıdır.

## Yerel AI Yardımcısı

AI Studio içindeki üretim yardımcısıdır.

- Renderer doğrudan API anahtarı taşımamalıdır.
- Yerel Ollama veya yapılandırılmış uyumlu sağlayıcı kullanılabilir.
- Sağlayıcı, endpoint, model ve anahtarlar yalnız yerel ayarlarda tutulur.
- AI çıktısı doğrudan editoryal gerçek veya public içerik değildir.
- Kullanıcı onayı olmadan içerik kendiliğinden yayın durumuna geçmez.

## Üretim Sınırı

Ana hedef teknoloji eklemek değil; büyük kaynak arşivinin kaynak → çözümleme → editoryal karar → anlatı → publication zincirinde izlenebilir ve sürdürülebilir biçimde yönetilmesidir.
