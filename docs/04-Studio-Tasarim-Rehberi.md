# Studio Tasarım Rehberi

Studio bir yönetim paneli değildir.

Studio üretim merkezidir.

Kanal sahibi Browser kullanmadan bütün içerikleri Studio üzerinden yönetebilmelidir.

## Ana Üretim Hattı

Studio ana navigasyonu kullanıcının gerçek çalışma sırasını izler:

1. Gösterge Paneli
2. Video Arşivi
3. Altyazılar
4. AI Atölyesi
5. Kayıt Dosyaları
6. Muhataplar

Sistem bölümü üretim hattından ayrıdır:

- Topluluk
- Yayınlama
- Ayarlar

Timeline, İlişki Panosu, toplu işlemler ve manuel kaynak ekleme kaybolmaz; ilgili üretim ekranının içinde bağlamsal / gelişmiş araç olarak açılır.

## Gösterge Paneli

İlk ekran “bugün ne yapılmalı?” sorusuna cevap verir.

Temel durumlar:

- Yeni videolar
- Altyazı bekleyenler
- AI çözümleme kuyruğu
- Evren birleştirme / kullanıcı onayı bekleyen içerikler
- Yayına hazır içerikler

Üretim hattı tek bakışta görülebilmelidir:

`Video → Altyazı → Video çözümleme → Evren birleştirme → İnceleme → Yayın`

## Video Arşivi

Video Arşivi YouTube kanalının yerel kataloğudur.

- Kanalın mevcut videoları topluca senkronize edilir.
- Yeni videolar daha sonra tekrar taranabilir.
- Metadata ve thumbnail bilgileri yerel arşivde tutulur.
- Kanal kataloğundaki her video otomatik olarak public BirDeSenGör içeriği değildir.
- Kullanıcı seçtiği videoyu editoryal çalışma alanına alır.

Arşiv yüzlerce / binlerce videoda çalışabilecek liste ve filtre yapısında tasarlanır.

## Altyazılar

Altyazı ekranı video kataloğunun devamıdır.

Kullanıcı videoları şu filtrelerle daraltabilmelidir:

- Arama
- Tarih aralığı
- Süre
- Haftanın günü
- Altyazı var / yok
- Dil
- İşlem durumu

Seçili videolar topluca altyazı kuyruğuna alınabilir.

İşlem durumu kalıcı tutulur:

`Bekliyor → İşleniyor → Arşivlendi → Hata`

Bir hata bütün kuyruğu durdurmamalıdır.

## AI Atölyesi

AI Atölyesi kanalın anlatı evrenini yapılandıran yerel yardımcıdır.

Öncelikli bağlam videonun yerel transkriptidir. Sistem doğru/yanlış, kanıt, teyit veya fact-check ayrımı yapmaz; kanal sahibinin kendi anlatısını hikâye parçalarına ayırır ve videolar arasında birleştirilebilir veri üretir.

### 1. Video çözümleme

Her video önce bağımsız çözülür:

- Web için başlık ve hikâye özeti
- Ana temalar
- Hikâye akışı
- Hikâye hattı adayları
- Karakterler / diğer adları / bu videodaki rolleri / videoda geçen özellik ve ayrıntıları
- Mekânlar
- Önemli nesne ve semboller
- Görselleştirilebilir önemli sahneler / olaylar

### 2. Evren birleştirme

Video çözümlemeleri biriktikten sonra ikinci katman bunları bütün kanal ölçeğinde birleştirir:

- Birbirinden bağımsız veya paralel ilerleyen hikâyeler
- Bir videonun birden fazla hikâyeye bağlanması
- Aynı karakterin farklı videolardaki ad/alias eşleşmeleri
- Karakter ayrıntılarının kaynak videoları korunarak tek profile birikmesi
- Hikâye ↔ karakter ↔ video ↔ olay ↔ mekân ↔ nesne bağlantıları

Yeni video geldiğinde bütün kanalın ham transkriptlerini tekrar işlemek yerine yeni video çözümlemesi mevcut evren özetiyle karşılaştırılarak artımlı güncelleme yapılabilmelidir.

## Görsel Tanımlar ve Görsel Varlıklar

AI metin analizinin yanında web kartları ve detay sayfaları için görsel üretim tanımları da hazırlar.

Karakter, olay/sahne, mekân, nesne ve hikâye kapağı için mümkün olduğunda şu alanlar tutulur:

- Görsel açıklama
- Kaynaklarda açıkça geçen yapısal özellikler (ör. varlık türü, boy, fiziksel yapı, kıyafet, belirgin özellik)
- Atmosfer
- Bağımsız görsel üretim servisinde kullanılabilecek prompt
- Opsiyonel negatif prompt
- Varsa manuel eklenmiş veya AI ile üretilmiş gerçek görsel dosyası

Bilinmeyen fiziksel özellikler yalnız resmi tamamlamak için uydurulmaz. Görsel prompt her zaman saklanabilir ve kopyalanabilir olmalıdır; doğrudan görsel üretimi zorunlu değildir.

AI sağlayıcısı seçili görsel modelinin yeteneğini model metadata'sında bildiriyorsa Studio bunu otomatik algılamaya çalışabilir. Sağlayıcı yeteneği bildirmiyorsa kullanıcı manuel olarak etkinleştirebilir. Doğrudan üretim OpenAI-uyumlu `/images/generations` sözleşmesi üzerinden opsiyonel bir yetenektir.

Metin modeli ile görsel modeli aynı olmak zorunda değildir. Örneğin yerel Ollama metin çözümlemesi yaparken görsel prompt dışarıdaki başka bir AI'da kullanılabilir ve sonuç Studio'ya manuel eklenebilir.

## Kayıt Dosyaları

Onaylanmış editoryal içerik burada yönetilir.

Bir kayıt dosyası gerektiğinde şu alt görünümleri açabilir:

- Genel
- Görsel profil
- Zaman / akış
- Notlar
- İlişkiler
- Sürüm Geçmişi

Timeline ve İlişki Panosu burada bağlamsal gelişmiş görünüm olarak kullanılabilir.

## Muhataplar

Kişiler, tanıklar, araştırmacılar, varlıklar veya diğer hikâye düğümleri burada yönetilir.

AI tarafından bulunan muhataplar video çözümleme aşamasında adaydır. Evren birleştirme aynı karakterin farklı videolardaki parçalarını tek profile toplar; kullanıcı onayladığında gerçek arşiv kaydına dönüşür.

Karakter profili kaynak videoları kaybetmeden hem anlatı ayrıntılarını hem de görsel profilini taşıyabilir.

## UI Kuralları

Tasarım:

- Minimal
- Profesyonel
- Odaklı
- Hızlı
- Koyu araştırma / arşiv atmosferine sahip

Kurallar:

- Her işlem en fazla birkaç tıklama ile yapılmalıdır.
- Studio karmaşık görünmemelidir.
- Gelişmiş işlemler isteğe bağlı olarak açılmalıdır.
- İlk bakışta sadece gerekli bilgiler görünmelidir.
- Aynı iş için native uygulama menüsü ile Studio UI arasında iki ayrı giriş noktası oluşturulmaz.
- YouTube, altyazı, AI ve toplu işlemler ayrı araç pencereleri olarak dağılmaz; ana üretim hattında kendi yerlerinde bulunur.
- Büyük arşivlerde toplu seçim ve kalıcı iş kuyrukları tercih edilir.
- AI araçları anlatıyı yapılandırır; kullanıcı onayı olmadan kalıcı editoryal karar vermez.
