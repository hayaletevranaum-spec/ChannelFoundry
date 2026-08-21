function normalizeKeys(value) {
  if (!Array.isArray(value)) throw new Error("Toplu işlem için içerik listesi gerekli.");
  const keys = [...new Set(value.map((key) => String(key || "").trim()).filter(Boolean))];
  if (!keys.length) throw new Error("En az bir içerik seçmelisin.");
  if (keys.length > 500) throw new Error("Tek toplu işlemde en fazla 500 içerik seçilebilir.");
  return keys;
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function applyBulkOperation(db, input) {
  const keys = normalizeKeys(input?.keys);
  const action = String(input?.action || "");
  if (!["publish", "draft", "delete"].includes(action)) {
    throw new Error("Geçersiz toplu işlem.");
  }

  const requestedMarks = placeholders(keys.length);
  const existing = db.prepare(`SELECT key FROM content_items WHERE key IN (${requestedMarks})`).all(...keys).map((row) => row.key);
  if (!existing.length) throw new Error("Seçilen içerikler artık arşivde bulunmuyor.");
  const existingMarks = placeholders(existing.length);

  let affectedRelations = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    if (action === "delete") {
      affectedRelations = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM relations
        WHERE from_key IN (${existingMarks}) OR to_key IN (${existingMarks})
      `).get(...existing, ...existing).count);
      db.prepare(`DELETE FROM content_items WHERE key IN (${existingMarks})`).run(...existing);
    } else {
      const status = action === "publish" ? "published" : "draft";
      db.prepare(`UPDATE content_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE key IN (${existingMarks})`).run(status, ...existing);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    ok: true,
    action,
    requested: keys.length,
    affected: existing.length,
    affectedRelations,
    missing: keys.length - existing.length,
  };
}

module.exports = { applyBulkOperation };
