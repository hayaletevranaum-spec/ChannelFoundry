import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildArchiveFrames } from '../apps/web/src/book/archive-pagination.js';
import { buildJournalFrames } from '../apps/web/src/book/pagination.js';
import { getPresentationPose } from '../apps/web/src/3d/bookPresentation.js';
import { resolveHoverCardPosition } from '../apps/web/src/components/hover-card-position.js';

const root = process.cwd();
const web = path.join(root, 'apps', 'web');
const read = (target) => readFileSync(path.join(root, target), 'utf8');

const webPackage = JSON.parse(read('apps/web/package.json'));
assert.equal(webPackage.dependencies?.['@birdesengor/domain'], undefined, 'Yeni Web eski domain/UI bağımlılığını taşımamalı');
assert.ok(webPackage.dependencies?.['@babylonjs/core'], 'Babylon fiziksel kitap motoru Web runtime bağımlılığı olmalı');

const desk = read('apps/web/src/components/DeskScene.jsx');
const shell = read('apps/web/src/3d/BabylonBookShell.jsx');
assert.match(desk, /BabylonBookShell/, 'Araştırma odası fiziksel Babylon kitap motorunu kullanmalı');
assert.match(desk, /YoutubeCameraArchive/, 'Masa kamerası YouTube video arşivini açmalı');
assert.match(desk, /CommunityNotebook/, 'Topluluk kitabı mevcut forum veri akışını kullanmalı');
assert.match(desk, /research-room-plate-unlit\.png/, 'Production oda tek statik temel plate üzerinden kurulmalı');
assert.match(desk, /closed-public\.png/, 'Topluluk Defteri fiziksel scene assetiyle görünür olmalı');
assert.match(desk, /community-notebook-object[\s\S]*?<img/, 'Topluluk Defteri görünür img launcher üzerinden açılmalı');
assert.match(desk, /desk-apparition/, 'Mum döngüsüne bağlı subtil karaltı sahne atmosferinde bulunmalı');
assert.match(desk, /metaphysical-apparition-v1\.png/, 'Mum olayı alfa kanallı metafizik varlık assetini kullanmalı');
assert.match(desk, /desk-candle-flame/, 'Mum alevi hafif CSS katmanı olarak bulunmalı');
assert.match(desk, /desk-incense-smoke/, 'Tütsü dumanı hafif CSS katmanı olarak bulunmalı');
assert.doesNotMatch(desk, /roomPlateName/, 'Mum/tütsü değişiminde tam oda görseli değiştirilmemeli');
assert.doesNotMatch(desk, /raw\.githubusercontent|book-theme/, 'Production Web ayrı book-theme reposuna runtime bağımlı olmamalı');

for (const asset of [
  'research-room-plate-unlit.png',
  'closed-journal-v2.png',
  'journal-cover-alchemy-v1.webp',
  'community-cover-leather-v1.webp',
  'handheld-camcorder-v2.png',
  'closed-public.png',
  'metaphysical-apparition-v1.png',
]) {
  assert.ok(existsSync(path.join(web, 'public', 'scene', asset)), `Kritik scene asseti bulunmalı: ${asset}`);
}
assert.equal(existsSync(path.join(web, 'public', 'scene', 'research-room-plate.png')), false, 'Eski tam oda mum+tütsü varyantı kaldırılmalı');
assert.equal(existsSync(path.join(web, 'public', 'scene', 'research-room-plate-lit-no-smoke.png')), false, 'Eski tam oda mum varyantı kaldırılmalı');

const referenceSpan = read('apps/web/src/components/ReferenceSpan.jsx');
assert.match(referenceSpan, /createPortal[\s\S]*?document\.body/, 'Hover kartı perspektifli ve kırpılan kitap sayfasının dışına portal ile taşınmalı');
assert.match(referenceSpan, /has-image[\s\S]*?is-text-only/, 'Görselli ve görselsiz hover kartları ayrı yerleşim kullanmalı');
assert.match(referenceSpan, /resolveHoverCardPosition/, 'Hover kartı ekran kenarlarında ölçülüp konumlandırılmalı');

