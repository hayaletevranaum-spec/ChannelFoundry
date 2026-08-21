const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const universeMerge = require("./universe-merge.cjs");
const workspace = require("./universe-workspace.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
universeMerge.ensureSchema(db);
workspace.ensureSchema(db);

function universe(summary) {
  return {
    stories: [{ name:"Babil Dosyası", aliases:[], summary, sourceVideoIds:["video-a"], sequence:[], characterNames:[], locationNames:[], objectNames:[], visual:{} }],
    characters:[], events:[], locations:[], objects:[], relations:[],
  };
}
function insertRun(id, value) {
  db.prepare(`INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
    VALUES (?, 'done', 'test-model', 1, 'video-a', ?, CURRENT_TIMESTAMP)`).run(id, JSON.stringify(value));
}

insertRun(1, universe("İlk onaylı özet"));
workspace.applyRun(db, 1);
const story = workspace.listNodes(db)[0];
workspace.setNodeState(db, { keys:[story.key], state:"approved" });
assert.equal(workspace.status(db).counts.pendingRevisions, 0);

insertRun(2, universe("Yeni kaynaklarla önerilen özet"));
const second = workspace.applyRun(db, 2);
assert.equal(second.approvedProtected, 1, "Onaylı kayıt doğrudan ezilmemeli");
assert.equal(second.revisionProposed, 1, "Onaylı kayda değişiklik revizyon önerisi olmalı");
assert.equal(workspace.listNodes(db)[0].summary, "İlk onaylı özet");
assert.equal(workspace.status(db).counts.pendingRevisions, 1);
const pending = workspace.listRevisions(db, { state:"pending" })[0];
assert.equal(pending.nodeKey, story.key);
assert.equal(pending.proposed.summary, "Yeni kaynaklarla önerilen özet");
assert.equal(pending.diff.includes("summary") || pending.diff.includes("payload"), true);

const applied = workspace.applyRevision(db, pending.id);
assert.equal(applied.node.summary, "Yeni kaynaklarla önerilen özet");
assert.equal(applied.node.state, "approved", "Revizyon uygulamak editoryal onayı düşürmemeli");
assert.equal(workspace.status(db).counts.pendingRevisions, 0);
assert.equal(workspace.listRevisions(db, { state:"applied" }).length, 1);

insertRun(3, universe("Reddedilecek üçüncü özet"));
workspace.applyRun(db, 3);
const rejected = workspace.listRevisions(db, { state:"pending" })[0];
assert.ok(rejected);
workspace.dismissRevision(db, rejected.id);
assert.equal(workspace.listNodes(db)[0].summary, "Yeni kaynaklarla önerilen özet");
assert.equal(workspace.listRevisions(db, { state:"dismissed" }).length, 1);

const events = workspace.listHistory(db, story.key).map((entry) => entry.event);
assert.equal(events.includes("approved"), true);
assert.equal(events.includes("revision_proposed"), true);
assert.equal(events.includes("revision_applied"), true);
assert.equal(events.includes("revision_dismissed"), true);

db.close();
console.log("Universe revision proposals, approval protection, apply/dismiss lifecycle and record history ready");
