# BirDeSenGör — Web Tema Veri Sözleşmesi

Son güncelleme: **14 Ağustos 2026**

Bu belge, `birdesengor` Studio/Hikâyeleştir hattı ile ayrı geliştirilen `book-theme` projesi arasındaki **uygulanmış publication v2 sözleşmesini** tanımlar.

Amaç iki projenin kod olarak bağımsız kalması, fakat veri şekli bakımından kesin bir contract üzerinden birlikte çalışmasıdır.

## 1. Temel ayrım

**Studio içerik üreticisidir; tema sunum/render motorudur.**

Studio şunları üretir:

- kronolojik anlatı bölümleri,
- anlatı içindeki açık Evren referansları,
- karakter/mekân/obje/olay/hikâye arşiv verileri,
- relation kayıtları,
- provenance ve kaynak video kimlikleri,
- görsel `assetId` ve semantik rol bilgileri,
- publication ID ve content fingerprint.

Tema şunları belirler:

- kapalı kitabın görünümü ve açılma animasyonu,
- gerçek sayfa çevirme mekaniği,
- masaüstü çift sayfa / mobil tek sayfa düzeni,
- fiziksel sayfalama,
- hover kart animasyonu,
- günlükten arşiv dosyasına fiziksel geçiş,
- `Günlükte kaldığım yere dön` render state'i,
- sağ kenardaki fiziksel kategori ayraçları,
- görsellerin sayfadaki kesin yerleşimi.

**Studio fiziksel page/spread numarası yayınlamaz.** Responsive pagination temanın sorumluluğudur.

## 2. Stable ID kuralı

Tema hiçbir içeriği başlığa veya görünen metne göre bağlamaz.

- Anlatı bölümü: `sectionId`
- Evren/arşiv kaydı: `entityId`
- Relation: `relationId`
- Görsel: `assetId`

Başlık, isim, özet veya physical page değişse bile stable ID ilişki/navigasyon kimliği olarak kalır.

Bu kural özellikle:

- günlükte kaldığım yere dön,
- inline referanstan arşive git,
- hover mini kart,
- relation navigasyonu,
- haftalık yeni yayınlarda eski bookmark/state'in bozulmaması

için zorunludur.

## 3. Physical transport — bugün uygulanan yapı

Legacy Web için:

`content/universe.json`

korunmaktadır.

Yeni kitap teması için:

`content/publication.json`

kullanılır.

Görsel dosyalar:

`content/assets/...`

altında publication ile birlikte export edilir.

Yerel export bugün iki contract'ı aynı anda üretir:

```text
public-export/
└── content/
    ├── universe.json       # schema v1 · mevcut Web
    ├── publication.json    # schema v2 · kitap teması
    └── assets/             # publication v2 görselleri
```

Tema bileşenleri doğrudan fiziksel dosya yoluna bağlanmamalı; bir content adapter/provider üzerinden veri okumalıdır.

## 4. Publication v2 üst şekli — uygulanmış contract

```json
{
  "schemaVersion": 2,
  "publication": {
    "id": "pub-...",
    "generatedAt": "2026-08-14T00:00:00.000Z",
    "contentFingerprint": "sha256..."
  },
  "journal": {
    "sections": []
  },
  "archive": {
    "entities": [],
    "relations": []
  },
  "assets": []
}
```

`schemaVersion` tema ile Studio arasındaki compatibility sınırıdır.

`publication.id`, semantik public içeriğin fingerprint'inden türetilen stable snapshot kimliğidir.

`contentFingerprint` şunları kapsar:

- journal içeriği,
- archive içeriği,
- relation içeriği,
- asset metadata,
- görsel binary hash'leri.

Aynı semantik içerik tekrar export edilirse fingerprint rastgele değişmemelidir.

## 5. Workflow readiness public JSON değildir

Studio builder ayrıca workflow için readiness döndürür:

- `narrativeSections`
- `narrativeChangesPending`
- `visualComplete`
- `readyForTheme`

Bu alanlar **`publication.json` içine yazılmaz**.

Tema public içerik sözleşmesini okur; editoryal workflow state'i tema verisine karıştırılmaz.

Yayınlama ekranı readiness'i Studio içinde ayrıca gösterir.

## 6. Journal section sözleşmesi

Her anlatı bölümü physical page değil semantik içerik birimidir.

```json
{
  "sectionId": "narrative-section-...",
  "revision": 3,
  "order": 120,
  "title": "...",
  "blocks": [],
  "sourceKeys": ["universe-story-..."],
  "sourceVideoIds": ["youtube-video-id"],
  "media": []
}
```

Kurallar:

- `sectionId`: revizyonlar boyunca stable.
- `revision`: bölüm revizyon numarası.
- `order`: anlatı sırası; physical page numarası değildir.
- `sourceKeys`: bölümün dayandığı frozen approved Universe kaynakları.
- `sourceVideoIds`: provenance zincirini korur.
- `media`: layout değil semantic asset bağlantılarıdır.

