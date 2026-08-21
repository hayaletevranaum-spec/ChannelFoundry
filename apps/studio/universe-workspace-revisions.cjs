const { clean, ensureSchema, hydrateNode, safeJson, textArray } = require("./universe-workspace-core.cjs");

function snap(node) {
  return {
    key: String(node.key), runId: Number(node.runId || 0), kind: String(node.kind),
    name: String(node.name || ""), summary: String(node.summary || ""),
    aliases: textArray(node.aliases, 30, 260), sourceVideoIds: textArray(node.sourceVideoIds, 2000, 100),
    payload: node.payload && typeof node.payload === "object" ? node.payload : {},
    state: node.state === "approved" ? "approved" : "draft",
  };
}
function comparable(node) {
  const value = snap(node);
  return JSON.stringify({ name:value.name, summary:value.summary, aliases:value.aliases, sourceVideoIds:value.sourceVideoIds, payload:value.payload });
}
function history(db, nodeKey, event, runId = 0, note = "", value = {}) {
  ensureSchema(db);
  db.prepare("INSERT INTO universe_workspace_history (node_key, run_id, event, note, snapshot_json) VALUES (?, ?, ?, ?, ?)")
    .run(clean(nodeKey,220), Number(runId||0), clean(event,80), clean(note,1200), JSON.stringify(value||{}));
}
function proposedBaseline(db, nodeKey, runId) {
  ensureSchema(db);
  const row = db.prepare("SELECT snapshot_json AS snapshotJson FROM universe_workspace_history WHERE node_key=? AND run_id=? AND event='revision_proposed' ORDER BY id DESC LIMIT 1")
    .get(clean(nodeKey,220), Number(runId||0));
  return row ? safeJson(row.snapshotJson, null) : null;
}
function propose(db, currentNode, proposedNode, runId) {
  ensureSchema(db);
  const current = snap(currentNode);
  const proposed = snap({ ...proposedNode, key: current.key, state: current.state, runId });
  if (comparable(current) === comparable(proposed)) return false;
  const diff = [];
  if (current.name !== proposed.name) diff.push("name");
  if (current.summary !== proposed.summary) diff.push("summary");
  if (JSON.stringify(current.aliases) !== JSON.stringify(proposed.aliases)) diff.push("aliases");
  if (JSON.stringify(current.sourceVideoIds) !== JSON.stringify(proposed.sourceVideoIds)) diff.push("sources");
  if (JSON.stringify(current.payload) !== JSON.stringify(proposed.payload)) diff.push("payload");
  db.prepare(`INSERT INTO universe_workspace_revisions (
    node_key, run_id, base_run_id, proposed_name, proposed_summary, proposed_aliases_json,
    proposed_source_video_ids_json, proposed_payload_json, diff_json, state, created_at, reviewed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, NULL)
  ON CONFLICT(node_key, run_id) DO UPDATE SET
    base_run_id=excluded.base_run_id, proposed_name=excluded.proposed_name, proposed_summary=excluded.proposed_summary,
    proposed_aliases_json=excluded.proposed_aliases_json, proposed_source_video_ids_json=excluded.proposed_source_video_ids_json,
    proposed_payload_json=excluded.proposed_payload_json, diff_json=excluded.diff_json, state='pending', created_at=CURRENT_TIMESTAMP, reviewed_at=NULL`)
    .run(current.key, Number(runId), current.runId, proposed.name, proposed.summary, JSON.stringify(proposed.aliases), JSON.stringify(proposed.sourceVideoIds), JSON.stringify(proposed.payload), JSON.stringify(diff));
  history(db, current.key, "revision_proposed", runId, `Yeni Evrene İşleme çalışması ${diff.join(", ")} alanlarında değişiklik önerdi.`, current);
  return true;
}
function rowToRevision(row) {
  return {
    id:Number(row.id), nodeKey:String(row.nodeKey), runId:Number(row.runId), baseRunId:Number(row.baseRunId||0), state:String(row.state),
    diff:textArray(safeJson(row.diffJson,[]),20,80),
    proposed:{ name:String(row.proposedName||""), summary:String(row.proposedSummary||""), aliases:textArray(safeJson(row.proposedAliasesJson,[]),30,260), sourceVideoIds:textArray(safeJson(row.proposedSourceVideoIdsJson,[]),2000,100), payload:safeJson(row.proposedPayloadJson,{}) },
    createdAt:String(row.createdAt||""), reviewedAt:row.reviewedAt ? String(row.reviewedAt) : null,
  };
}
function list(db, input={}) {
  ensureSchema(db);
  const where=[]; const params=[];
  if (input.nodeKey) { where.push("node_key=?"); params.push(clean(input.nodeKey,220)); }
  if (["pending","applied","dismissed"].includes(String(input.state||""))) { where.push("state=?"); params.push(String(input.state)); }
  return db.prepare(`SELECT id,node_key AS nodeKey,run_id AS runId,base_run_id AS baseRunId,proposed_name AS proposedName,proposed_summary AS proposedSummary,proposed_aliases_json AS proposedAliasesJson,proposed_source_video_ids_json AS proposedSourceVideoIdsJson,proposed_payload_json AS proposedPayloadJson,diff_json AS diffJson,state,created_at AS createdAt,reviewed_at AS reviewedAt FROM universe_workspace_revisions ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, id DESC`).all(...params).map(rowToRevision);
}
function node(db,key) {
  const row=db.prepare("SELECT key,run_id AS runId,kind,name,summary,aliases_json AS aliasesJson,source_video_ids_json AS sourceVideoIdsJson,payload_json AS payloadJson,state,updated_at AS updatedAt FROM universe_workspace_nodes WHERE key=?").get(key);
  return row ? hydrateNode(row) : null;
}
function apply(db,id) {
  ensureSchema(db); const revision=list(db).find((item)=>item.id===Number(id));
  if(!revision || revision.state!=="pending") throw new Error("Uygulanabilecek bekleyen revizyon bulunamadı.");
  const current=node(db,revision.nodeKey); if(!current) throw new Error("Revizyonun bağlı olduğu kayıt bulunamadı.");
  const baseline=proposedBaseline(db,revision.nodeKey,revision.runId);
  if(baseline && comparable(current)!==comparable(baseline)) throw new Error("Kayıt bu revizyon önerildikten sonra editoryal olarak değiştirildi. Eski revizyon uygulanmadı; yeni bir Evrene İşleme çalışmasıyla öneriyi yeniden oluştur.");
  db.exec("BEGIN IMMEDIATE;");
  try {
    history(db,current.key,"revision_applied",revision.runId,`Çalışma #${revision.runId} revizyonu uygulandı.`,snap(current));
    db.prepare("UPDATE universe_workspace_nodes SET run_id=?,name=?,summary=?,aliases_json=?,source_video_ids_json=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?")
      .run(revision.runId,revision.proposed.name,revision.proposed.summary,JSON.stringify(revision.proposed.aliases),JSON.stringify(revision.proposed.sourceVideoIds),JSON.stringify(revision.proposed.payload),revision.nodeKey);
    db.prepare("UPDATE universe_workspace_revisions SET state='applied',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(id));
    db.exec("COMMIT;");
  } catch(error) { db.exec("ROLLBACK;"); throw error; }
  return { revision:list(db).find((item)=>item.id===Number(id)), node:node(db,revision.nodeKey) };
}
function dismiss(db,id) {
  ensureSchema(db); const revision=list(db).find((item)=>item.id===Number(id));
  if(!revision || revision.state!=="pending") throw new Error("Kapatılabilecek bekleyen revizyon bulunamadı.");
  const current=node(db,revision.nodeKey);
  db.prepare("UPDATE universe_workspace_revisions SET state='dismissed',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(id));
  if(current) history(db,current.key,"revision_dismissed",revision.runId,`Çalışma #${revision.runId} revizyon önerisi reddedildi.`,snap(current));
  return list(db).find((item)=>item.id===Number(id));
}
function listHistory(db,nodeKey) {
  ensureSchema(db); const key=clean(nodeKey,220); if(!key) throw new Error("Geçmişi gösterilecek kayıt belirtilmedi.");
  return db.prepare("SELECT id,node_key AS nodeKey,run_id AS runId,event,note,snapshot_json AS snapshotJson,created_at AS createdAt FROM universe_workspace_history WHERE node_key=? ORDER BY id DESC").all(key).map((row)=>({ id:Number(row.id),nodeKey:String(row.nodeKey),runId:Number(row.runId||0),event:String(row.event),note:String(row.note||""),snapshot:safeJson(row.snapshotJson,{}),createdAt:String(row.createdAt||"") }));
}
module.exports={ apply, dismiss, history, list, listHistory, propose, proposedBaseline, snap };
