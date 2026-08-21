const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const analysisSchema = require("./ai-analysis-schema.cjs");
const editorial = require("./ai-analysis-editorial.cjs");
const ingest = require("./universe-ingest.cjs");
const ingestAi = require("./universe-ingest-ai.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
analysisSchema.ensureSchema(db);
editorial.ensureSchema(db);
ingest.ensureSchema(db);
db.exec(`CREATE TABLE universe_merge_runs (id INTEGER PRIMARY KEY, state TEXT NOT NULL);`);

function insertAnalysis(videoId, value = {}) {
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube', ?, 'test-model', ?, ?, '[]', ?, ?, '{}', ?, ?, ?, ?, ?, ?)
  `).run(
    videoId,
    value.title || videoId,
    value.summary || "",
    JSON.stringify(value.storyBeats || []),
    JSON.stringify(value.storyHints || []),
    JSON.stringify(value.characters || []),
    JSON.stringify(value.locations || []),
    JSON.stringify(value.objects || []),
    JSON.stringify(value.scenes || []),
    JSON.stringify(value.sponsors || []),
    JSON.stringify(value.contributors || []),
  );
}

function curate(videoId, decisionsByCategory = {}, extra = {}) {
  const pack = editorial.editorialPackage(db, videoId);
  const decisions = {};
  for (const item of pack.items) if (decisionsByCategory[item.category]) decisions[item.key] = decisionsByCategory[item.category];
  return editorial.saveReview(db, { videoId, state: "curated", decisions, manualSponsors: extra.manualSponsors || [], manualContributors: extra.manualContributors || [] });
}

insertAnalysis("video-a", {
  summary: "Ömer ana hikâyede görünür.",
  storyHints: ["Ana hikâye"],
  characters: [{ name: "Ömer", aliases: [], role: "Araştırmacı", details: ["Defteri inceler"], visual: {} }],
  sponsors: ["Sponsor A"],
});
insertAnalysis("video-b", { sponsors: ["Sadece Sponsor"] });
insertAnalysis("video-c", { locations: [{ name: "Orman", details: ["Gece"], visual: {} }] });

curate("video-a", { storyHint: "context", character: "include", sponsor: "confirm" });
curate("video-b", { sponsor: "confirm" });
curate("video-c", { location: "include" });

const curatedA = editorial.curatedResult(db, "video-a");
assert.deepEqual(curatedA.storyHints, []);
assert.deepEqual(curatedA.context.storyHints, ["Ana hikâye"]);
assert.equal(curatedA.characters.length, 1);
assert.equal(ingestAi._test.hasStoryMaterial(curatedA), false);
const preparedA = ingestAi._test.prepareInput({ videos:[curatedA] });
assert.match(preparedA.videos[0].storyHints[0], /GEÇİCİ_KAPSAM/);
const pruned = ingestAi._test.pruneStories({ stories:[{ name:"Geçici",sourceVideoIds:["video-a"],sequence:[] }],characters:[],events:[],locations:[],objects:[],relations:[] }, { videos:[curatedA] });
assert.equal(pruned.stories.length, 0, "Bağlamda kalan hikâye izi bağımsız Web/Evren hikâyesine dönüşmemeli");

let pending = ingest.pendingSources(db);
assert.deepEqual(pending.map((entry) => entry.source.videoId).sort(), ["video-a", "video-c"]);
assert.equal(ingest.status(db).pending, 2);
assert.equal(ingest.status(db).eligible, 2, "Yalnız destek kaydı olan video Evren kuyruğuna girmemeli");
assert.equal(ingest.status(db).changedSources, 0);

const firstFingerprints = new Map(pending.map((entry) => [entry.source.videoId, entry.fingerprint]));
ingest.prepareRun(db, 7, pending);
db.prepare("INSERT INTO universe_merge_runs (id,state) VALUES (7,'done')").run();
assert.equal(ingest.unappliedRun(db), 7);
assert.deepEqual(ingest.freshness(db, 7), { tracked: true, fresh: true, changed: [] });
assert.deepEqual(ingest.markApplied(db, 7), { tracked: true, processed: 2 });
assert.equal(ingest.status(db).pending, 0);
assert.equal(ingest.status(db).processed, 2);

curate("video-a", { storyHint: "context", character: "include", sponsor: "confirm" }, { manualSponsors: ["Manuel Sponsor"] });
assert.equal(ingest.pendingSources(db).length, 0, "Sadece sponsor değişikliği Evren kaynağını yeniden işlememeli");
assert.equal(ingest.fingerprint(editorial.curatedResult(db, "video-a")), firstFingerprints.get("video-a"));

curate("video-a", { storyHint: "include", character: "include", sponsor: "confirm" }, { manualSponsors: ["Manuel Sponsor"] });
assert.notEqual(ingest.fingerprint(editorial.curatedResult(db, "video-a")), firstFingerprints.get("video-a"), "Düşük seviye editoryal değişiklik fingerprinti değiştirebilir");
assert.equal(ingest.pendingSources(db).length, 0, "Evrene uygulanmış kaynak fingerprint değişse bile normal incremental kuyruğa geri dönmemeli");
assert.equal(ingest.status(db).changedSources, 0, "İşlenmiş kaynaklar değişmiş kaynak olarak yeniden sıraya alınmamalı");

insertAnalysis("video-d", { locations: [{ name: "Mağara", details: ["Gece"], visual: {} }] });
curate("video-d", { location: "include" });
pending = ingest.pendingSources(db);
assert.deepEqual(pending.map((entry) => entry.source.videoId), ["video-d"]);
ingest.prepareRun(db, 8, pending);
db.prepare("INSERT INTO universe_merge_runs (id,state) VALUES (8,'done')").run();
curate("video-d", { location: "context" });
assert.equal(ingest.freshness(db, 8).fresh, false, "Henüz uygulanmamış çalışma hazırlanırken ayıklama değişirse sonuç eski sayılmalı");
assert.throws(() => ingest.assertRunFresh(db, 8), /yeniden ayıklandı|evren dışı/);
assert.equal(ingest.unappliedRun(db), null, "Eski kalan tamamlanmış çalışma yeni Evrene İşleme turunu kilitlememeli");
assert.equal(db.prepare("SELECT state FROM universe_ingest_runs WHERE run_id=8").get().state, "stale");

db.close();
console.log("Incremental universe ingest keeps processed sources immutable, isolates support data, preserves context and rejects stale prepared runs");
