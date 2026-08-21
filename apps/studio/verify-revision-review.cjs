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
    stories: [{ name: "Babil Dosyası", aliases: [], summary, sourceVideoIds: ["video-a"], sequence: [], characterNames: [], locationNames: [], objectNames: [], visual: {} }],
    characters: [], events: [], locations: [], objects: [], relations: [],
  };
}
function run(id, summary) {
  db.prepare(`INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
    VALUES (?, 'done', 'test-model', 1, 'video-a', ?, CURRENT_TIMESTAMP)`).run(id, JSON.stringify(universe(summary)));
}

run(1, "İlk kayıt");
workspace.applyRun(db, 1);
const story = workspace.listNodes(db)[0];
workspace.setNodeState(db, { keys: [story.key], state: "approved" });

run(2, "Revizyon önerisi");
workspace.applyRun(db, 2);
const revisions = workspace.listNodes(db, { view: "revisions", state: "pending" });
assert.equal(revisions.length, 1);
assert.equal(revisions[0].proposed.summary, "Revizyon önerisi");
const historyBefore = workspace.listNodes(db, { view: "history", nodeKey: story.key });
assert.equal(historyBefore.some((entry) => entry.event === "revision_proposed"), true);

workspace.updateNode(db, { action: "apply-revision", id: revisions[0].id });
assert.equal(workspace.listNodes(db)[0].summary, "Revizyon önerisi");
assert.equal(workspace.listNodes(db)[0].state, "approved");

run(3, "Çakışacak öneri");
workspace.applyRun(db, 3);
const stale = workspace.listNodes(db, { view: "revisions", state: "pending" })[0];
workspace.updateNode(db, { key: story.key, summary: "Editoryal ara düzeltme" });
assert.throws(() => workspace.updateNode(db, { action: "apply-revision", id: stale.id }), /editoryal olarak değiştirildi/);
assert.equal(workspace.listNodes(db)[0].summary, "Editoryal ara düzeltme");
workspace.updateNode(db, { action: "dismiss-revision", id: stale.id });
assert.equal(workspace.listNodes(db, { view: "revisions", state: "pending" }).length, 0);
assert.equal(workspace.listNodes(db, { view: "revisions", state: "dismissed" }).length, 1);

const historyAfter = workspace.listNodes(db, { view: "history", nodeKey: story.key });
assert.equal(historyAfter.some((entry) => entry.event === "revision_applied"), true);
assert.equal(historyAfter.some((entry) => entry.event === "editorial_update"), true);
assert.equal(historyAfter.some((entry) => entry.event === "revision_dismissed"), true);

db.close();
console.log("revision review list/history bridge, decisions and stale-edit protection ready");
