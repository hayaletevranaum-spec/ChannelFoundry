const universeMerge = require("./universe-merge.cjs");
const { clean, ensureSchema, nodeIndex, nodeRows, normalizedName, relationKey, textArray } = require("./universe-workspace-core.cjs");
const { status } = require("./universe-workspace-store.cjs");

function applyRun(db, requestedRunId = null) {
  ensureSchema(db);
  const result = universeMerge.latestResult(db, requestedRunId);
  if (!result || result.state !== "done") throw new Error("Çalışma alanına uygulanabilecek tamamlanmış bir Evrene İşleme sonucu yok.");
  if (!result.complete) throw new Error(`Eksik Evrene İşleme sonucu çalışma alanına uygulanamaz: ${result.sourceCoverage.actual}/${result.sourceCoverage.expected} kaynak video korunmuş.`);
  const rows = nodeRows(result.universe);
  const index = nodeIndex(rows);
  const insertNode = db.prepare(`INSERT INTO universe_workspace_nodes (key,run_id,kind,name,summary,aliases_json,source_video_ids_json,payload_json,state) VALUES (?,?,?,?,?,?,?,?,'draft') ON CONFLICT(key) DO NOTHING`);
  const updateDraftNode = db.prepare(`UPDATE universe_workspace_nodes SET run_id=?,name=?,summary=?,aliases_json=?,source_video_ids_json=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=? AND state='draft'`);
  const nodeState = db.prepare("SELECT state FROM universe_workspace_nodes WHERE key=?");
  const insertRelation = db.prepare(`INSERT INTO universe_workspace_relations (key,run_id,from_key,to_key,label,source_video_ids_json,payload_json,state) VALUES (?,?,?,?,?,?,?,'draft') ON CONFLICT(key) DO NOTHING`);
  const updateDraftRelation = db.prepare(`UPDATE universe_workspace_relations SET run_id=?,from_key=?,to_key=?,label=?,source_video_ids_json=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=? AND state='draft'`);
  const relationState = db.prepare("SELECT state FROM universe_workspace_relations WHERE key=?");
  let created=0,updated=0,approvedProtected=0,relationCreated=0,relationUpdated=0,relationSkipped=0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rows) {
      const existing = nodeState.get(row.key);
      if (!existing) created += Number(insertNode.run(row.key,result.id,row.kind,row.name,row.summary,JSON.stringify(row.aliases),JSON.stringify(row.sourceVideoIds),JSON.stringify(row.payload)).changes);
      else if (existing.state === "draft") updated += Number(updateDraftNode.run(result.id,row.name,row.summary,JSON.stringify(row.aliases),JSON.stringify(row.sourceVideoIds),JSON.stringify(row.payload),row.key).changes);
      else approvedProtected += 1;
    }
    for (const relation of Array.isArray(result.universe?.relations) ? result.universe.relations : []) {
      const fromKey = index.get(`${clean(relation.fromType,20)}:${normalizedName(relation.fromName)}`);
      const toKey = index.get(`${clean(relation.toType,20)}:${normalizedName(relation.toName)}`);
      if (!fromKey || !toKey || fromKey === toKey) { relationSkipped += 1; continue; }
      const label = clean(relation.label || "bağlantılı",180) || "bağlantılı";
      const key = relationKey(fromKey,toKey,label);
      const sourceVideoIds = textArray(relation.sourceVideoIds,2000,100);
      const existing = relationState.get(key);
      if (!existing) relationCreated += Number(insertRelation.run(key,result.id,fromKey,toKey,label,JSON.stringify(sourceVideoIds),JSON.stringify(relation)).changes);
      else if (existing.state === "draft") relationUpdated += Number(updateDraftRelation.run(result.id,fromKey,toKey,label,JSON.stringify(sourceVideoIds),JSON.stringify(relation),key).changes);
    }
    const nodeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_nodes WHERE run_id=?").get(result.id)?.count ?? 0);
    const relationCount = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_relations WHERE run_id=?").get(result.id)?.count ?? 0);
    db.prepare(`INSERT INTO universe_workspace_imports (run_id,analysis_count,model,node_count,relation_count,imported_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(run_id) DO UPDATE SET analysis_count=excluded.analysis_count,model=excluded.model,node_count=excluded.node_count,relation_count=excluded.relation_count,imported_at=CURRENT_TIMESTAMP`).run(result.id,result.analysisCount,result.model,nodeCount,relationCount);
    db.exec("COMMIT;");
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
  return { ok:true,runId:result.id,created,updated,approvedProtected,relationCreated,relationUpdated,relationSkipped,...status(db) };
}
module.exports = { applyRun };
