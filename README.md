# Channel Foundry

Channel Foundry, uzun soluklu video arşivlerini **yerel-first bir editoryal üretim hattı** ile işleyip kontrollü bir public yayına dönüştürmek için geliştirilen bağımsız bir Studio + Web projesidir.

Local-first bir content workspace olarak çalışır: Studio yerel veriyi yönetir, AI destekli çözümleme ve editoryal iş akışlarını yürütür, onaylanan içerik kontrollü bir public pakete yayınlanır. Web katmanı bu yayın paketini sunar ve YouTube dahil harici kaynaklardan genel içerik alımını (content ingestion) destekler. Public kaynak ağacı herhangi bir gerçek çalışma verisi, hesap bilgisi, API anahtarı veya üretim sunucusu hedefi içermez.

## Mimari

- **Studio (`apps/studio`)** — Electron tabanlı yerel üretim uygulaması. Video kataloğu, altyazı, AI çözümleme, editoryal ayıklama, Evren işleme, inceleme, anlatı, görsel tamamlama ve yayın hazırlığı burada yürür.
- **Web (`apps/web`)** — Onaylanmış publication paketini ziyaretçiye sunan React/Vite arayüzü ve gerekli PHP uçları.
- **Domain (`packages/domain`)** — Studio ile Web arasındaki ortak yayın sözleşmeleri.
- **Dokümantasyon (`docs`)** — Ürün kimliği, veri modeli, anlatı akışı, tema sözleşmesi ve yayın mimarisi.

Studio üretim hattı:

`01 Çözümleme → 02 Ayıklama → 03 Evrene İşleme → 04 İnceleme → 05 Hikâyeleştir → 06 Görsel Tamamlama → Yayınlama`

AI çıktısı doğrudan public içerik değildir. Yayınlanacak veri editoryal onay ve publication sınırlarından geçer.

## İlk çalıştırma

Önerilen ortam:

- Node.js 22+
- npm
- YouTube katalog/transkript özellikleri için isteğe bağlı `yt-dlp`
- AI özellikleri için yerel Ollama veya yapılandırılmış uyumlu bir sağlayıcı

```bash
npm ci
npm run verify:release
npm run start:studio
```

Web'i yerelde çalıştırmak için:

```bash
npm run dev:web
```

Studio ilk çalıştırmada yerel veri kökünü oluşturur. Varsayılan konum:

```text
local-data/studio/
```

Başka bir konum kullanılabilir:

```bash
CHANNEL_FOUNDRY_DATA_ROOT=/mutlak/yol npm run start:studio
```

## Public kaynak / yerel veri sınırı

Aşağıdakiler kaynak repoya dahil edilmez:

- Studio SQLite veritabanları
- gerçek kanal katalogları ve transkriptleri
- yerel görsel çalışma dosyaları
- AI ayarları, API anahtarları ve debug çıktıları
- `.env` dosyaları
- hosting kimlik bilgileri ve üretim sunucusu hedefleri

`local-data/` bütünüyle çalışma alanıdır ve Git tarafından yok sayılır. Public kopya bu nedenle sıfır veriyle başlar; içerik kendi Studio kurulumunda oluşturulur.

## Doğrulama

Tam yerel doğrulama:

```bash
npm run verify:release
```

Web odaklı kontroller ayrıca çalıştırılabilir:

```bash
npm run verify:book-theme
npm run build:web
npm run verify:web-dist
```

## Yayınlama

Web deploy scripti herhangi bir canlı hesaba gömülü değildir. SSH hedefi ve uzak web kökü açıkça verilmelidir:

```bash
export CHANNEL_FOUNDRY_DEPLOY_HOST=user@example.com
export CHANNEL_FOUNDRY_DEPLOY_ROOT=/srv/www/site
export CHANNEL_FOUNDRY_PUBLIC_URL=https://example.com

npm run deploy:web -- --dry-run
npm run deploy:web
```

`CHANNEL_FOUNDRY_PUBLIC_URL` verilmezse script uzak dosya doğrulamasını yapar, HTTP smoke testini atlar.

GitHub Actions içindeki deploy workflow'u da bilerek yalnız manuel çalıştırılır ve hedef bilgilerini repository secrets üzerinden bekler. Böylece fork veya yeni public kurulumlar bir `main` push'unda istemeden bir üretim ortamına yayın yapmaz.

## Dokümantasyon

Başlangıç için:

- `docs/00-Vizyon.md`
- `docs/04-Studio-Tasarim-Rehberi.md`
- `docs/05-Anlati-Katmani-ve-Yasatma-Akisi.md`
- `docs/06-Web-Tema-Veri-Sozlesmesi.md`
- `docs/06-Yerel-Mimari-ve-Yayin.md`
- `docs/07-Release-Checklist.md`
- `docs/identity.md`

Public kaynak ağacı ürün ve mimari belgeleri taşır; tarihsel session devir notları, kişisel çalışma checkpoint'leri ve coding-agent oturum talimatları dağıtımın parçası değildir.