const hoverViewport = { left: 0, top: 0, width: 800, height: 600 };
const hoverCardRect = { width: 360, height: 180 };
const leftClampedCard = resolveHoverCardPosition({ left: 0, right: 20, top: 250, bottom: 270 }, hoverCardRect, hoverViewport);
const rightClampedCard = resolveHoverCardPosition({ left: 780, right: 800, top: 250, bottom: 270 }, hoverCardRect, hoverViewport);
const bottomFlippedCard = resolveHoverCardPosition({ left: 380, right: 420, top: 570, bottom: 590 }, hoverCardRect, hoverViewport);
assert.equal(leftClampedCard.left, 14, 'Hover kartı sol ekran kenarından içeri alınmalı');
assert.equal(rightClampedCard.left + hoverCardRect.width, 786, 'Hover kartı sağ ekran kenarından içeri alınmalı');
assert.equal(bottomFlippedCard.placement, 'above', 'Alt kenarda yeterli alan yoksa hover kartı referansın üstüne çevrilmeli');
assert.ok(bottomFlippedCard.top >= 14 && bottomFlippedCard.top + hoverCardRect.height <= 586, 'Dikey hover konumu ekran marjları içinde kalmalı');

const frameCss = read('apps/web/src/book-frames.css');
for (const kind of ['story', 'character', 'location', 'object']) {
  assert.match(frameCss, new RegExp(`book-page-frame\\[data-frame-kind=['"]${kind}['"]\\]`), `Kitap içinde ${kind} çerçeve varyantı bulunmalı`);
}
for (const kind of ['character', 'location', 'object']) {
  assert.match(frameCss, new RegExp(`hover-card\\.kind-${kind}`), `Hover kartında ${kind} çerçeve varyantı bulunmalı`);
}
assert.match(frameCss, /\.hover-card\.is-text-only\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s, 'Görselsiz hover kartının metni tam genişliği kullanmalı');
assert.match(frameCss, /\.hover-card\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*70/s, 'Portal hover kartı sabit ve sahnenin üstünde konumlanmalı');
assert.match(shell, /data-book-frame/, 'Sayfalar boya tabanlı kitap çerçevesi türünü açıklamalı');
assert.match(shell, /frameKind="story"/, 'Ana hikâye sayfaları ortak kitap çerçevesini kullanmalı');
assert.match(shell, /frameKind=\{archiveFrame\?\.left\?\.entity\?\.kind\}/, 'Inline referanstan açılan arşiv çerçevesi gerçek entity türünden gelmeli');

const desktopClosedPose = getPresentationPose('desktop', 'closed');
assert.deepEqual(desktopClosedPose.cameraPosition, [0, 6.2, -7.8], 'Masaüstü kapalı kitap kamerası fotoğraf açısıyla eşleşmeli');
assert.equal(desktopClosedPose.orthoHeight, 13.7, 'Masaüstü 3B kitap kapalı PNG boyutunda başlamalı');
assert.deepEqual(desktopClosedPose.rootPosition, [-2.003, 0, -5.11], 'Masaüstü 3B kitap kapalı PNG konumunda başlamalı');

const mobileClosedPose = getPresentationPose('mobile', 'closed');
assert.deepEqual(mobileClosedPose.cameraPosition, [0, 6.2, -7.8], 'Mobil kapalı kitap kamerası fotoğraf açısıyla eşleşmeli');
assert.equal(mobileClosedPose.orthoHeight, 17.15, 'Mobil 3B kitap kapalı PNG boyutunda başlamalı');
assert.deepEqual(mobileClosedPose.rootPosition, [-2.364, 0, -5.91], 'Mobil 3B kitap kapalı PNG konumunda başlamalı');

const openingEngineSource = read('apps/web/src/3d/createBookEngine.js');
assert.match(openingEngineSource, /duration:\s*duration\(1120\)[\s\S]*?poseProgress\s*=\s*smoothstep\(0,\s*0\.88,\s*raw\)[\s\S]*?coverProgress\s*=\s*smoothstep\(0\.08,\s*0\.92,\s*raw\)/, 'Kitap hareketi kapağın açılmasından biraz önce başlamalı');
assert.match(openingEngineSource, /coverSettle\s*=\s*smoothstep\(0\.58,\s*1,\s*raw\)/, 'Kapak yükseltisi açılışın sonunda doğal biçimde yerleşmeli');
assert.match(openingEngineSource, /journal-cover-alchemy-v1\.webp[\s\S]*?current-journal-cover-artwork/, 'Açılış animasyonu güncel bezemeli kapak dokusunu kullanmalı');
assert.doesNotMatch(openingEngineSource, /cover-title-texture|cover-trim-inner/, 'Animasyonda eski sade kapak yazısı ve şeritleri bulunmamalı');

