const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

const center = read("apps/studio/src/PublishCenter.tsx");
const model = read("apps/studio/src/publish-model.ts");
const runtime = read("apps/studio/studio-runtime.cjs");
const admin = read("apps/studio/community-admin.cjs");
const connection = read("apps/studio/web-connection.cjs");
const studioApi = read("apps/web/public/api/studio/index.php");
const assetApi = read("apps/web/public/api/studio/asset.php");
const publicationApi = read("apps/web/public/api/studio/publication.php");
const publicationBuilder = read("apps/studio/publication-v2.cjs");
const communityProvider = read("apps/web/src/community/http-provider.js");
const deployWeb = read("scripts/deploy-web.sh");

assert.match(center, /KİTAP WEB · PUBLICATION V2/, "Yayınlama merkezi tek hedefi Kitap Web publication v2 olarak göstermeli");
assert.match(center, /Kitap Web'i canlıya yayınla/, "Canlı yayın publication v2 Web hedefini açıkça belirtmeli");
assert.match(center, /readiness\.readyForTheme/, "Canlı yayın 05/06 readiness kapısını zorunlu tutmalı");
assert.match(center, /exportPublicSnapshot\(\)/, "Yerel paket publication export köprüsünü kullanmalı");
assert.match(center, /publishPublicSnapshot\(\)/, "Canlı yayın mevcut IPC köprüsünden publication v2 hattını çağırmalı");
assert.doesNotMatch(center, /SCHEMA V1|universe\.json|PublicationChanges|V2 canlı yayın henüz bağlı değil/, "Yayınlama UI'sinde legacy v1 izi kalmamalı");

assert.match(model, /contentFingerprint/, "Yayın modeli publication fingerprint bilgisini taşımalı");
assert.match(model, /sectionCount/, "Yayın modeli anlatı bölüm sayısını taşımalı");
assert.match(model, /assetCount/, "Yayın modeli publication asset sayısını taşımalı");

assert.match(runtime, /uploadPublicationAsset/, "Studio canlı yayından önce publication asset'lerini yüklemeli");
assert.match(runtime, /publishPublication\(snapshot\)/, "Studio asset yüklemesinden sonra publication.json dosyasını etkinleştirmeli");
assert.match(runtime, /readyForTheme/, "Runtime hazırlık kapısını UI'dan bağımsız olarak da zorunlu tutmalı");
assert.doesNotMatch(runtime, /publishVisualManifest|buildPublicSnapshot|preparePublicVisuals/, "Runtime legacy snapshot/visual-manifest hattını kullanmamalı");

assert.match(admin, /uploadPublicationAsset/, "Admin transport publication asset yüklemeyi desteklemeli");
assert.match(admin, /publishPublication/, "Admin transport publication v2 yayınını desteklemeli");
assert.doesNotMatch(admin, /publishVisualManifest|publishSnapshot|visualManifest/, "Admin transport legacy v1 yayın fonksiyonlarını taşımamalı");

assert.match(connection, /content\/publication\.json/, "Web bağlantısı canlı publication.json adresini kullanmalı");
assert.match(connection, /api\/studio\/asset\.php/, "Web bağlantısı publication asset endpoint'ini kullanmalı");
assert.doesNotMatch(connection, /content\/universe\.json|visual\.php/, "Web bağlantısında legacy endpoint kalmamalı");

assert.match(studioApi, /channel-foundry-studio-publish-v2/, "Studio sunucu health sözleşmesi v2 olmalı");
assert.match(studioApi, /publication_validate/, "Sunucu publication v2 paketini doğrulamalı");
assert.match(assetApi, /X-Channel-Foundry-Sha256/, "Asset endpoint içerik hash doğrulaması istemeli");
assert.match(publicationApi, /schemaVersion.*2/s, "Publication endpoint yalnız schema v2 kabul etmeli");
assert.match(publicationApi, /physical_layout_forbidden/, "Sunucu fiziksel page/spread bilgisini reddetmeli");
assert.match(publicationBuilder, /publicationSupport\(db\)/, "Publication v2 onaylı sponsor ve katkı kayıtlarını DB'den üretmeli");
assert.match(publicationApi, /publication_validate_support/, "Sunucu publication support sözleşmesini doğrulamalı");
assert.match(publicationApi, /community-credits\.json/, "Sunucu eski web sürümleri için community credits dosyasını publication ile üretmeli");
assert.match(communityProvider, /publication\?\.support/, "Web sponsorları öncelikle yetkili publication paketinden okumalı");
assert.match(deployWeb, /--exclude=\/content\/community-credits\.json/, "Web deploy sunucunun ürettiği community credits dosyasını korumalı");

for (const legacy of [
  "apps/studio/publication-preview.cjs",
  "apps/studio/visual-publish.cjs",
  "apps/studio/preview-web-snapshot.cjs",
  "apps/studio/src/PublicationChanges.tsx",
  "apps/studio/src/publication-preview.css",
  "apps/web/public/api/studio/snapshot.php",
  "apps/web/public/api/studio/snapshot-editorial.php",
  "apps/web/public/api/studio/snapshot-utils.php",
  "apps/web/public/api/studio/visual.php",
]) {
  assert.equal(exists(legacy), false, `Legacy yayın kalıntısı kaldırılmalı: ${legacy}`);
}

assert.equal(exists("apps/web/public/api/studio/asset.php"), true);
assert.equal(exists("apps/web/public/api/studio/publication.php"), true);

console.log("Studio and Book Web use one publication v2 path with hashed assets, server validation and no legacy schema-v1 publishing remnants");
