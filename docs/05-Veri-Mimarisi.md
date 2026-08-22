# Veri Mimarisi

Channel Foundry iki farklı yerel veri katmanını aynı SQLite çalışma alanında tutar:

1. Kaynak arşivi
2. Editoryal evren

Bu iki katman aynı şey değildir.

## Kaynak Arşivi

Kaynak arşivi dış dünyadan gelen ham çalışma malzemesidir.

Temel kaynak kayıtları:

- YouTube kanalı
- YouTube video kataloğu
- Thumbnail cache
- Transkript / altyazı
- AI analiz işi
- AI önerisi

Kanalda bulunan yüzlerce video burada arşivlenebilir. Bir videonun kaynak arşivinde bulunması onu otomatik olarak webde yayınlanacak Channel Foundry içeriği yapmaz.

Hedef tablolar:

- `youtube_channels`
- `youtube_videos`
- `content_transcripts`
- `analysis_jobs`
- `analysis_proposals`

## Editoryal Evren

Kullanıcının onayladığı ve hikâye modeline dahil ettiği içerikler editoryal evrendir.

Temel içerikler:

- Kayıt / Video
- Muhatap / Karakter
- Olay
- Dosya
- İlişki

Editoryal veri mevcut `content_items`, `content_sources` ve `relations` tablolarında tutulur.

Bir kaynak video editoryal kayda dönüştürüldüğünde `content_sources` ile kaynak video kimliğine bağlanır. Aynı bilgi iki farklı yerde elle tekrar tutulmaz.

## Community

Forum, kullanıcı ve Research Area yetkileri ana yerel evren verisinden ayrı bounded context'tir ve sunucu SQLite'ında tutulur.

## Üretim Akışı

```text
YouTube Kanalı
      ↓
Yerel Video Kataloğu
      ↓
Altyazı / Transkript
      ↓
AI Analiz Önerileri
      ↓
Kullanıcı Onayı
      ↓
Editoryal Kayıt / Muhatap / Olay / İlişki
      ↓
Public Snapshot
      ↓
Web
```

## Temel Kurallar

- Studio bütün editoryal veriyi üretir.
- Web sitesi yalnız public snapshot'ı görüntüler.
- Ham transkript, AI çalışma verisi ve kanal kataloğunun tamamı public snapshot'a çıkmaz.
- Aynı bilgi iki farklı yerde manuel olarak tutulmaz.
- Kaynak arşivindeki toplu operasyonlar editoryal yayın kararından ayrıdır.
- AI önerileri onaylanmadan editoryal veriye dönüşmez.
- Her içerik diğer editoryal içeriklerle ilişki kurabilir.
- Veri modeli mümkün olduğunca sade tutulmalıdır.