const communityNotebook = read('apps/web/src/components/CommunityNotebook.jsx');
const communityBookCss = read('apps/web/src/community-book-physical.css');
const communityMainSource = read('apps/web/src/main.jsx');
const communityClosedPose = getPresentationPose('desktop', 'closed', 'community');
assert.ok(communityClosedPose.orthoHeight > desktopClosedPose.orthoHeight, 'Topluluk defterinin kapalı pozu masadaki daha küçük objeye göre ölçeklenmeli');
assert.match(communityNotebook, /BabylonBookViewport[^>]*bookVariant="community"/, 'Topluluk Defteri ortak Babylon motorunun community profilini kullanmalı');
assert.match(communityNotebook, /engine\.open\(\)[\s\S]*?engine\.close\(\)[\s\S]*?engine\.turnPage/, 'Topluluk Defteri ana kitapla aynı açma, kapama ve sayfa çevirme APIlerini kullanmalı');
assert.match(communityNotebook, /<Page side="left"[\s\S]*?<Page side="right"/, 'Masaüstü topluluk görünümü fiziksel iki sayfaya yerleşmeli');
assert.doesNotMatch(communityNotebook, /createPortal|community-focus-layer|community-notebook-sheet/, 'Eski ekran-düzlemi topluluk modalı artık render edilmemeli');
assert.match(openingEngineSource, /community-cover-leather-v1\.webp[\s\S]*?current-community-cover-artwork/, 'Topluluk açılış animasyonu kendi güncel deri kapak dokusunu kullanmalı');
assert.match(communityBookCss, /community-book-page[\s\S]*?repeating-linear-gradient/, 'Topluluk sayfaları deftere uygun çizgili kâğıt yüzeyi kullanmalı');
assert.match(communityBookCss, /communityClosedNotebookLeave[\s\S]*?communityClosedNotebookReturn/, 'Kapalı topluluk objesi 3B kitapla karşılıklı geçiş yapmalı');
assert.match(communityMainSource, /community-book-physical\.css/, 'Topluluk fiziksel kitap stilleri production girişine bağlı olmalı');

