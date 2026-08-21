const fs = require("node:fs");
const path = require("node:path");
const universeMerge = require("./universe-merge.cjs");
const { resetUniverseWorkspace, snapshot } = require("./studio-universe-reset.cjs");

const CONFIRMATION = "EVRENİ YENİDEN OLUŞTUR";

function databaseFile(db) {
  const rows = db.prepare("PRAGMA database_list").all();
  const main = rows.find((row) => String(row.name) === "main");
  return String(main?.file ?? "").trim();
}

function total(values) {
  return Object.values(values ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function status(db) {
  const counts = snapshot(db);
  const merge = universeMerge.status(db);
  const active = Boolean(merge?.run && ["waiting", "running"].includes(merge.run.state));
  return {
    confirmation: CONFIRMATION,
    reset: counts.reset,
    preserved: counts.preserved,
    resetCount: total(counts.reset),
    active,
    activeRunId: active ? Number(merge.run.id) : null,
    blockedReason: active ? "Evrene İşleme çalışırken Evren yeniden oluşturulamaz. Önce çalışan işlemi durdur." : "",
  };
}

function backupFile(databasePath, userDataPath) {
  const directory = path.join(userDataPath, "backups");
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = path.extname(databasePath) || ".sqlite";
  const base = path.basename(databasePath, extension);
  return path.join(directory, `${base}.before-universe-rebuild-${stamp}${extension}`);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function reset(db, userDataPath, input = {}) {
  const before = status(db);
  if (before.active) throw new Error(before.blockedReason);
  if (String(input?.confirmation ?? "").trim() !== CONFIRMATION) {
    throw new Error(`Onay metni tam olarak “${CONFIRMATION}” olmalı.`);
  }
  const databasePath = databaseFile(db);
  if (!databasePath) throw new Error("Studio veritabanı dosyası bulunamadı.");
  db.exec("PRAGMA wal_checkpoint(FULL);");
  const backup = backupFile(databasePath, userDataPath);
  db.exec(`VACUUM INTO ${sqlString(backup)};`);
  const result = resetUniverseWorkspace(db);
  return {
    ok: true,
    backup,
    removed: result.removed,
    after: status(db),
  };
}

module.exports = { CONFIRMATION, databaseFile, reset, status };
