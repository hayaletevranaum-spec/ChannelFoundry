const { getMeta, setMeta } = require("./storage-database.cjs");

const RELATION_CATALOG_VERSION = "2";

function sanitizeItem(item) {
  if (!item || typeof item !== "object") throw new Error("Geçersiz içerik verisi.");
  const kind = String(item.kind ?? "");
  const status = String(item.status ?? "");
  if (!["video", "character", "event", "file"].includes(kind)) throw new Error("Geçersiz içerik türü.");
  if (!["published", "draft"].includes(status)) throw new Error("Geçersiz yayın durumu.");
  return {
    key: String(item.key ?? "").trim(),
    id: String(item.id ?? "").trim(),
    kind,
    title: String(item.title ?? "").trim(),
    meta: String(item.meta ?? ""),
    summary: String(item.summary ?? ""),
    status,
  };
}

function upsertItem(db, input) {
  const item = sanitizeItem(input);
  if (!item.key || !item.id || !item.title) throw new Error("İçerik anahtarı, kimliği ve başlığı zorunludur.");
  db.prepare(`
    INSERT INTO content_items (key, id, kind, title, meta, summary, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      id = excluded.id, kind = excluded.kind, title = excluded.title, meta = excluded.meta,
      summary = excluded.summary, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(item.key, item.id, item.kind, item.title, item.meta, item.summary, item.status);
  return item;
}

function deleteItem(db, key) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) throw new Error("Silinecek içerik anahtarı gerekli.");
  const relationCount = Number(db.prepare("SELECT COUNT(*) AS count FROM relations WHERE from_key = ? OR to_key = ?").get(normalizedKey, normalizedKey).count);
  const result = db.prepare("DELETE FROM content_items WHERE key = ?").run(normalizedKey);
  return { deleted: Number(result.changes) > 0, key: normalizedKey, relationCount };
}

function sanitizeRelation(relation) {
  if (!relation || typeof relation !== "object") throw new Error("Geçersiz bağlantı verisi.");
  const source = relation.source === "base" ? "base" : "local";
  const fromKey = String(relation.fromKey ?? "").trim();
  const toKey = String(relation.toKey ?? "").trim();
  if (!fromKey || !toKey || fromKey === toKey) throw new Error("Bağlantı uçları geçersiz.");
  return {
    id: String(relation.id ?? `relation-${Date.now()}`).trim(),
    fromKey,
    toKey,
    label: String(relation.label ?? "bağlantılı").trim() || "bağlantılı",
    note: relation.note == null ? null : String(relation.note),
    source,
  };
}

function insertRelation(db, input) {
  const relation = sanitizeRelation(input);
  const pairKey = [relation.fromKey, relation.toKey].sort().join("::");
  const result = db.prepare(`
    INSERT OR IGNORE INTO relations (id, pair_key, from_key, to_key, label, note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(relation.id, pairKey, relation.fromKey, relation.toKey, relation.label, relation.note, relation.source);
  return { ...relation, inserted: Number(result.changes) > 0 };
}

function deleteRelation(db, id) {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) throw new Error("Silinecek bağlantı kimliği gerekli.");
  const result = db.prepare("DELETE FROM relations WHERE id = ?").run(normalizedId);
  return { deleted: Number(result.changes) > 0, id: normalizedId };
}

function migrateRelationCatalog(db, payload) {
  if (getMeta(db, "relation_catalog_version") === RELATION_CATALOG_VERSION) return false;
  let inserted = 0;
  for (const relation of payload?.relations ?? []) {
    const fromExists = Boolean(db.prepare("SELECT 1 AS ok FROM content_items WHERE key = ?").get(relation.fromKey));
    const toExists = Boolean(db.prepare("SELECT 1 AS ok FROM content_items WHERE key = ?").get(relation.toKey));
    if (!fromExists || !toExists) continue;
    if (insertRelation(db, relation).inserted) inserted += 1;
  }
  setMeta(db, "relation_catalog_version", RELATION_CATALOG_VERSION);
  return inserted > 0;
}

function bootstrap(db, payload) {
  const itemCount = Number(db.prepare("SELECT COUNT(*) AS count FROM content_items").get().count);
  db.exec("BEGIN IMMEDIATE;");
  try {
    let seeded = false;
    if (itemCount === 0 && (payload?.items?.length || payload?.relations?.length)) {
      for (const item of payload?.items ?? []) upsertItem(db, item);
      for (const relation of payload?.relations ?? []) insertRelation(db, relation);
      setMeta(db, "relation_catalog_version", RELATION_CATALOG_VERSION);
      seeded = true;
    } else if (payload?.relations?.length) {
      migrateRelationCatalog(db, payload);
    }
    db.exec("COMMIT;");
    return { seeded };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function loadState(db) {
  const items = db.prepare("SELECT key, id, kind, title, meta, summary, status FROM content_items ORDER BY created_at ASC, key ASC").all();
  const relations = db.prepare("SELECT id, from_key AS fromKey, to_key AS toKey, label, note, source FROM relations ORDER BY created_at ASC, id ASC").all();
  return { items, relations };
}

module.exports = { bootstrap, deleteItem, deleteRelation, insertRelation, loadState, upsertItem };
