import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dist = path.join(root, "apps", "web", "dist");
const limits = {
  jsFile: 2.5 * 1024 * 1024,
  jsTotal: 3.5 * 1024 * 1024,
  cssTotal: 700 * 1024,
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

async function requireFile(target, label) {
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`${label} bulunamadı: ${path.relative(root, target)}`);
  }
}

async function assertAbsent(target, label) {
  try {
    await stat(target);
    throw new Error(`${label} artık production build içinde bulunmamalı: ${path.relative(root, target)}`);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function publicationSeedCount(snapshot) {
  return [
    snapshot?.journal?.sections,
    snapshot?.archive?.entities,
    snapshot?.archive?.relations,
    snapshot?.assets,
    snapshot?.support?.sponsors,
    snapshot?.support?.contributors,
  ].reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
}

async function main() {
  await requireFile(path.join(dist, "index.html"), "Web giriş dosyası");
  await requireFile(path.join(dist, "api", "studio", "index.php"), "Studio API build çıktısı");
  await requireFile(path.join(dist, "api", "community", "index.php"), "Topluluk API build çıktısı");
  await requireFile(path.join(dist, "api", "youtube", "index.php"), "YouTube kamera API build çıktısı");
  await requireFile(path.join(dist, "scene", "closed-journal-v2.png"), "Fotogerçekçi kapalı defter scene asseti");
  await requireFile(path.join(dist, "scene", "journal-cover-alchemy-v1.webp"), "Animasyon kapak dokusu");
  await requireFile(path.join(dist, "scene", "community-cover-leather-v1.webp"), "Topluluk Defteri animasyon kapak dokusu");
  await requireFile(path.join(dist, "scene", "handheld-camcorder-v2.png"), "El kamerası scene asseti");
  await requireFile(path.join(dist, "scene", "metaphysical-apparition-v1.png"), "Metafizik varlık scene asseti");
  await requireFile(path.join(dist, "robots.txt"), "robots.txt");

  const files = await walk(dist);
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  if (sourceMaps.length) {
    throw new Error(`Production build source map içeriyor: ${sourceMaps.map((file) => path.relative(dist, file)).join(", ")}`);
  }

  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const jsStats = await Promise.all(jsFiles.map(async (file) => ({ file, size: (await stat(file)).size })));
  const cssStats = await Promise.all(cssFiles.map(async (file) => ({ file, size: (await stat(file)).size })));
  const jsTotal = jsStats.reduce((sum, item) => sum + item.size, 0);
  const cssTotal = cssStats.reduce((sum, item) => sum + item.size, 0);
  const largestJs = jsStats.sort((a, b) => b.size - a.size)[0];

  if (!largestJs) throw new Error("Production build JavaScript çıktısı üretmedi.");
  if (largestJs.size > limits.jsFile) throw new Error(`En büyük JS parçası sınırı aşıyor: ${path.basename(largestJs.file)} ${formatBytes(largestJs.size)} > ${formatBytes(limits.jsFile)}`);
  if (jsTotal > limits.jsTotal) throw new Error(`Toplam JS boyutu sınırı aşıyor: ${formatBytes(jsTotal)} > ${formatBytes(limits.jsTotal)}`);
  if (cssTotal > limits.cssTotal) throw new Error(`Toplam CSS boyutu sınırı aşıyor: ${formatBytes(cssTotal)} > ${formatBytes(limits.cssTotal)}`);

  const seedPath = path.join(dist, "content", "publication.json");
  const creditsSeedPath = path.join(dist, "content", "community-credits.json");
  await requireFile(seedPath, "Repository publication v2 tohumu");
  await requireFile(creditsSeedPath, "Repository legacy community credits tohumu");
  await assertAbsent(path.join(dist, "content", "universe.json"), "Legacy universe.json");
  const seed = JSON.parse(await readFile(seedPath, "utf8"));
  if (seed?.schemaVersion !== 2) throw new Error(`Repository publication tohumu schemaVersion 2 olmalı; gelen: ${seed?.schemaVersion ?? "yok"}`);
  if (!seed?.publication || !seed?.journal || !seed?.archive || !Array.isArray(seed?.assets)
      || !Array.isArray(seed?.support?.sponsors) || !Array.isArray(seed?.support?.contributors)) {
    throw new Error("Repository publication v2 tohumu temel sözleşme ve support alanlarını taşımıyor.");
  }
  const seedCount = publicationSeedCount(seed);
  if (seedCount !== 0) throw new Error(`Build içine gerçek publication v2 içeriği gömülmüş görünüyor (${seedCount} kayıt/asset). Canlı içerik Studio yayın hattından gelmeli.`);
  const creditsSeed = JSON.parse(await readFile(creditsSeedPath, "utf8"));
  if (creditsSeed?.schemaVersion !== 1
      || !Array.isArray(creditsSeed?.sponsors) || creditsSeed.sponsors.length
      || !Array.isArray(creditsSeed?.contributors) || creditsSeed.contributors.length) {
    throw new Error("Repository legacy community credits tohumu boş ve schemaVersion 1 olmalı.");
  }

  console.log("web production audit: ok");
  console.log(`  JS: ${jsFiles.length} parça · toplam ${formatBytes(jsTotal)} · en büyük ${formatBytes(largestJs.size)}`);
  console.log(`  CSS: ${cssFiles.length} parça · toplam ${formatBytes(cssTotal)}`);
  console.log("  source map: yok");
  console.log("  repository publication v2 + legacy credits seed: temiz");
  console.log("  Ana günlük + Topluluk Defteri eşleşen animasyon kaplamaları + el kamerası: hazır");
  console.log("  YouTube kamera API: hazır");
}

main().catch((error) => {
  console.error(`web production audit: FAILED\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
