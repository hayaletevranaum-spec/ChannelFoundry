# BirDeSenGör — Anlatı Katmanı ve Yaşatma Akışı

Son karar: 14 Ağustos 2026.

Bu belge, BirDeSenGör'ün Web deneyimi ve AI Atölyesi üretim hattı için yeni ana yönü tanımlar. Geçici bir tasarım fikri değildir.

## 1. Temel ürün kararı

BirDeSenGör'ün arka plandaki Evren modeli bağlantılı kayıtlar, kaynaklar, karakterler, olaylar, mekânlar, nesneler ve ilişkilerden oluşmaya devam eder.

Fakat ziyaretçinin ana deneyimi artık yüzlerce ayrı kayıt arasında gezinmek değildir.

Ana deneyim:

**Devam eden, kronolojik bir anlatıyı okumaktır.**

Evren veri modeli, anlatının doğruluk ve ilişki omurgasıdır. Web'de kullanıcı önce hikâyeyi okur; ayrıntıya ihtiyaç duyduğunda anlatının içindeki bağlantılı kayıtlara iner.

> Evren, kullanıcının dolaşacağı ana arayüz değil; anlatının güvenilir bilgi omurgasıdır.

## 2. Neden?

Mevcut sistem çok sayıda doğru ve değerli ayrıntı üretebilir. Fakat ilk kez gelen kullanıcının yüzlerce kısa/uzun kayıt arasında dolaşarak evreni öğrenmesini beklemek yüksek bilişsel yük oluşturur.

BirDeSenGör hikâyesi bir ağ diyagramı gibi değil, yıllar içinde devam eden bir anlatı gibi hissedilmelidir.

Bu nedenle Web deneyimi "bilgi ağı" merkezinden "kitap / anı defteri / devam eden kronolojik anlatı" merkezine taşınır.

## 3. Web için hedef deneyim

İleride yapılacak temiz Web redesign'ında:

- anlatım kronolojik ilerler,
- yeni onaylanan bilgiler kitabın devamına yeni sayfa/bölüm olarak eklenir,
- kullanıcı ana hikâyeyi kesintisiz okuyabilir,
- karakter, mekân, nesne, olay ve önemli kavram adları anlatı içinde etkileşimli olur,
- mouse hover'da kısa bilgi + görsel görünür,
- tam ayrıntı isteyen kullanıcı ilgili kayda geçebilir,
- anlatı ayrıntı kayıtlarını kaldırmaz; onları ikinci katmana taşır.

Karakter/mekân/nesne önizlemelerinde kategoriye göre çerçeve, üstte görsel, kısa tanım ve tam kayıt bağlantısı bulunan BirDeSenGör'e özgü kart şablonları kullanılabilir.

Mevcut Web görünümü bu hedefe küçük CSS/detail-page düzeltmeleriyle taşınmaya çalışılmayacaktır. Görsel redesign şimdilik dondurulmuştur.

## 4. Hikâyeleştir: kurgu değil anlatım

"Hikâyeleştir" işlemi yeni olay üretmek veya yorum eklemek değildir.

AI'nin görevi:

- yalnız editoryal olarak onaylanmış Evren verisini kullanmak,
- kronolojiyi korumak,
- dağınık bilgileri doğal metin akışında birleştirmek,
- ilişkileri anlatı içinde görünür kılmak,
- tekrarları azaltmak,
- kaynak/provenance bilgisini korumaktır.

AI şunları yapamaz:

- kaynaklarda olmayan olay üretmek,
- boşlukları varsayımla doldurmak,
- bir iddiayı kesin gerçek gibi yorumlamak,
- karakterlere niyet atfetmek,
- metafizik/paranormal yorumu gerçekmiş gibi eklemek,
- dramatik etki için yeni ayrıntı uydurmak.

Anlatı, onaylı Evren verisinin yeniden ifade edilmiş biçimidir.

## 5. Studio'nun yeni hedef hattı

Mantıksal üretim sırası:

