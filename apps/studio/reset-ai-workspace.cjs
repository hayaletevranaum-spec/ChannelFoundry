const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { resetAiWorkspace, snapshot } = require("./studio-ai-reset.cjs");

const CONFIRM_FLAG = "--confirm-reset-ai";

function databasePathFromArgs(args) {
  const index = args.indexOf("--database");
  if (index >= 0 && args[index + 1]) return path.resolve(args[index + 1]);
  return path.resolve(process.cwd(), "local-data/studio/birdesengor-studio.sqlite");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupPath(databasePath) {
  const directory = path.dirname(databasePath);
  const extension = path.extname(databasePath) || ".sqlite";
  const base = path.basename(databasePath, extension);
  return path.join(directory, `${base}.before-ai-reset-${stamp()}${extension}`);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatCounts(values) {
  return Object.entries(values)
    .filter(([, count]) => count != null)
    .map(([name, count]) => `  ${name}: ${count}`)
    .join("\n");
}

const args = process.argv.slice(2);
const databasePath = databasePathFromArgs(args);
const confirmed = args.includes(CONFIRM_FLAG);

if (!fs.existsSync(databasePath)) {
  console.error(`Studio veritabanı bulunamadı: ${databasePath}`);
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { timeout: 5000 });
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

try {
  const before = snapshot(db);
  console.log(`Studio veritabanı: ${databasePath}`);
  console.log("\nSİLİNECEK AI / EVREN ÇALIŞMA VERİLERİ");
  console.log(formatCounts(before.reset) || "  kayıt yok");
  console.log("\nKORUNACAK KATALOG / ALTYAZI / GENEL İÇERİK");
  console.log(formatCounts(before.preserved) || "  kayıt yok");

  if (!confirmed) {
    console.log("\nHenüz hiçbir veri silinmedi.");
    console.log(`Studio kapalıyken gerçekten temizlemek için:\n  node apps/studio/reset-ai-workspace.cjs ${CONFIRM_FLAG}`);
    process.exitCode = 0;
  } else {
    db.exec("PRAGMA wal_checkpoint(FULL);");
    const backup = backupPath(databasePath);
    db.exec(`VACUUM INTO ${sqlString(backup)};`);
    const result = resetAiWorkspace(db);
    console.log(`\nYedek oluşturuldu: ${backup}`);
    console.log("\nTEMİZLENEN KAYITLAR");
    console.log(formatCounts(result.removed) || "  kayıt yok");
    console.log("\nKORUNAN VERİLER");
    console.log(formatCounts(result.after.preserved) || "  kayıt yok");
    console.log("\nStudio AI çalışma alanı temiz başlangıca hazır.");
  }
} finally {
  db.close();
}
