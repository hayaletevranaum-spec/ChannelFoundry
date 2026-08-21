const { clean, ensureSchema, hydrateNode, safeJson, textArray } = require("./universe-workspace-core.cjs");

function listNodes(db, input = {}) {
  ensureSchema(db);
  const where = [];
  const params = [];
  if (input?.kind && ["story", "character", "event", "location", "object"].includes(String(input.kind))) {
    where.push("kind=?");
    params.push(String(input.kind));
  }
  if (input?.state && ["draft", "approved"].includes(String(input.state))) {
    where.push("state=?");
    params.push(String(input.state));
  }
  const rows = db.prepare(`
    SELECT key, run_id AS runId, kind, name, summary,
           aliases_json AS aliasesJson, source_video_ids_json AS sourceVideoIdsJson,
           payload_json AS payloadJson, state, updated_at AS updatedAt
    FROM universe_workspace_nodes
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE kind WHEN 'story' THEN 1 WHEN 'character' THEN 2 WHEN 'event' THEN 3 WHEN 'location' THEN 4 ELSE 5 END,
             name COLLATE NOCASE ASC
  `).all(...params);
  return rows.map(hydrateNode);
}

function listRelations(db, input = {}) {
  ensureSchema(db);
  const where = [];
  const params = [];
  if (input?.state && ["draft", "approved"].includes(String(input.state))) {
    where.push("state=?");
    params.push(String(input.state));
  }
  return db.prepare(`
    SELECT key, run_id AS runId, from_key AS fromKey, to_key AS toKey, label,
           source_video_ids_json AS sourceVideoIdsJson, state, updated_at AS updatedAt
    FROM universe_workspace_relations
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC, key ASC
  `).all(...params).map((row) => ({
    key: String(row.key),
    runId: Number(row.runId),
    fromKey: String(row.fromKey),
    toKey: String(row.toKey),
    label: String(row.label ?? "bağlantılı"),
    sourceVideoIds: textArray(safeJson(row.sourceVideoIdsJson, []), 250, 100),
    state: row.state === "approved" ? "approved" : "draft",
    updatedAt: String(row.updatedAt ?? ""),
  }));
}

function syncRelationStates(db) {
  db.exec(`
    UPDATE universe_workspace_relations
    SET state = CASE
      WHEN EXISTS (SELECT 1 FROM universe_workspace_nodes n WHERE n.key=from_key AND n.state='approved')
       AND EXISTS (SELECT 1 FROM universe_workspace_nodes n WHERE n.key=to_key AND n.state='approved')
      THEN 'approved' ELSE 'draft' END,
      updated_at = CURRENT_TIMESTAMP;
  `);
}

function setNodeState(db, input) {
  ensureSchema(db);
  const state = String(input?.state ?? "");
  if (!["draft", "approved"].includes(state)) throw new Error("Geçersiz editoryal durum.");
  const keys = Array.from(new Set((Array.isArray(input?.keys) ? input.keys : []).map((key) => clean(key, 220)).filter(Boolean))).slice(0, 5000);
  if (!keys.length) throw new Error("Durumu değiştirilecek en az bir evren düğümü seçilmeli.");

  const exists = db.prepare("SELECT 1 AS ok FROM universe_workspace_nodes WHERE key=?");
  const update = db.prepare("UPDATE universe_workspace_nodes SET state=?, updated_at=CURRENT_TIMESTAMP WHERE key=? AND state<>?");
  let affected = 0;
  let missing = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const key of keys) {
      if (!exists.get(key)) { missing += 1; continue; }
      affected += Number(update.run(state, key, state).changes);
    }
    syncRelationStates(db);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { ok: true, state, requested: keys.length, affected, missing, ...status(db) };
}

function updateNode(db, input) {
  ensureSchema(db);
  const key = clean(input?.key, 220);
  if (!key) throw new Error("Güncellenecek editoryal kayıt belirtilmedi.");
  const row = db.prepare(`
    SELECT key, run_id AS runId, kind, name, summary,
           aliases_json AS aliasesJson, source_video_ids_json AS sourceVideoIdsJson,
           payload_json AS payloadJson, state, updated_at AS updatedAt
    FROM universe_workspace_nodes WHERE key=?
  `).get(key);
  if (!row) throw new Error("Editoryal kayıt bulunamadı.");
  const current = hydrateNode(row);
  const name = clean(input?.name ?? current.name, 260);
  if (!name) throw new Error("Editoryal kayıt adı boş bırakılamaz.");
  const summary = clean(input?.summary ?? current.summary, 12000);
  const aliases = textArray(input?.aliases ?? current.aliases, 30, 260);
  const state = String(input?.state ?? current.state);
  if (!["draft", "approved"].includes(state)) throw new Error("Geçersiz editoryal durum.");
  const payload = current.payload && typeof current.payload === "object" ? { ...current.payload } : {};
  payload.name = name;
  payload.summary = summary;
  payload.aliases = aliases;
  for (const field of ["roles", "storyNames", "characterNames", "locationNames", "objectNames"]) {
    if (Object.prototype.hasOwnProperty.call(input ?? {}, field)) payload[field] = textArray(input[field], 80, 260);
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      UPDATE universe_workspace_nodes
      SET name=?, summary=?, aliases_json=?, payload_json=?, state=?, updated_at=CURRENT_TIMESTAMP
      WHERE key=?
    `).run(name, summary, JSON.stringify(aliases), JSON.stringify(payload), state, key);
    syncRelationStates(db);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  const updated = db.prepare(`
    SELECT key, run_id AS runId, kind, name, summary,
           aliases_json AS aliasesJson, source_video_ids_json AS sourceVideoIdsJson,
           payload_json AS payloadJson, state, updated_at AS updatedAt
    FROM universe_workspace_nodes WHERE key=?
  `).get(key);
  return hydrateNode(updated);
}

function status(db) {
  ensureSchema(db);
  const count = (where = "", params = []) => Number(db.prepare(`SELECT COUNT(*) AS count FROM universe_workspace_nodes ${where}`).get(...params)?.count ?? 0);
  const latest = db.prepare(`
    SELECT run_id AS runId, analysis_count AS analysisCount, model, node_count AS nodeCount,
           relation_count AS relationCount, imported_at AS importedAt
    FROM universe_workspace_imports ORDER BY imported_at DESC, run_id DESC LIMIT 1
  `).get();
  const relations = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_relations").get()?.count ?? 0);
  const approvedRelations = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_relations WHERE state='approved'").get()?.count ?? 0);
  return {
    latestImport: latest ? {
      runId: Number(latest.runId),
      analysisCount: Number(latest.analysisCount),
      model: String(latest.model ?? ""),
      nodeCount: Number(latest.nodeCount),
      relationCount: Number(latest.relationCount),
      importedAt: String(latest.importedAt ?? ""),
    } : null,
    counts: {
      total: count(),
      draft: count("WHERE state='draft'"),
      approved: count("WHERE state='approved'"),
      stories: count("WHERE kind='story'"),
      characters: count("WHERE kind='character'"),
      events: count("WHERE kind='event'"),
      locations: count("WHERE kind='location'"),
      objects: count("WHERE kind='object'"),
      relations,
      approvedRelations,
    },
  };
}

module.exports = { listNodes, listRelations, setNodeState, updateNode, status };
