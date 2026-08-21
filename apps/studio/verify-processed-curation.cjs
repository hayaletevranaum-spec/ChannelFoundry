const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const ingest = require("./universe-ingest.cjs");

const db = new DatabaseSync(":memory:");
aiAnalysis.ensureSchema(db);
ingest.ensureSchema(db);

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
const initialDecisions = Object.fromEntries(initial.items.map((item) => [item.key, item.decision]));
aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "curated",
  decisions: initialDecisions,
  manualSponsors: [],
  manualContributors: [],
});

db.prepare(`
  INSERT INTO universe_ingest_sources (provider, external_id, fingerprint, last_run_id)
  VALUES ('youtube','video-a','processed',1)
`).run();

const locked = aiAnalysis.editorialPackage(db, "video-a");
assert.equal(locked.universeLocked, true, "Evrene işlenmiş video Ayıklama katmanında kilitli görünmeli");
const lockedDecisions = Object.fromEntries(locked.items.map((item) => [item.key, item.decision]));

assert.throws(() => aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "excluded",
  decisions: lockedDecisions,
  manualSponsors: [],
  manualContributors: [],
}), /Evrene daha önce işlendiği için/);

const character = locked.items.find((item) => item.category === "character");
assert.ok(character, "Test videosunda Muhatap malzemesi bulunmalı");
const changedCharacterDecision = character.decision === "include" ? "context" : "include";
assert.throws(() => aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "curated",
  decisions: { ...lockedDecisions, [character.key]: changedCharacterDecision },
  manualSponsors: [],
  manualContributors: [],
}), /Evren malzemesi Ayıklama ekranından değiştirilemez/);

const supportSaved = aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "curated",
  decisions: lockedDecisions,
  manualSponsors: ["Manuel Sponsor"],
  manualContributors: ["Katkı A"],
});
assert.equal(supportSaved.universeLocked, true);
assert.deepEqual(aiAnalysis.curatedResult(db, "video-a").sponsors.sort(), ["Manuel Sponsor", "Sponsor A"].sort());
assert.deepEqual(aiAnalysis.curatedResult(db, "video-a").contributors, ["Katkı A"]);

assert.throws(() => aiAnalysis.enqueue(db, { videoIds: ["video-a"], force: true }), /Evrene daha önce işlendiği için/);
assert.throws(() => aiAnalysis.complete(db, "video-a", "test-model", {
  title: "Değişmiş çözümleme",
  summary: "Bu sonuç yazılmamalı",
  topics: [], storyBeats: [], storyHints: [], coverVisual: {}, characters: [], locations: [], objects: [], scenes: [], sponsors: [], contributors: [],
}), /çözümleme sonucu artık değiştirilemez/);
assert.equal(aiAnalysis.getResult(db, "video-a").title, "Video A", "Kilitli kaynak çözümleme katmanında değişmemeli");

db.close();
console.log("Processed universe sources keep analysis and curation fixed while support records remain editable");
