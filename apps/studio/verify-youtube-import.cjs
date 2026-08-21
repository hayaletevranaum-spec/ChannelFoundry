const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { parseYoutubeVideoId, saveYoutubeImport } = require("./youtube-import.cjs");

const id = "M7lc1UVf-VE";
assert.equal(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${id}`), id);
assert.equal(parseYoutubeVideoId(`https://youtu.be/${id}?t=10`), id);
assert.equal(parseYoutubeVideoId(`https://www.youtube.com/shorts/${id}`), id);
assert.equal(parseYoutubeVideoId(`https://youtube.com/live/${id}`), id);
let rejected = false;
try { parseYoutubeVideoId("https://example.com/not-youtube"); } catch { rejected = true; }
assert.equal(rejected, true);

const db = new DatabaseSync(":memory:");
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE content_items (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE content_sources (
  content_key TEXT PRIMARY KEY REFERENCES content_items(key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_id)
) STRICT;
`);

const preview = {
  provider: "youtube",
  videoId: id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: "YouTube Test Kaydı",
  channel: "Test Kanalı",
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
};

let result = saveYoutubeImport(db, preview);
assert.equal(result.imported, true);
assert.equal(result.item.status, "draft");
assert.equal(result.item.kind, "video");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_sources").get().count, 1);
assert.equal(db.prepare("SELECT author_name FROM content_sources WHERE external_id = ?").get(id).author_name, "Test Kanalı");

result = saveYoutubeImport(db, preview);
assert.equal(result.imported, false);
assert.equal(result.reason, "already_exists");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 1);

console.log("YouTube URL parsing and SQLite import: OK");