Tema `order` değerini içerik sırası için kullanabilir; bunu page number kabul etmemelidir.

## 7. Structured blocks ve inline reference

Anlatı serbest HTML veya sonradan regex ile bulunan entity isimlerine bağlı değildir.

Paragraph örneği:

```json
{
  "type": "paragraph",
  "spans": [
    { "type": "text", "text": "Araştırma sırasında " },
    {
      "type": "reference",
      "entityId": "universe-object-abc123",
      "label": "Babil Taşı"
    },
    { "type": "text", "text": " yeniden karşıma çıktı." }
  ]
}
```

Desteklenen temel span türleri:

- `text`
- `emphasis`
- `reference`

Tema `reference.entityId` üzerinden hover kartı ve arşiv geçişini başlatır.

**Tema düz metinden entity adı regex ile bulmamalıdır.**

## 8. Entity reference provenance kuralı

Hikâyeleştir AI yeni entity uyduramaz.

Bir section içindeki her inline:

```json
{ "type": "reference", "entityId": "...", "label": "..." }
```

şu iki koşulu sağlar:

1. `entityId` frozen approved Universe node'una çözülür.
2. Aynı `entityId` o section'ın `sourceKeys` listesinde açıkça bulunur.

Bu nedenle tema reference'ı güvenilir stable link olarak kabul edebilir.

## 9. Archive entity sözleşmesi

Ana kind değerleri:

- `character`
- `location`
- `object`
- `event`
- `story`

Tema ilk sürümde farklı fiziksel kart şablonları kullanabilir; veri katmanı üç türe kilitlenmez.

Örnek:

```json
{
  "entityId": "universe-character-...",
  "kind": "character",
  "name": "...",
  "aliases": [],
  "summary": "...",
  "sourceVideoIds": [],
  "details": [],
  "relations": [],
  "visual": {
    "assetId": "asset-character-..."
  }
}
```

`visual` boş olabilir. Archive entity'nin görseli olmaması entity'nin geçersiz olduğu anlamına gelmez.

Hover mini kartı için ayrı kopya içerik zorunlu değildir. Tema `name + kind + summary + visual.assetId` alanlarından mini görünümü kurabilir.

## 10. Archive relation sözleşmesi

Relation kayıtları approved Universe relations üzerinden yayınlanır.

Logical şekil:

```json
{
  "relationId": "relation-...",
  "fromEntityId": "...",
  "toEntityId": "...",
  "label": "bağlantılı",
  "sourceVideoIds": []
}
```

Tema relation target'ını isimle değil `fromEntityId / toEntityId` ile çözer.

Entity içindeki `relations` alanı relation ID listesi taşır.

## 11. Görsel Tamamlama sözleşmesi

Görsel üretim **Hikâyeleştir onayından sonra** yapılır.

Semantic roller:

- `scene`
- `portrait`
- `location`
- `artifact`
- `supporting`

Studio exact CSS/koordinat üretmez.

Asset örneği:

```json
{
  "assetId": "asset-...",
  "type": "image",
  "role": "portrait",
  "entityId": "universe-character-...",
  "url": "assets/asset-...-91df3a02c854.webp",
  "alt": "...",
  "sha256": "...",
  "bytes": 123456,
  "provenance": {
    "source": "...",
    "provider": "...",
    "model": "..."
  }
}
```

Scene asset'lerinde `sectionId`, entity asset'lerinde `entityId` bulunabilir.

## 12. Content-addressed asset URL kuralı

`assetId` stable kimliktir.

Fakat aynı logical asset'in binary dosyası değişirse browser cache'in eski dosyayı göstermemesi gerekir. Bu nedenle fiziksel URL dosya adına binary hash parçası eklenir:

```text
assets/<assetId>-<sha-prefix>.webp
```

Sonuç:

- entity/section link'i stable `assetId` ile kalır,
- binary değişirse URL değişir,
- cache busting doğal olur.

Tema asset lookup'u URL string'ini identity olarak kullanmamalıdır; `assetId` kullanmalıdır.

## 13. Revision-bound scene kuralı

Her active approved narrative revision kendi `scene` kararına sahiptir.

Scene state:

- `pending`
- `ready`
- `skipped`

Kullanıcı sahne üretebilir, manuel ekleyebilir veya açıkça görselsiz bırakabilir.

Bir narrative section yeni revision aldığında **eski scene yeni revision'a sessizce taşınmaz**.

Bu davranış metin/görsel uyumsuzluğunu önlemek için bilinçlidir.

Entity visual profile'ları ise reusable'dır; aynı karakter/mekân/nesne birden fazla section'da tekrar kullanılabilir.

## 14. Figure/media davranışı

05 · Hikâyeleştir AI aşamasında AI'nin:

- `figure`
- `media`
- `assetId`

üretmesi yasaktır.

Görsel bağlama 06 · Görsel Tamamlama aşamasında yapılır.