**Video → Altyazı → AI Ham Çözümleme → Editoryal Ayıklama → Evrene İşleme → Değişiklik İnceleme → Onay → Hikâyeleştir → Görsel Tamamlama → Yayın**

Hikâyeleştir yalnız onaylı Evren verisini kullanır. Onaylanmamış taslak veya revizyonlar anlatıya giremez.

Mevcut UI numaraları hemen değiştirilmek zorunda değildir; bu belge mantıksal hedefi tanımlar.

## 6. Hikâyeleştir veri modeli

Hikâyeleştir her seferinde bütün ham video arşivini yeniden okumamalıdır.

Girdi:

1. daha önce onaylanmış/yayınlanmış anlatı,
2. bu turda onaylanan yeni Evren kayıtları,
3. bu turda onaylanan revizyonlar,
4. kayıtların kaynak video kimlikleri ve gerçek yayın tarihleri,
5. gerektiğinde bağlı mevcut onaylı kayıtlar.

Çıktı en az şu bilgileri taşımalıdır:

- anlatı bölümü/bölümleri,
- dayandığı Evren kayıtları,
- kaynak video provenance,
- devam ettirdiği veya revize ettiği önceki bölüm,
- üretim modeli/sürümü,
- editoryal durum,
- yayın durumu.

Anlatı da kayıt geçmişi taşımalıdır.

## 7. Incremental hikâye hafızası

Ürünün asıl kalite hedefi ilk 600 videoyu tek seferde işlemek değildir.

Asıl kalite hedefi, evreni haftalar ve yıllar boyunca **yaşatabilmektir**.

Normal kullanım beklentisi yaklaşık haftada 3 yeni videodur.

Bu nedenle:

- eski anlatı her yeni videoda sıfırdan üretilmez,
- yeni onaylanmış kayıtlar mevcut anlatıya bağlanır,
- geçmiş olayla ilgili yeni bilgi gelirse ilgili eski bölüm için revizyon önerilebilir,
- yayınlanmış anlatı AI tarafından sessizce değiştirilemez,
- değişiklikler editoryal olarak görülebilir olmalıdır,
- kaynak izi korunmalıdır.

## 8. İlk kurulum ve yaklaşık 600 video

İlk yaklaşık 600 video bir kerelik inşa yüküdür. Altyazı ve ham AI çözümlemeleri toplu hazırlanabilir; fakat kullanıcıdan 600 videoluk Evren işini tek turda kontrol etmesi beklenmez.

İlk inşa da yaşatma mimarisiyle küçük batch'ler halinde ilerler.

Kesinleşen kural:

- Evrene İşleme'de kullanıcıya kronolojik olarak sıradaki **en eski en fazla 10 ayıklanmış video** gösterilir.
- Kullanıcı 10'un tamamını seçmek zorunda değildir; 2–3 video seçebilir.
- Seçilmeyen eski videolar sırada kalır.
- Daha yeni videolar en eski çalışma penceresinin önüne atlanamaz.
- Seçim sırası ne olursa olsun backend kronolojik düzeni korur.
- Bir turda 10'dan fazla video alınamaz.

Bu sınır performans zorunluluğundan çok **editoryal insan yükünü yönetmek** içindir.

2–3 videoda bile çok sayıda kayıt kontrolü gerekebilir. Yüksek doğruluk hedefi için bu editoryal maliyet kabul edilir; kaliteyi düşürmek amacıyla inceleme kapısı kaldırılmaz.

## 9. İlk inşa ve yaşatma aynı sistemdir

İki ayrı mimari kurulmaz.

- İlk 600 video = çok sayıda küçük kronolojik batch.
- Normal haftalık kullanım = genellikle tek küçük batch, yaklaşık 3 video.

Aynı Ayıklama, Evrene İşleme, İnceleme, Hikâyeleştir ve yayın hattı kullanılır.

## 10. Görsel üretimin yeni yeri

Ham analysis içinde visual definition/prompt verisi tutulabilir. Ancak yayın için asıl görsel üretim noktası **Hikâyeleştir sonrasıdır**.

