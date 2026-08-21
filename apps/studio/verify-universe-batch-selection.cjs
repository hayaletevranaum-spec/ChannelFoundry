const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const youtubeCatalog = require("./youtube-catalog.cjs");
const store = require("./universe-merge-store.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
youtubeCatalog.ensureSchema(db);
aiAnalysis.ensureSchema(db);
store.ensureSchema(db);

db.prepare(`INSERT INTO youtube_channels (id, url, title, handle, video_count) VALUES ('batch-channel', 'https://www.youtube.com/@batch', 'Batch Kanalı', '@batch', 12)`).run();

const id = (index) => `BATCH${String(index).padStart(6, "0")}`;
const date = (index) => `2020-01-${String(index).padStart(2, "0")}`;
const insertionOrder = [7, 2, 12, 1, 9, 5, 3, 11, 4, 10, 8, 6];

for (const index of insertionOrder) {
  const videoId = id(index);
  db.prepare(`
    INSERT INTO youtube_videos (
      video_id, channel_id, title, published_at, duration_seconds, canonical_url,
      thumbnail_url, thumbnail_file, availability, live_status
    ) VALUES (?, 'batch-channel', ?, ?, 600, ?, '', '', '', '')
  `).run(videoId, `Video ${index}`, date(index), `https://www.youtube.com/watch?v=${videoId}`);
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube', ?, 'batch-test', ?, '', '[]', '[]', '[]', '{}', ?, '[]', '[]', '[]', '[]', '[]')
  `).run(videoId, `Video ${index}`, JSON.stringify([{ name: `Muhatap ${index}`, aliases: [], role: "", details: [], visual: {} }]));
  const pack = aiAnalysis.editorialPackage(db, videoId);
  const decisions = Object.fromEntries(pack.items.map((item) => [item.key, item.decision]));
  const character = pack.items.find((item) => item.category === "character");
  assert.ok(character);
  decisions[character.key] = "include";
  aiAnalysis.editorialSave(db, { videoId, state: "curated", decisions, manualSponsors: [], manualContributors: [] });
}

const preview = store.pendingSourcePreview(db);
assert.equal(store.MAX_INGEST_SELECTION, 10);
assert.equal(preview.length, 10);
assert.deepEqual(preview.map((entry) => entry.videoId), Array.from({ length: 10 }, (_, index) => id(index + 1)), "Çalışma penceresi en eski 10 videoyu kronolojik göstermeli");
assert.equal(preview[0].title, "Video 1");
assert.equal(preview[9].publishedAt, date(10));

const status = store.status(db);
assert.equal(status.ingest.batchLimit, 10);
assert.deepEqual(status.ingest.nextSources.map((entry) => entry.videoId), preview.map((entry) => entry.videoId));
assert.equal(status.ingest.pending, 12);

const defaultSelection = store.selectPendingEntries(db, {});
assert.deepEqual(defaultSelection.map((entry) => entry.mergeSource.videoId), preview.map((entry) => entry.videoId), "Eski çağrılar da tüm backlog yerine yalnız ilk 10 kaynağı işlemeli");

const selected = store.selectPendingEntries(db, { videoIds: [id(7), id(1), id(4)] });
assert.deepEqual(selected.map((entry) => entry.mergeSource.videoId), [id(1), id(4), id(7)], "Kullanıcı seçimi backend'de kronolojik sıraya dönmeli");
assert.throws(() => store.selectPendingEntries(db, { videoIds: [] }), /en az bir kaynak/);
assert.throws(() => store.selectPendingEntries(db, { videoIds: Array.from({ length: 11 }, (_, index) => id(index + 1)) }), /en fazla 10 kaynak/);
assert.throws(() => store.selectPendingEntries(db, { videoIds: [id(11)] }), /sıradaki en eski 10 kaynak/);

db.close();
console.log("Universe construction advances chronologically through user-selected batches of at most 10 oldest curated videos");