Publication builder section `media` içine semantic scene asset'i ekleyebilir.

Structured content modeli future/manuel figure block'u destekler; ancak publication sırasında figure/media içindeki her `assetId` gerçek exported asset'e çözülmek zorundadır. Çözülemeyen asset publication hatasıdır.

## 15. Tema davranışlarının veri bağımlılığı

### Kapalı günlük / sinematik açılma / page-turn

Tamamen tema.

### Desktop double-page / mobile single-page

Tamamen tema. Studio spread üretmez.

### Hover mini kart

Studio `entityId`, `kind`, `name`, `summary`, opsiyonel `visual.assetId` sağlar. Tema interaction'ı yapar.

### Referansa tıklayıp kitabın arkasındaki dossier'e geçiş

Studio explicit `entityId` yayınlar. Tema navigasyon/animasyonu yapar.

### Günlükte kaldığım yere dön

Tema geçiş öncesi `sectionId` + kendi render anchor/state bilgisini saklar. Physical page number saklamak contract değildir.

### Sağ kenar kategori ayraçları

Tema `kind` değerlerini kendi kategori UI'sine map eder. Veri contract'ı sabit üç kategoriye kilitlenmez.

### Exact image placement

Tema sorumluluğudur. Studio yalnız role/asset ilişkisi verir.

## 16. Hikâyeleştir → Tema pipeline

Bugünkü gerçek akış:

`Approved Universe → Narrative prepare → AI structured draft → Editoryal inceleme/onay → Görsel Tamamlama → Publication v2 → Tema`

AI output düz uzun metin değildir; structured section draft'tır.

AI fiziksel pagination bilgisi üretmez.

## 17. Stale ve revision davranışı

Prepared Hikâyeleştir run'ından sonra approved Universe değişirse run stale olur.

Stale run:

- draft save/apply sırasında reddedilir,
- editoryal olarak onaylanamaz.

Onaylı/yayınlanmış section sessizce overwrite edilmez. Aynı `sectionId` altında yeni revision oluşur.

Tema açısından sonuç:

- bookmark/geri dönüş identity'si korunur,
- içerik güncellenebilir,
- fiziksel page sayısı tamamen değişse bile stable navigation bozulmaz.

## 18. Tema reposu için adapter kuralı

Tema gerçek Studio olmadan fixture ile geliştirilebilir.

Önerilen adapter API:

- `getJournalSections()`
- `getEntity(entityId)`
- `getEntityCard(entityId)`
- `getRelations(entityId)`
- `getAsset(assetId)`

React bileşenleri ham `publication.json` objesine doğrudan bağımlı olmamalıdır.

Önce fixture schema v2 ile bu adapter doğrulanmalı, sonra physical transport olarak gerçek `content/publication.json` bağlanmalıdır.

Bu sayede ileride tek JSON parçalanıp `journal.json`, `archive/...` gibi dosyalara ayrılsa presentation bileşenleri değişmek zorunda kalmaz.

## 19. Mevcut canlı yayın sınırı

Bugün mevcut canlı Web upload protokolü **schema v1** içindir.

Yayınlama ekranında:

- `Mevcut Web'i canlıya yayınla` → schema v1,
- `Yerel paketi oluştur` → v1 + v2 local paket,
- Publication v2 → readiness/local export görünürlüğü,
- **v2 live upload → henüz bağlı değil**.

Kitap teması için live transport gerektiğinde ayrı v2 endpoint/deploy tasarlanmalıdır.

Mevcut schema-v1 endpoint'i publication v2 için sessizce değiştirilmemelidir.

## 20. Şimdilik özellikle Studio'da kilitlenmemesi gerekenler

Tema sahibi olduğu için Studio tarafında şu kararlar verilmemelidir:

- gerçek page boyutu,
- spread başına kelime/karakter sınırı,
- görselin kesin koordinatı,
- kartın physical ölçüsü,
- desktop/mobile pagination algoritması,
- physical kategori ayraçlarının kesin sayısı ve sırası.

## 21. Tema oturumu için kısa contract özeti

> Studio gerçek schema-v2 `content/publication.json` üretmektedir. Journal semantik section'lardan oluşur; stable `sectionId`, revision ve `order` taşır. Inline entity bağlantıları yalnız explicit `{type:"reference", entityId, label}` span'larıdır. Archive stable `entityId` ve `relationId` kullanır. Görseller stable `assetId` üzerinden çözülür; physical URL content hash taşır ve identity değildir. Scene asset'leri narrative revision-bound, entity asset'leri reusable'dır. Studio physical page/spread üretmez. Tema tüm pagination, page-turn, hover, dossier transition, return state ve exact image placement'in sahibidir. React presentation bileşenleri raw JSON yerine adapter/provider üzerinden çalışmalıdır. Mevcut live endpoint v1'dir; v2 live upload henüz ayrı olarak bağlanmamıştır.
