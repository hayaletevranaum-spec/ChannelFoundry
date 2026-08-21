const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const ingest = require("./universe-ingest.cjs");

const db = new DatabaseSync(":memory:");
aiAnalysis.ensureSchema(db);
ingest.ensureSchema(db);

function insert(videoId, characterName, sponsor = "") {
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube', ?, 'test-model', ?, '', '[]', '[]', '[]', '{}', ?, '[]', '[]', '[]', ?, '[]')
  `).run(
    videoId,
    videoId,
    JSON.stringify([{ name: characterName, aliases: [], role: "", details: [`${videoId} ayrıntısı`], visual: {} }]),
    JSON.stringify(sponsor ? [sponsor] : []),
  );

  const pack = aiAnalysis.editorialPackage(db, videoId);
  const decisions = Object.fromEntries(pack.items.map((item) => [item.key, item.decision]));
  const character = pack.items.find((item) => item.category === "character");
  assert.ok(character, `${videoId} için Muhatap adayı bulunmalı`);
  decisions[character.key] = "include";
  aiAnalysis.editorialSave(db, {
    videoId,
    state: "curated",
    decisions,
    manualSponsors: [],
    manualContributors: [],
  });
}

insert("video-a", "Ömer", "Sponsor A");
insert("video-b", "Ayşe");

let pending = ingest.pendingSources(db);
assert.deepEqual(pending.map((entry) => entry.source.videoId).sort(), ["video-a", "video-b"]);
ingest.prepareRun(db, 1, pending);
assert.deepEqual(ingest.markApplied(db, 1), { tracked: true, processed: 2 });
assert.equal(ingest.status(db).processed, 2);
assert.equal(ingest.status(db).pending, 0);
assert.equal(aiAnalysis.editorialPackage(db, "video-a").universeLocked, true);

const lockedPack = aiAnalysis.editorialPackage(db, "video-a");
aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "curated",
  decisions: Object.fromEntries(lockedPack.items.map((item) => [item.key, item.decision])),
  manualSponsors: ["Sponsor B"],
  manualContributors: [],
});
assert.equal(ingest.status(db).pending, 0, "Destek kaydı değişikliği eski Evren kaynağını yeniden kuyruğa sokmamalı");

insert("video-c", "Ömer");
insert("video-d", "Mehmet");
pending = ingest.pendingSources(db);
assert.deepEqual(pending.map((entry) => entry.source.videoId).sort(), ["video-c", "video-d"], "İkinci tur yalnız yeni kaynakları içermeli");
assert.ok(!pending.some((entry) => ["video-a", "video-b"].includes(entry.source.videoId)), "İlk batch ikinci batch'e tekrar girmemeli");

ingest.prepareRun(db, 2, pending);
assert.deepEqual(ingest.markApplied(db, 2), { tracked: true, processed: 2 });
assert.equal(ingest.status(db).processed, 4);
assert.equal(ingest.status(db).pending, 0);

assert.throws(() => aiAnalysis.editorialSave(db, {
  videoId: "video-a",
  state: "excluded",
  decisions: {},
  manualSponsors: [],
  manualContributors: [],
}), /Evrene daha önce işlendiği için/);

db.close();
console.log("Two batch universe ingest processes only explicitly promoted new sources and keeps prior sources locked");
