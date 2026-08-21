const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const accumulator = require("./universe-workspace-accumulate.cjs");
const core = require("./universe-workspace-core.cjs");
const revisions = require("./universe-workspace-revisions.cjs");
const workspace = require("./universe-workspace.cjs");
const mergeStore = require("./universe-merge-store.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
core.ensureSchema(db);

const firstSources = Array.from({ length: 300 }, (_, index) => `video-${String(index + 1).padStart(3, "0")}`);
const secondSources = Array.from({ length: 400 }, (_, index) => `video-${String(index + 201).padStart(3, "0")}`);
const key = "universe-character-test";

db.prepare(`INSERT INTO universe_workspace_nodes (key,run_id,kind,name,summary,aliases_json,source_video_ids_json,payload_json,state) VALUES (?,1,'character','Ömer','İlk kayıt','[]',?,?, 'approved')`)
  .run(key, JSON.stringify(firstSources), JSON.stringify({ name:"Ömer", summary:"İlk kayıt", sourceVideoIds:firstSources, details:[{ text:"İlk ayrıntı", sourceVideoIds:["video-001"] }] }));

const current = workspace.listNodes(db, { state:"approved" })[0];
assert.equal(current.sourceVideoIds.length, 300, "Workspace kaynak izi 250 videoda kesilmemeli");

const incoming = {
  key,
  runId: 2,
  kind: "character",
  name: "Ömer",
  summary: "Yeni kaynakta ek bilgi",
  aliases: ["Ömer Abi"],
  sourceVideoIds: secondSources,
  payload: { name:"Ömer", summary:"Yeni kaynakta ek bilgi", aliases:["Ömer Abi"], sourceVideoIds:secondSources, details:[{ text:"Yeni ayrıntı", sourceVideoIds:["video-600"] }] },
  state: "approved",
};
const accumulated = accumulator.accumulateNode(current, incoming, 2);
assert.equal(accumulated.sourceVideoIds.length, 600, "Yeni batch eski kaynakları düşürmeden 600 video izini biriktirmeli");
assert.match(accumulated.summary, /İlk kayıt/);
assert.match(accumulated.summary, /Yeni kaynakta ek bilgi/);
assert.deepEqual(accumulated.aliases, ["Ömer Abi"]);
assert.equal(accumulated.payload.details.length, 2);

assert.equal(revisions.propose(db, current, accumulated, 2), true);
const proposal = revisions.list(db, { state:"pending" })[0];
assert.equal(proposal.proposed.sourceVideoIds.length, 600, "Revizyon önerisi de 600 kaynak izini korumalı");
assert.equal(mergeStore.editorialBacklog(db).revisions, 1);

const applied = revisions.apply(db, proposal.id);
assert.equal(applied.node.sourceVideoIds.length, 600);
assert.match(applied.node.summary, /İlk kayıt/);
assert.match(applied.node.summary, /Yeni kaynakta ek bilgi/);
assert.equal(mergeStore.editorialBacklog(db).revisions, 0);

db.prepare(`INSERT INTO universe_workspace_nodes (key,run_id,kind,name,summary,aliases_json,source_video_ids_json,payload_json,state) VALUES ('draft-test',2,'event','Yeni olay','','[]','[]','{}','draft')`).run();
assert.deepEqual(mergeStore.editorialBacklog(db), { drafts:1, revisions:0, total:1 });

db.close();
console.log("Incremental workspace additive revisions, 600-source provenance and editorial backlog gate ready");
