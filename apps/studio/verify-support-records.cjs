const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const editorial = require("./ai-analysis-editorial.cjs");
const support = require("./ai-support-records.cjs");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE source_ai_analyses (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    topics_json TEXT NOT NULL DEFAULT '[]',
    story_beats_json TEXT NOT NULL DEFAULT '[]',
    story_hints_json TEXT NOT NULL DEFAULT '[]',
    cover_visual_json TEXT NOT NULL DEFAULT '{}',
    characters_json TEXT NOT NULL DEFAULT '[]',
    locations_json TEXT NOT NULL DEFAULT '[]',
    objects_json TEXT NOT NULL DEFAULT '[]',
    scenes_json TEXT NOT NULL DEFAULT '[]',
    sponsors_json TEXT NOT NULL DEFAULT '[]',
    contributors_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, external_id)
  ) STRICT;
  CREATE TABLE youtube_videos (
    video_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT ''
  ) STRICT;
`);

editorial.ensureSchema(db);
db.prepare(`
  INSERT INTO source_ai_analyses (
    provider, external_id, title, sponsors_json, contributors_json
  ) VALUES ('youtube', 'video-57', 'Düğümlü Kitabın 57. Daveti', ?, ?)
`).run(JSON.stringify(["Taha"]), JSON.stringify(["Ayşe"]));
db.prepare(`
  INSERT INTO youtube_videos (video_id, title, published_at, canonical_url)
  VALUES ('video-57', 'Düğümlü Kitabın 57. Daveti', '2026-05-09', 'https://www.youtube.com/watch?v=video-57')
`).run();

editorial.saveReview(db, {
  videoId: "video-57",
  state: "curated",
  decisions: {},
  nameOverrides: {},
  manualSponsors: ["Veysel Haktan"],
  manualContributors: [],
});

let records = support.supportRecords(db);
assert.equal(records.length, 3);
assert.equal(records.find((record) => record.name === "Taha")?.source, "analysis");
assert.equal(records.find((record) => record.name === "Veysel Haktan")?.source, "manual");
assert.equal(records.find((record) => record.name === "Ayşe")?.kind, "contributor");

const sources = support.supportSources(db);
assert.equal(sources.length, 1);
assert.equal(sources[0].title, "Düğümlü Kitabın 57. Daveti");

support.saveSupportRecord(db, {
  videoId: "video-57",
  kind: "sponsor",
  originalName: "Taha",
  name: "Taha Düzeltilmiş",
});
records = support.supportRecords(db);
assert.equal(records.some((record) => record.name === "Taha"), false);
assert.equal(records.some((record) => record.name === "Taha Düzeltilmiş" && record.kind === "sponsor"), true);

support.saveSupportRecord(db, {
  videoId: "video-57",
  kind: "sponsor",
  originalName: "Taha Düzeltilmiş",
  name: "Taha Düzeltilmiş",
  targetKind: "contributor",
});
records = support.supportRecords(db);
assert.equal(records.some((record) => record.name === "Taha Düzeltilmiş" && record.kind === "sponsor"), false);
assert.equal(records.some((record) => record.name === "Taha Düzeltilmiş" && record.kind === "contributor"), true);

support.saveSupportRecord(db, {
  videoId: "video-57",
  kind: "sponsor",
  name: "Yeni Sponsor",
});
records = support.supportRecords(db);
assert.equal(records.some((record) => record.name === "Yeni Sponsor" && record.kind === "sponsor"), true);

support.saveSupportRecord(db, {
  videoId: "video-57",
  kind: "sponsor",
  originalName: "Yeni Sponsor",
  delete: true,
});
records = support.supportRecords(db);
assert.equal(records.some((record) => record.name === "Yeni Sponsor"), false);

console.log("sponsor and contributor records remain editable after curation");
