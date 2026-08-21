const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const ingest = require("./universe-ingest.cjs");
const workspace = require("./universe-workspace.cjs");
const narrative = require("./narrative-store.cjs");
const visualCompletion = require("./visual-completion-store.cjs");
const { resetUniverseWorkspace } = require("./studio-universe-reset.cjs");

const db = new DatabaseSync(":memory:");
aiAnalysis.ensureSchema(db);
ingest.ensureSchema(db);
workspace.ensureSchema(db);
narrative.ensureSchema(db);

db.prepare(`
  INSERT INTO source_ai_analyses (
    provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
    cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
  ) VALUES ('youtube','video-a','test-model','Video A','Özet','[]','[]','[]','{}',?,'[]','[]','[]',?,'[]')
`).run(
  JSON.stringify([{ name: "Ömer", aliases: [], role: "Araştırmacı", details: ["Defteri inceler"], visual: {} }]),
  JSON.stringify(["Sponsor A"]),
);

const initial = aiAnalysis.editorialPackage(db, "video-a");
const character = initial.items.find((item) => item.category === "character");
assert.ok(character, "Test kaynağında Evrene işle seçilebilecek bir Muhatap bulunmalı");
const decisions = Object.fromEntries(initial.items.map((item) => [item.key, item.decision]));
decisions[character.key] = "include";
aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "curated",
  decisions,
  manualSponsors: ["Manuel Sponsor"],
  manualContributors: ["Katkı A"],
});

db.prepare(`
  INSERT INTO universe_ingest_sources (provider, external_id, fingerprint, last_run_id)
  VALUES ('youtube','video-a','processed',1)
`).run();

db.prepare(`
  INSERT INTO universe_workspace_nodes (
    key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
  ) VALUES ('node-a',1,'character','Ömer','Özet','[]','["video-a"]','{}','approved')
`).run();

db.prepare(`
  INSERT INTO universe_workspace_history (node_key, run_id, event, note, snapshot_json)
  VALUES ('node-a',1,'approved','test','{}')
`).run();

const narrativeRun = narrative.prepareRun(db, { model: "reset-fixture" });
narrative.saveDraftSections(db, narrativeRun.id, [{
  key: "chapter-reset",
  position: 0,
  title: "Reset öncesi anlatı",
  sourceKeys: ["node-a"],
  blocks: [{ type: "paragraph", spans: [
    { type: "text", text: "Kayıtta " },
    { type: "reference", entityId: "node-a", label: "Ömer" },
    { type: "text", text: " yer alır." },
  ] }],
}]);
narrative.applyRun(db, narrativeRun.id);
const visualBefore = visualCompletion.status(db);
assert.equal(visualBefore.sections.length, 1, "Reset öncesi anlatı sahne slotu bulunmalı");

assert.equal(aiAnalysis.editorialPackage(db, "video-a").universeLocked, true, "İşlenmiş kaynak sıfırlama öncesi kilitli olmalı");
assert.equal(ingest.status(db).eligible, 1, "Test kaynağı Evrene İşleme için uygun olmalı");
assert.equal(ingest.status(db).processed, 1);
assert.equal(narrative.narrativeMemory(db).length, 1, "Reset öncesi yaşayan anlatı bulunmalı");

const beforeAnalysis = aiAnalysis.getResult(db, "video-a");
const beforeEditorial = aiAnalysis.editorialPackage(db, "video-a");
const result = resetUniverseWorkspace(db);

assert.equal(result.after.reset.universe_ingest_sources, 0);
assert.equal(result.after.reset.universe_workspace_nodes, 0);
assert.equal(result.after.reset.universe_workspace_history, 0);
assert.equal(result.after.reset.narrative_runs, 0, "Evren rebuild narrative run geçmişini temizlemeli");
assert.equal(result.after.reset.narrative_section_revisions, 0, "Evren rebuild yaşayan anlatı revizyonlarını temizlemeli");
assert.equal(result.after.reset.narrative_visual_slots, 0, "Evren rebuild sahne kararlarını temizlemeli");
assert.equal(narrative.narrativeMemory(db).length, 0, "Eski anlatı Evren resetinden sonra görünmemeli");
assert.equal(visualCompletion.status(db).sections.length, 0, "Eski Görsel Tamamlama slotları Evren resetinden sonra görünmemeli");
assert.equal(aiAnalysis.getResult(db, "video-a").title, beforeAnalysis.title, "AI çözümlemesi korunmalı");
assert.equal(aiAnalysis.editorialPackage(db, "video-a").state, beforeEditorial.state, "Ayıklama kararı korunmalı");
assert.deepEqual(aiAnalysis.curatedResult(db, "video-a").sponsors.sort(), ["Manuel Sponsor", "Sponsor A"].sort());
assert.deepEqual(aiAnalysis.curatedResult(db, "video-a").contributors, ["Katkı A"]);
assert.equal(aiAnalysis.editorialPackage(db, "video-a").universeLocked, false, "Evren sıfırlanınca Ayıklama kilidi açılmalı");
assert.equal(ingest.status(db).processed, 0);
assert.equal(ingest.status(db).pending, 1, "Ayıklanmış kaynak yeniden Evrene İşleme için beklemeli");

db.close();
console.log("Universe rebuild reset preserves analysis and curation while clearing universe-dependent narrative and visual decisions");