Hedef:

**Onaylı Evren → Hikâyeleştir → anlatıda gereken görsel ihtiyaçlarını çıkar → mevcut görselleri yeniden kullan / gerekirse üret → editoryal kontrol → yayın**

Böylece gereksiz üretim azalır, sahne bağlamı prompt'u güçlendirir ve karakter/mekân/nesne görsel sürekliliği korunur.

## 11. Anlatı içi bağlantı katmanı

Üç seviye düşünülür:

1. **Metin:** kesintisiz doğal anlatı.
2. **Hover kartı:** görsel + kısa açıklama + kategori.
3. **Tam kayıt:** kaynaklar, ayrıntılar, ilişkiler, geçmiş ve bağlı kayıtlar.

Böylece ilk kez gelen kişi hikâyeyi kitap gibi okur; araştırmak isteyen kullanıcı güçlü Evren veri katmanına iner.

Karakterler, nesneler, mekânlar ve diğer kayıtlar kitabın sonundaki ekler / kişi dizini / rehber / sözlük benzeri yardımcı alanlarda ayrıca bulunabilir.

## 12. Yayınlama ilkesi

Web yayını iki ana katman taşır:

- **Anlatı katmanı:** ziyaretçinin birincil okuma deneyimi.
- **Evren kayıt katmanı:** doğrulanmış ayrıntı ve araştırma yüzeyi.

Bir kayıt Evren'de onaylanmış olsa bile anlatıya aynı ağırlıkla taşınmak zorunda değildir. Küçük ayrıntılar hover veya tam kayıt katmanında kalabilir.

Bu bilgi kaybı değil, bilgi katmanlandırmasıdır.

## 13. Doğruluk ve provenance

Anlatıdaki önemli bilgi geriye doğru izlenebilir olmalıdır:

**Anlatı bölümü → Evren kaydı/revizyonu → Ayıklama kararı → AI çözümleme → kaynak video/al altyazı**

Bir kaynak veya Evren durumu anlatı taslağı hazırlandıktan sonra değişirse hazırlanan sonuç stale kabul edilmeli ve sessizce yayınlanmamalıdır.

## 14. AI editoryal sınırı

AI yayınlanmış/onaylanmış anlatıyı tek başına kalıcı olarak değiştiremez.

AI yeni anlatı taslağı, revizyon taslağı, birleştirme önerisi, anahtar terim bağlantıları, görsel ihtiyaçları ve prompt'lar hazırlayabilir. Kalıcı karar kullanıcıya aittir.

## 15. Teknik uygulama sırası

1. Kronolojik en fazla 10 videoluk Evrene İşleme seçim sözleşmesini tamamla ve release verify'i temizle.
2. Hikâyeleştir kalıcı veri tablolarını ve lifecycle modelini kur.
3. `son onaylı anlatı + bu turdaki onaylı değişiklikler` input builder'ını oluştur.
4. Source/provenance ve fingerprint/stale korumasını ekle.
5. AI çağrısı olmadan deterministic fixture lifecycle testleri yaz.
6. Mevcut AI provider abstraction üzerinden metin üretimini bağla.
7. Anlatı inceleme/onay akışını ekle.
8. Görsel ihtiyaç ve üretimi Hikâyeleştir sonrasına bağla.
9. Public snapshot'a anlatı verisini ekle.
10. En son Web'i kitap/anı defteri yönünde temiz bir oturumda yeniden tasarla.

## 16. Nihai kalite sorusu

Başarı ölçütü "600 videoyu tek seferde işleyebiliyor muyuz?" değildir.

Asıl soru:

> "Bugün üç yeni video geldiğinde, yıllarca birikmiş Evren ve anlatıyı bozmadan yalnız yeni bilgiyi kontrollü biçimde işleyip hikâyeyi güvenilir şekilde yaşatabiliyor muyuz?"

BirDeSenGör mimarisi bu soruya evet diyebilmelidir.
