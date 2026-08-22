const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const appearance = read("src/studio-appearance.ts");
const settings = read("src/AppearanceSettings.tsx");
const pipeline = read("src/StudioPipeline.tsx");
const aiWorkbench = read("src/AiWorkbench.tsx");
const entry = read("src/main.tsx");
const accessibility = read("src/studio-accessibility.css");
const workspaceLayout = read("src/studio-workspace-layout.css");
const tokens = read("src/studio-theme-tokens.css");
const bindings = read("src/studio-theme-bindings.css");

assert.match(appearance, /theme:\s*"dark",\s*textSize:\s*"comfortable"/, "Studio varsayılanı uzun okumaya uygun rahat metin olmalı");
assert.match(appearance, /channel-foundry:studio-appearance-v1/, "Görünüm tercihi cihazda kalıcı saklanmalı");
assert.match(appearance, /dataset\.studioTheme/, "Tema document köküne uygulanmalı");
assert.match(appearance, /dataset\.studioTextSize/, "Metin ölçeği document köküne uygulanmalı");

for (const option of ["standard", "comfortable", "large", "dark", "light"]) {
  assert.ok(settings.includes(`\"${option}\"`), `Ayarlar görünüm seçeneğini içermeli: ${option}`);
}
assert.match(settings, /Okuma yardımı etkin/, "Okuma konforu davranışı kullanıcıya açıklanmalı");
assert.match(pipeline, /<AppearanceSettings\/>/, "Görünüm seçenekleri Ayarlar sayfasına bağlanmalı");

assert.match(entry, /applyStudioAppearance\(readStudioAppearance\(\)\)/, "Tercihler React render edilmeden uygulanmalı");
const tokenImport = entry.indexOf('import "./studio-theme-tokens.css"');
const baseImport = entry.indexOf('import "./styles.css"');
const layoutImport = entry.indexOf('import "./studio-layout.css"');
const workspaceImport = entry.indexOf('import "./studio-workspace-layout.css"');
const accessibilityImport = entry.indexOf('import "./studio-accessibility.css"');
const bindingImport = entry.indexOf('import "./studio-theme-bindings.css"');
assert.ok(tokenImport >= 0 && tokenImport < baseImport, "Semantic tema tokenları bileşen CSS'lerinden önce yüklenmeli");
assert.ok(workspaceImport > layoutImport, "Workspace kompozisyonu ana Studio layoutundan sonra yüklenmeli");
assert.ok(accessibilityImport > workspaceImport, "Erişilebilirlik katmanı workspace kompozisyonundan sonra yüklenmeli");
assert.ok(bindingImport > accessibilityImport, "Semantic tema binding katmanı bütün layout ve erişilebilirlik stillerinden sonra yüklenmeli");
assert.doesNotMatch(entry, /studio-light-theme\.css/, "Eski ayrı light-theme katmanı runtime'a dönmemeli");
assert.equal(fs.existsSync(path.join(root, "src/studio-light-theme.css")), false, "Eski studio-light-theme.css fiziksel olarak kaldırılmalı");

assert.match(accessibility, /data-studio-text-size="comfortable"/, "Rahat tipografi tokenları bulunmalı");
assert.match(accessibility, /data-studio-text-size="large"/, "Büyük tipografi tokenları bulunmalı");
assert.match(accessibility, /max-width:82ch/, "Uzun metin satırı okunabilir ölçüyle sınırlandırılmalı");
assert.match(accessibility, /focus-visible/, "Klavye odağı görünür olmalı");
assert.match(accessibility, /prefers-reduced-motion:reduce/, "Sistem azaltılmış hareket tercihi gözetilmeli");
assert.doesNotMatch(accessibility, /data-studio-theme="light"/, "Erişilebilirlik katmanı renk teması sahiplenmemeli");
assert.match(accessibility, /var\(--focus-ring\)/, "Erişilebilirlik odağı semantic token kullanmalı");
assert.match(accessibility, /var\(--surface-panel-soft\)/, "Görünüm kontrolleri semantic yüzey tokenı kullanmalı");

