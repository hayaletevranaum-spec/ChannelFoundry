const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrative = require("./narrative-store.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);
narrative.ensureSchema(db);

function insertNode({ key, kind, name, summary, sourceVideoIds, state = "approved", payload = {} }) {
  db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, ?)
  `).run(key, kind, name, summary, JSON.stringify(sourceVideoIds), JSON.stringify({ name, summary, ...payload }), state);
}

insertNode({
  key: "story-origin",
  kind: "story",
  name: "Başlangıç",
  summary: "Onaylı ilk hikâye kaydı.",
  sourceVideoIds: ["video-001"],
  payload: { sequence: [{ text: "İlk olay kayda geçer.", sourceVideoIds: ["video-001"] }] },
});
insertNode({
  key: "draft-hidden",
  kind: "object",
  name: "Henüz Onaylanmamış Nesne",
  summary: "Anlatıya girmemeli.",
  sourceVideoIds: ["video-draft"],
  state: "draft",
});

const firstInput = narrative.buildInput(db);
assert.equal(firstInput.hasChanges, true);
assert.deepEqual(firstInput.changes.map((item) => item.sourceKey), ["story-origin"]);
assert.equal(firstInput.changes[0].changeKind, "new");
assert.equal(firstInput.changes.some((item) => item.sourceKey === "draft-hidden"), false);
assert.deepEqual(firstInput.baselineNarrative, []);

const run1 = narrative.prepareRun(db, { model: "fixture" });
assert.equal(run1.state, "prepared");
assert.equal(run1.baselineRunId, null);
assert.equal(narrative.prepareRun(db, { model: "fixture" }).id, run1.id, "Aynı Evren girdisi aynı prepared run'ı yeniden kullanmalı");

narrative.saveDraftSections(db, run1.id, [{
  key: "chapter-origin",
  position: 0,
  title: "Başlangıç",
  body: "Onaylı ilk hikâye kaydı anlatının başlangıcını oluşturur.",
  sourceKeys: ["story-origin"],
}]);
const applied1 = narrative.applyRun(db, run1.id);
assert.equal(applied1.run.state, "applied");
assert.equal(applied1.memory.length, 1);
assert.equal(applied1.memory[0].sectionKey, "chapter-origin");
assert.equal(applied1.memory[0].state, "approved");
assert.throws(() => narrative.prepareRun(db), /yeni onaylı Evren değişikliği yok/i);

workspace.updateNode(db, {
  key: "story-origin",
  summary: "Onaylı ve editoryal olarak güncellenmiş ilk hikâye kaydı.",
  state: "approved",
});
const run2 = narrative.prepareRun(db);
assert.equal(run2.baselineRunId, run1.id);
assert.deepEqual(run2.input.changes.map((item) => [item.sourceKey, item.changeKind]), [["story-origin", "changed"]]);
assert.equal(run2.input.baselineNarrative.length, 1);
assert.equal(run2.input.baselineNarrative[0].sectionKey, "chapter-origin");

workspace.updateNode(db, {
  key: "story-origin",
  summary: "Prepared çalışmadan sonra ikinci editoryal değişiklik.",
  state: "approved",
});
assert.equal(narrative.isRunStale(db, run2.id), true);
assert.throws(() => narrative.applyRun(db, run2.id), /stale|Evren değişti/i);
assert.equal(narrative.getRun(db, run2.id).state, "stale");

const run3 = narrative.prepareRun(db);
assert.equal(run3.baselineRunId, run1.id, "Stale run baseline olmamalı");
narrative.saveDraftSections(db, run3.id, [{
  key: "chapter-origin",
  position: 0,
  title: "Başlangıç — Güncel",
  body: "Başlangıç bölümü yeni onaylı Evren bilgisine göre açıkça revize edilir.",
  sourceKeys: ["story-origin"],
}]);
const applied3 = narrative.applyRun(db, run3.id);
assert.equal(applied3.run.state, "applied");
assert.equal(applied3.memory.length, 1);
assert.equal(applied3.memory[0].title, "Başlangıç — Güncel");
const chapterRevisions = narrative.listSectionRevisions(db, "chapter-origin");
assert.equal(chapterRevisions.length, 2);
assert.equal(chapterRevisions[0].state, "approved");
assert.equal(chapterRevisions[1].state, "superseded");

insertNode({
  key: "character-new",
  kind: "character",
  name: "Yeni Karakter",
  summary: "Sonraki batch ile onaylanan yeni karakter.",
  sourceVideoIds: ["video-002"],
});
const run4 = narrative.prepareRun(db);
assert.deepEqual(run4.input.changes.map((item) => [item.sourceKey, item.changeKind]), [["character-new", "new"]]);
narrative.saveDraftSections(db, run4.id, [{
  key: "chapter-character",
  position: 1,
  title: "Yeni Karakter",
  body: "Yeni karakter anlatıya eklenmek üzere taslak hazırlanır.",
  sourceKeys: ["character-new"],
}]);
assert.equal(narrative.discardRun(db, run4.id).state, "discarded");
assert.equal(narrative.narrativeMemory(db).length, 1, "Discard edilen taslak yaşayan anlatıyı değiştirmemeli");

workspace.setNodeState(db, { keys: ["story-origin"], state: "draft" });
const afterRemoval = narrative.buildInput(db);
assert.deepEqual(afterRemoval.removed, [{ sourceType: "node", sourceKey: "story-origin" }]);
assert.deepEqual(afterRemoval.changes.map((item) => [item.sourceKey, item.changeKind]), [["character-new", "new"]], "Discard edilen run baseline olmadığı için yeni karakter tekrar input'a girmeli");

const status = narrative.status(db);
assert.equal(status.counts.applied, 2);
assert.equal(status.counts.stale, 1);
assert.equal(status.counts.discarded, 1);
assert.equal(status.counts.activeSections, 1);

console.log("Narrative store keeps approved-universe input incremental, provenance-backed, stale-safe and revision-preserving without AI calls");