const openingBookCss = read('apps/web/src/babylon-book.css');
assert.match(openingBookCss, /phase-opening \.babylon-book-canvas\s*\{[^}]*babylonCanvasReveal\s+\.34s/s, 'Kapalı fotoğraf ile 3B kitap kısa bir karşılıklı geçiş kullanmalı');
assert.match(openingBookCss, /phase-closing \.babylon-book-canvas\s*\{[^}]*babylonCanvasRetreat\s+\.34s\s+\.74s/s, 'Kapanışta 3B kitap fotoğrafla son anda örtüşmeli');
assert.match(openingBookCss, /\.book-clasp-emblem\s*\{[\s\S]*?radial-gradient[\s\S]*?linear-gradient/, 'Kitap kapatma kontrolü perçinli eskitilmiş pirinç kilit görünümünde olmalı');
assert.match(openingBookCss, /\.book-clasp-emblem::after\s*\{[\s\S]*?clip-path:/, 'Metinsiz kitap kilidi anlaşılır bir anahtar deliği taşımalı');
assert.doesNotMatch(openingBookCss, /\.babylon-clasp-action:hover[^{}]*\{[^}]*translateX\(/s, 'Kitap kilidi hover sırasında yana kaymamalı');

const openingPerformanceCss = read('apps/web/src/book-performance.css');
assert.match(openingPerformanceCss, /transition:\s*left\s+\.9s[^;]*right\s+\.9s[^;]*box-shadow\s+\.9s/, 'Masa gölgesi kitap hareketini yaklaşık tam süre boyunca izlemeli');

const ribbonCss = read('apps/web/src/book-ribbons.css');
const ribbonMainSource = read('apps/web/src/main.jsx');
assert.match(ribbonMainSource, /book-ribbons\.css/, 'Fiziksel ayraç stilleri production girişine bağlı olmalı');
assert.match(ribbonCss, /journal-return-bookmark\s*\{[\s\S]*?width:\s*154px[\s\S]*?height:\s*52px/, 'Arşiv dönüş ayracı yatay olmalı');
assert.match(ribbonCss, /bookmark:hover:not\(:disabled\)::after[\s\S]*?rotateY\(-52deg\)/, 'Kategori ayraçlarının dış ucu hover sırasında kıvrılmalı');
assert.match(ribbonCss, /journal-return-bookmark:hover:not\(:disabled\)::after[\s\S]*?rotateY\(-52deg\)/, 'Dönüş ayracının dış ucu hover sırasında kıvrılmalı');
assert.doesNotMatch(ribbonCss, /bookmark:hover[^{}]*\{[^}]*translateX\(/s, 'Ayraç hover hareketi yana kaymamalı');

const roomCss = read('apps/web/src/room-plate.css');
assert.match(roomCss, /desk-atmosphere\.is-ritual-active\s*\{[\s\S]*?animation:\s*flameMode\s+60s\s+linear\s+10s\s+infinite/, 'Mum ritüeli sahne açıldıktan 10 saniye sonra başlayıp dakikada bir tekrarlanmalı');
assert.match(roomCss, /@keyframes flameSway[\s\S]*?transform/, 'Mum alevi transform tabanlı hafif hareket kullanmalı');
assert.match(roomCss, /@keyframes glowFlicker[\s\S]*?opacity[\s\S]*?transform/, 'Mum glow hareketi opacity ve transform ağırlıklı kalmalı');
assert.match(roomCss, /@keyframes incenseWisp[\s\S]*?translate3d[\s\S]*?opacity/, 'Tütsü dumanı küçük CSS parçacıklarını hareket ettirmeli');
assert.match(roomCss, /desk-atmosphere\.is-ritual-active \.desk-apparition\s*\{[\s\S]*?animation:\s*apparitionPulse\s+60s\s+linear\s+10s\s+infinite/, 'Varlık mumun gecikmeli 60 saniyelik ritmiyle senkron olmalı');
assert.match(roomCss, /desk-apparition[\s\S]*?blur/, 'Karaltı net bir figür yerine blur/gradient ile subtil kalmalı');
assert.match(roomCss, /@keyframes apparitionPulse[\s\S]*?1\.667%[\s\S]*?15%[\s\S]*?16\.667%/, 'Varlık yaklaşık bir saniyelik giriş ve çıkış eşikleri kullanmalı');
assert.match(roomCss, /@keyframes flameMode[\s\S]*?2\.4%[\s\S]*?16\.9%[\s\S]*?17\.2%/, 'Mum varlık belirdikten sonra canlanıp varlık kaybolduktan sonra normale dönmeli');
assert.match(roomCss, /prefers-reduced-motion:\s*reduce[\s\S]*?desk-atmosphere\.is-ritual-active[\s\S]*?desk-apparition[\s\S]*?(?:display:\s*none|opacity:\s*0)/, 'Mum ritüeli ve varlık reduced-motion durumunda devre dışı kalmalı');
assert.match(roomCss, /\.youtube-camera-launcher\s*>\s*span\s*\{\s*display:\s*none/, 'Kamera launcher üzerinde ayrı metin etiketi görünmemeli');
assert.match(roomCss, /\.phase-closed \.babylon-open-book[\s\S]*?width:\s*min\(22vw/, 'Kapalı ana günlük masa merkezinde daha küçük gösterilmeli');

const camera = read('apps/web/src/components/YoutubeCameraArchive.jsx');
const cameraConsoleCss = read('apps/web/src/youtube-camera-console.css');
assert.match(camera, /DEFAULT_PAGE_SIZE = 10/, 'Kamera video arşivi varsayılan olarak 10 kayıt göstermeli');
assert.match(camera, /api\/youtube\//, 'Kamera arşivi veriyi aynı-origin YouTube adaptöründen almalı');
assert.match(camera, /Başlıkta ara/, 'Kamera arşivi başlık araması sunmalı');
assert.match(camera, /Tüm süreler/, 'Kamera arşivi süre filtresi sunmalı');
assert.match(camera, /Tarih aralığı/, 'Kamera arşivi tarih aralığı filtresi sunmalı');
assert.match(camera, /Haftanın günü/, 'Kamera arşivi haftanın günü filtresi sunmalı');
assert.match(camera, /handheld-camcorder-v2\.png/, 'Video arşivi el kamerası assetinden açılmalı');
assert.match(camera, /setPhase\('opening'\)[\s\S]*?current === 'opening' \? 'open' : current === 'closing' \? 'closed'/, 'Kamera konsolu açılış ve kapanış animasyonu tamamlanana kadar ayrı fazları korumalı');
assert.match(camera, /onAnimationEnd=\{finishCameraTransition\}/, 'Kamera konsolu animasyon tamamlanınca görünürlük fazını sonlandırmalı');
assert.match(camera, /youtube-camera-statusbar[\s\S]*?youtube-camera-hardware-controls/, 'Kamera arşivi durum ekranı ve fiziksel kontrol şeridi taşımalı');
assert.match(cameraConsoleCss, /camera-phase-opening \.youtube-camera-panel\s*\{[^}]*cameraScreenApproach \.78s/s, 'Kamera paneli masa LCD ekranından yaklaşma animasyonu kullanmalı');
assert.match(cameraConsoleCss, /camera-phase-closing \.youtube-camera-panel\s*\{[^}]*cameraScreenApproach \.68s[^}]*reverse/s, 'Kamera paneli kapanırken yaklaşma animasyonunu tersine oynatmalı');
assert.match(cameraConsoleCss, /@keyframes cameraScreenApproach[\s\S]*?translate3d\(var\(--camera-approach-x\), var\(--camera-approach-y\)[\s\S]*?scale\(1\)/, 'Kamera geçişi fiziksel ekran koordinatından tam kontrol paneline büyümeli');
assert.match(cameraConsoleCss, /camera-closed:hover::before[\s\S]*?cameraScreenWake/, 'Kamera hover geri bildirimi gövde halesi yerine LCD ekran uyanmasını kullanmalı');
assert.doesNotMatch(cameraConsoleCss, /camera-closed:hover[^{}]*\{[^}]*drop-shadow\(0\s+0/s, 'Kamera hover durumunda tüm objeyi çevreleyen parlama bulunmamalı');
assert.match(cameraConsoleCss, /prefers-reduced-motion:\s*reduce[\s\S]*?camera-phase-opening[\s\S]*?\.001ms/, 'Kamera yaklaşma animasyonu reduced-motion tercihini desteklemeli');
assert.doesNotMatch(camera, /BIRDESENGOR_YOUTUBE_API_KEY|AIza[0-9A-Za-z_-]+/, 'YouTube API anahtarı frontend bileşenine sızmamalı');

const sceneObjects = read('apps/web/src/scene-object-overrides.css');
assert.match(sceneObjects, /\.community-notebook-launcher\s*\{\s*display:\s*none/, 'Eski görünmez topluluk hit-area sahnede ayrıca aktif kalmamalı');
assert.match(sceneObjects, /\.community-notebook-object[\s\S]*?position:\s*absolute/, 'Yeni topluluk defteri fiziksel sahne objesi olarak konumlanmalı');
assert.match(sceneObjects, /\.community-notebook-object:hover[\s\S]*?drop-shadow/, 'Topluluk defteri hover/focus geri bildirimi objeye bağlı kalmalı');

assert.match(shell, /closed-journal-v2\.png/, 'Kapalı durumda fotogerçekçi defter asseti kullanılmalı');
assert.doesNotMatch(shell, /closed-journal-title|closed-journal-hint/, 'Kapalı kitap PNG üzerindeki yazılar DOM ile tekrarlanmamalı');
assert.match(shell, /function quadTransform[\s\S]*?matrix3d/, 'DOM içeriği fiziksel sayfanın dört köşeli perspektifine oturmalı');
assert.match(shell, /data-paginated-page/, 'Günlük sayfaları gerçek DOM taşmasına karşı ölçülebilir olmalı');
assert.match(shell, /scrollHeight\s*>\s*page\.clientHeight/, 'Günlük taşması yeniden sayfalama döngüsünü tetiklemeli');
assert.match(shell, /buildArchiveFrames/, 'Arşiv ayrıntıları tek sayfaya sıkıştırılmamalı');
assert.match(shell, /INDEX_PAGE_SIZES[\s\S]*?journalIndexSlice[\s\S]*?archiveIndexSlice/, 'Uzun bölüm ve kategori dizinleri sayfa dönüşleriyle dilimlenmeli');
assert.match(shell, /className="babylon-clasp-action"[\s\S]*?aria-label="Kitabı kapat"[\s\S]*?className="book-clasp-emblem"/, 'Metinsiz kitap kilidi erişilebilir kapatma adını korumalı');
assert.doesNotMatch(shell, /<b>Kitabı kapat<\/b>/, 'Kitap kilidinin üzerinde yazı görünmemeli');
assert.doesNotMatch(shell, /className="babylon-clasp-action"[^>]*title=/, 'Metinsiz kitap kilidi hover sırasında tarayıcı yazısı göstermemeli');

const app = read('apps/web/src/App.jsx');
assert.match(app, /atmosphereActive=\{bootPhase === 'done'\}/, 'Mum ritüelinin gecikmesi göz açılış animasyonu tamamlandıktan sonra başlamalı');
for (const asset of ['research-room-plate-unlit.png', 'closed-journal-v2.png', 'journal-cover-alchemy-v1.webp', 'community-cover-leather-v1.webp', 'handheld-camcorder-v2.png', 'closed-public.png']) {
  assert.match(app, new RegExp(asset.replace('.', '\\.')), `Boot preload kritik asseti kapsamalı: ${asset}`);
}
assert.match(app, /Promise\.all\([\s\S]*?loadContentProvider\(\)[\s\S]*?preloadImage/, 'Provider ve kritik assetler birlikte hazır edilmeden sahne açılmamalı');
assert.match(app, /scene-boot-overlay/, 'Açılışta normal sahne önünde boot overlay bulunmalı');
assert.match(app, /prefers-reduced-motion:\s*reduce/, 'Boot reveal reduced-motion tercihini JS tarafında da dikkate almalı');
assert.match(app, /Yeniden dene/, 'Boot hata durumunda yeniden deneme kontrolü sunmalı');
assert.doesNotMatch(app, /Araştırma günlüğü hazırlanıyor|Publication v2 paketi yükleniyor/, 'Eski metin tabanlı yükleme ekranı kaldırılmalı');

const runtimeCss = read('apps/web/src/runtime-state.css');
assert.match(runtimeCss, /scene-boot-preview[\s\S]*?grayscale\(1\)[\s\S]*?blur/, 'Boot önizlemesi gri ve flu başlamalı');
assert.match(runtimeCss, /scene-boot-eyelid-top[\s\S]*?scene-boot-eyelid-bottom/, 'Boot overlay üst ve alt göz kapağı maskelerini kullanmalı');
assert.match(runtimeCss, /sceneBootOverlayReveal\s+1\.92s/, 'Boot reveal doğal göz açılışı için iki saniyeyi aşmadan tamamlanmalı');
assert.match(runtimeCss, /sceneBootEyeTop[\s\S]*?13%[\s\S]*?20%[\s\S]*?sceneBootEyeBottom/, 'Göz kapakları ilk dar aralıktan sonra kısa bir refleks tereddüdü taşımalı');
assert.match(runtimeCss, /sceneBootVisionFocus[\s\S]*?grayscale\(1\)[\s\S]*?blur\(11px\)[\s\S]*?grayscale\(0\)[\s\S]*?blur\(0\)/, 'Görüş gözler açılırken gri ve bulanıktan doğal renk ve netliğe geçmeli');
assert.match(app, /event\.target === event\.currentTarget[\s\S]*?sceneBootOverlayReveal/, 'Boot yalnız kök reveal animasyonu tamamlandığında kaldırılmalı');
assert.match(runtimeCss, /prefers-reduced-motion:\s*reduce/, 'Boot animasyonu reduced-motion desteği sunmalı');

const webMain = read('apps/web/src/main.jsx');
assert.match(webMain, /scene-object-overrides\.css/, 'Fiziksel masa objesi yerleşim katmanı production girişine bağlı olmalı');
assert.match(webMain, /room-plate\.css/, 'Atmosfer stilleri production girişine bağlı olmalı');
assert.match(webMain, /runtime-state\.css/, 'Boot overlay stilleri production girişine bağlı olmalı');
assert.match(webMain, /youtube-camera-console\.css/, 'Kamera kontrol paneli stilleri production girişine bağlı olmalı');
const viteConfig = read('apps/web/vite.config.ts');
assert.match(viteConfig, /server:[\s\S]*?proxy:[\s\S]*?["']\/content\/publication\.json["'][\s\S]*?developmentContentOrigin/, 'Yerel Web canlı publication v2 paketini development proxy üzerinden okumalı');
assert.match(viteConfig, /["']\/content\/assets["'][\s\S]*?developmentContentOrigin/, 'Yerel Web canlı publication assetlerini aynı development proxy üzerinden okumalı');
assert.match(viteConfig, /["']\/api\/youtube["'][\s\S]*?developmentContentOrigin/, 'Yerel kamera kataloğu canlı same-origin YouTube adaptörünü development proxy üzerinden okumalı');

const engine = read('apps/web/src/3d/createBookEngine.js');
assert.match(engine, /from '@babylonjs\/core'/, 'Fiziksel kitap motoru Babylon core kullanmalı');
assert.match(engine, /turnPage/, 'Gerçek sayfa çevirme motoru korunmalı');
assert.match(engine, /turnLeaf\.visibility\s*=\s*1;[\s\S]*?turnLeaf\.isVisible\s*=\s*true;[\s\S]*?await animate/, 'Dönen fiziksel sayfa animasyon boyunca tam opak başlamalı');
assert.match(engine, /community-turning-paper[\s\S]*?turnPaperMaterial\.alpha\s*=\s*1/, 'Topluluk Defteri dönen sayfası ayrı ve tam opak fiziksel malzeme kullanmalı');
assert.doesNotMatch(engine, /enableEdgesRendering/, 'Lite Babylon paketinde bulunmayan EdgesRenderer production açılışını bozmamalı');
assert.match(engine, /turnLeafBacking\.isVisible\s*=\s*false;[\s\S]*?turnLeafBacking\.visibility\s*=\s*0;[\s\S]*?async function turnPage/, 'Ek yaprak yüzeyi açılış ve kapanış boyunca gizli kalmalı');
assert.match(engine, /turnLeafBacking\.visibility\s*=\s*1;[\s\S]*?turnLeafBacking\.isVisible\s*=\s*true;[\s\S]*?await animate[\s\S]*?turnLeafBacking\.visibility\s*=\s*0;[\s\S]*?turnLeafBacking\.isVisible\s*=\s*false;/, 'Ek yaprak yüzeyi yalnız gerçek sayfa dönüşü boyunca görünmeli');
assert.doesNotMatch(engine, /edgeVisibility/, 'Dönen sayfa kenarlarda transparanlaştırılmamalı');
assert.doesNotMatch(engine, /candle|PointLight/i, 'Mum ışığı Babylon motorunda bulunmamalı');
const viewport = read('apps/web/src/3d/BabylonBookViewport.jsx');
assert.match(viewport, /stopRenderLoop\(\)/, 'Babylon sahnesi idle durumda sürekli render edilmemeli');
assert.match(viewport, /runAnimated/, 'Render loop yalnız kitap animasyonları sırasında açılmalı');
assert.match(viewport, /runAnimated[\s\S]*?renderScene\(\)[\s\S]*?runRenderLoop/, 'Sayfa geçişi DOM compositing öncesinde fiziksel kitabı senkron çizmelidir');
assert.match(viewport, /finally[\s\S]*?stopRenderLoop[\s\S]*?renderScene\(\)[\s\S]*?settleScene\(3\)/, 'Sayfa geçişi sonrasında React commit kareleri Babylon canvasını yeniden çizmelidir');
const babylonShim = read('apps/web/src/3d/babylon-core-lite.js');
assert.match(babylonShim, /@babylonjs\/core\/Engines\/engine\.js/, 'Babylon runtime Engine deep import kullanmalı');
assert.doesNotMatch(babylonShim, /from ['"]@babylonjs\/core['"]/, 'Lite shim Babylon root barrel importuna dönmemeli');
const performanceCss = read('apps/web/src/book-performance.css');
assert.match(performanceCss, /filter:\s*none\s*!important/, 'Canlı WebGL canvas üzerinde pahalı drop-shadow filtresi bulunmamalı');
assert.match(performanceCss, /babylon-book-stage::before/, 'Kitap gölgesi statik CSS katmanında korunmalı');

const bookCss = read('apps/web/src/babylon-book.css');
assert.doesNotMatch(bookCss, /\.is-turning\s+\.babylon-book-content\s*\{[^}]*animation\s*:/s, 'Sayfa dönüşü DOM mürekkep katmanının opacity animasyonunu yeniden başlatmamalı');
assert.doesNotMatch(bookCss, /@keyframes\s+babylonInkTurn/, 'Sayfa dönüşünde parlama oluşturan eski mürekkep opacity animasyonu bulunmamalı');
assert.doesNotMatch(bookCss, /\.phase-open\s+\.babylon-book-content\s*\{[^}]*animation\s*:/s, 'Kalıcı açık-kitap seçicisi içerik değişiminde reveal animasyonunu yeniden başlatmamalı');
assert.match(bookCss, /\.babylon-book-content\.is-content-entering\s*\{[^}]*babylonContentReveal/s, 'İçerik reveal animasyonu yalnız tek seferlik kitap açılışı sınıfına bağlı olmalı');
assert.match(shell, /contentEntering[\s\S]*?event\.target\s*===\s*event\.currentTarget[\s\S]*?babylonContentReveal/, 'Kitap açılış reveal durumu kendi animasyonu tamamlanınca temizlenmeli');

const content = read('apps/web/src/content/http-provider.js');
assert.match(content, /publication\.json/, 'Web yalnız publication v2 taşımasını okumalı');
const publication = read('apps/web/src/content/publication-provider.js');
assert.match(publication, /schemaVersion !== 2/, 'Tema schemaVersion 2 sınırını doğrulamalı');
const community = read('apps/web/src/community/index.js');
assert.match(community, /\/api\/community\//, 'Topluluk Defteri mevcut community API adaptörünü kullanmalı');

const syntheticArchiveDetails = Array.from({ length: 220 }, (_, index) => `kanıt-${index}`).join(' ');
const syntheticArchiveRelations = Array.from({ length: 9 }, (_, index) => ({
  relationId: `relation-${index}`,
  fromEntityId: 'entity-main',
  toEntityId: `entity-${index}`,
  label: `Bağlantı ${index}`,
}));
const syntheticArchiveFrames = buildArchiveFrames({
  entityId: 'entity-main',
  kind: 'character',
  name: 'Uzun Dosya',
  details: [{ label: 'Kanıt', value: syntheticArchiveDetails }],
}, syntheticArchiveRelations, 'desktop');
assert.ok(syntheticArchiveFrames.length > 1, 'Uzun arşiv dosyası birden fazla kitap açılımına taşmalı');
const syntheticArchivePages = syntheticArchiveFrames
  .flatMap((frame) => [frame.left, frame.right])
  .filter((page) => page?.kind === 'notes');
const restoredArchiveDetails = syntheticArchivePages
  .flatMap((page) => page.items)
  .filter((item) => item.type === 'detail')
  .map((item) => item.text)
  .join(' ')
  .replace(/\s+/gu, ' ')
  .trim();
assert.equal(restoredArchiveDetails, syntheticArchiveDetails, 'Arşiv sayfalaması ayrıntı metnini kaybetmemeli');
assert.deepEqual(
  syntheticArchivePages.flatMap((page) => page.items).filter((item) => item.type === 'relation').map((item) => item.relation.relationId),
  syntheticArchiveRelations.map((relation) => relation.relationId),
  'Arşiv sayfalaması bağlantıları kaybetmemeli veya çoğaltmamalı',
);

const syntheticJournalText = Array.from({ length: 280 }, (_, index) => `günlük-${index}`).join(' ');
const syntheticJournalSection = {
  sectionId: 'long-section',
  order: 1,
  title: 'Uzun Günlük',
  blocks: [{ type: 'paragraph', spans: [{ type: 'text', text: syntheticJournalText }] }],
};
const syntheticJournalFrames = buildJournalFrames([syntheticJournalSection], 'desktop');
const compactJournalFrames = buildJournalFrames([syntheticJournalSection], 'desktop', { capacityScale: 0.42 });
assert.ok(syntheticJournalFrames.length > 1, 'Uzun günlük metni birden fazla kitap açılımına taşmalı');
assert.ok(compactJournalFrames.length >= syntheticJournalFrames.length, 'DOM taşma düzeltmesi kapasiteyi azalttığında sayfa sayısı azalmamalı');
const restoredJournalText = syntheticJournalFrames
  .flatMap((frame) => [...(frame.leftBlocks ?? []), ...(frame.rightBlocks ?? [])])
  .filter((block) => block.type === 'paragraph')
  .flatMap((block) => block.spans ?? [])
  .map((span) => span.type === 'reference' ? span.label : span.text)
  .join('');
assert.equal(restoredJournalText, syntheticJournalText, 'Günlük sayfalaması metni kaybetmemeli veya çoğaltmamalı');

console.log('book theme integration verification passed');