for (const token of [
  "--surface-canvas",
  "--surface-panel",
  "--surface-panel-soft",
  "--surface-input",
  "--surface-selected",
  "--text-primary",
  "--text-muted",
  "--border-soft",
  "--border-control",
  "--accent",
  "--state-success",
  "--state-warning",
  "--state-danger",
]) {
  assert.ok(tokens.includes(token), `Semantic Studio tokenı bulunmalı: ${token}`);
}
for (const token of [
  "--layout-records-stack-gap",
  "--layout-records-tabs-min-height",
  "--layout-records-tabs-offset",
  "--layout-records-columns",
  "--layout-records-column-gap",
  "--layout-records-min-height",
  "--layout-records-list-max-height",
]) {
  assert.ok(tokens.includes(token), `Kayıt Dosyaları ortak layout tokenı bulunmalı: ${token}`);
}
assert.match(tokens, /html\[data-studio-theme="light"\]/, "Açık tema yalnız semantic token değerlerini değiştirmeli");
assert.match(tokens, /--surface-panel:#fbf7ef/, "Açık tema sıcak kâğıt ana panel yüzeyine sahip olmalı");
assert.match(tokens, /--surface-input:#fffdf8/, "Açık tema form yüzeyi okunabilir açık tona sahip olmalı");
assert.match(tokens, /--text-primary:#302820/, "Açık tema ana metni yüksek kontrastlı koyu tona sahip olmalı");

assert.match(bindings, /\.studio-shell :where\(\.panel,\.metric-card/, "Ortak Studio yüzeyleri semantic token binding kullanmalı");
assert.match(bindings, /\.ops-dashboard\{[\s\S]*--ops-panel:var\(--surface-panel\)/, "Dashboard yerel paleti semantic tokenlara bağlanmalı");
assert.match(bindings, /\.catalog-filters\{[\s\S]*var\(--surface-panel-soft\)/, "Video Arşivi semantic yüzey kullanmalı");
assert.match(bindings, /\.analysis-curation-list>div>button\{[\s\S]*var\(--surface-panel\)/, "Ayıklama listesi semantic yüzey kullanmalı");
assert.match(bindings, /\.community-connection-facts,[\s\S]*\.ai-provider-facts/, "Ayarlar facts tabloları ortak semantic yüzeye bağlanmalı");
assert.match(bindings, /\.community-connection-facts>div,[\s\S]*background:var\(--surface-panel-soft\)/, "Yönetici bağlantısı koyu ada olarak kalmamalı");
assert.match(bindings, /\.review-mode-header nav button\{[\s\S]*background:var\(--surface-panel-soft\)/, "04 İnceleme sekmeleri semantic yüzey kullanmalı");
assert.match(bindings, /\.review-mode-header nav button\.active\{[\s\S]*background:var\(--surface-selected\)/, "04 İnceleme aktif sekmesi semantic seçili yüzey kullanmalı");
assert.match(bindings, /\.record-detail-shell\{[\s\S]*var\(--surface-panel\)/, "Kayıt Dosyaları editörü semantic yüzey kullanmalı");
assert.match(bindings, /\.support-records-index,[\s\S]*\.support-records-editor\{[\s\S]*var\(--surface-panel\)/, "Sponsor & Katkı editörü semantic yüzey kullanmalı");
assert.match(bindings, /\.support-records-list>button\.active\{[\s\S]*var\(--surface-selected\)/, "Sponsor & Katkı seçili kaydı semantic seçili yüzey kullanmalı");
assert.match(bindings, /\.support-published-state\{[\s\S]*var\(--state-success\)/, "Sponsor & Katkı yayın durumu semantic başarı tokenını kullanmalı");
assert.match(bindings, /\.theme-publication-metrics>div/, "Yayınlama metrikleri semantic tema binding'inde kapsanmalı");
assert.match(bindings, /\.narrative-header,[\s\S]*\.visual-completion-list>button/, "05 ve 06 aşamaları semantic tema sisteminde kapsanmalı");
assert.doesNotMatch(bindings, /html\[data-studio-theme="light"\]/, "Binding katmanı tema özel selector kullanmamalı; fark token değerlerinde kalmalı");
assert.doesNotMatch(bindings, /#[0-9a-f]{3,8}\b/i, "Tema binding katmanında hard-coded hex renk bulunmamalı; renk değerleri yalnız token dosyasında yaşamalı");

assert.match(aiWorkbench, /className="ai-stage-content"/, "AI Atölyesi aktif aşamayı tek ana panelin içerik gövdesinde çalıştırmalı");
assert.match(workspaceLayout, /\.ai-production-workbench\{[\s\S]*gap:0!important/, "AI Atölyesi dış kabuğu tek kesintisiz çalışma paneli olmalı");
assert.match(workspaceLayout, /\.ai-production-workbench>\.ai-activity\{[\s\S]*box-shadow:none!important/, "AI durum alanı ana panelden ayrı kart gibi görünmemeli");
assert.match(workspaceLayout, /\.ai-stage-content\{[\s\S]*background:var\(--surface-panel\)/, "AI aktif aşama gövdesi semantic ana yüzeyi kullanmalı");
assert.match(workspaceLayout, /\.editorial-list>button\.selected\{[\s\S]*background:var\(--surface-selected\)/, "Kayıt Dosyaları seçili satırı tema seçili yüzeyini kullanmalı");
assert.match(workspaceLayout, /\.editorial-list>button:hover\{[\s\S]*background:var\(--surface-hover\)/, "Kayıt Dosyaları hover satırı koyu fallback'e dönmemeli");
assert.match(workspaceLayout, /\.editorial-layout,\s*\.support-records-layout\{[\s\S]*grid-template-columns:var\(--layout-records-columns\)/, "Sponsor & Katkı normal kayıt sekmeleriyle aynı token-owned kolon gridini kullanmalı");
assert.match(workspaceLayout, /\.editorial-browser,[\s\S]*\.support-records-editor\{[\s\S]*min-height:var\(--layout-records-min-height\)/, "Sponsor & Katkı panel yüksekliği ortak kayıt layout tokenına bağlı olmalı");
assert.doesNotMatch(workspaceLayout, /#[0-9a-f]{3,8}\b/i, "Workspace layout katmanında hard-coded hex renk bulunmamalı");

console.log("Studio appearance uses semantic design tokens, unified AI workspace surfaces, readable typography and tokenized record states");
