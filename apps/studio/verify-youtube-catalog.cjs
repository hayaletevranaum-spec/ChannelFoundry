const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const catalog = require("./youtube-catalog.cjs");

assert.equal(
  catalog.normalizeChannelUrl("https://www.youtube.com/@example-channel"),
  "https://www.youtube.com/@example-channel",
);
assert.equal(
  catalog.normalizeChannelUrl("youtube.com/channel/UC123/videos?view=0"),
  "https://www.youtube.com/channel/UC123",
);
assert.throws(() => catalog.normalizeChannelUrl("https://example.com/channel/test"));
assert.equal(
  catalog.uploadsPlaylistUrl("UCabcdefghijklmnopqrstuv"),
  "https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv",
);
assert.equal(catalog.uploadsPlaylistUrl("channel-fallback"), "");
assert.equal(catalog.flattenEntries([{ id: "HGzLMopTOcE" }, { entries: [{ id: "abcdefghijk" }] }]).length, 2);

const source = require("./youtube-catalog-source.cjs");
const store = require("./youtube-catalog-store.cjs");
const thumbnailCache = require("./youtube-thumbnail-cache.cjs");
assert.deepEqual(
  source.catalogTargets("https://www.youtube.com/@example-channel", "UCabcdefghijklmnopqrstuv", {}),
  ["https://www.youtube.com/@example-channel/videos"],
);
assert.deepEqual(
  source.catalogTargets("https://www.youtube.com/@example-channel", "UCabcdefghijklmnopqrstuv", { excludeShorts: false }),
  ["https://www.youtube.com/@example-channel/videos", "https://www.youtube.com/@example-channel/shorts"],
);
assert.deepEqual(
  source.catalogTargets("https://www.youtube.com/@example-channel", "UCabcdefghijklmnopqrstuv", { excludeLive: false }),
  ["https://www.youtube.com/@example-channel/videos", "https://www.youtube.com/@example-channel/streams"],
);
assert.deepEqual(
  source.catalogTargets("https://www.youtube.com/@example-channel", "UCabcdefghijklmnopqrstuv", { excludeShorts: false, excludeLive: false }),
  ["https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv"],
);
assert.equal(source.shouldIncludeEntry({ live_status: "not_live" }, {}), true);
assert.equal(source.shouldIncludeEntry({ live_status: "was_live" }, {}), false);
assert.equal(source.shouldIncludeEntry({ live_status: "is_live" }, { excludeLive: false }), true);
assert.equal(source.shouldIncludeEntry({ availability: "subscriber_only", live_status: "not_live" }, {}), false);
assert.equal(source.shouldIncludeEntry({ availability: "subscriber_only", live_status: "not_live" }, { excludeMembersOnly: false }), true);
assert.equal(source.shouldIncludeEntry({ availability: "premium_only", live_status: "not_live" }, {}), true);
const detailOptions = { metadataLanguage: "tr", thumbnailSize: "standard", subtitleLanguages: ["tr", "en"] };
const detailTemplate = source.detailOutputTemplate(detailOptions);
assert.match(detailTemplate, /subtitles\.tr/);
assert.match(detailTemplate, /automatic_captions\.en/);
const detailRows = source.parseDetailOutput([
  ["HGzLMopTOcE", JSON.stringify("Örnek | Video"), "20260810", "1786386606", "1786386606", "3720", "public", "not_live", "1", "60", "1", "1", "0", "1"].join("\t"),
].join("\n"), detailOptions);
assert.equal(detailRows.length, 1);
assert.equal(detailRows[0].title, "Örnek | Video");
assert.equal(detailRows[0].subtitle_status, "manual");
assert.equal(detailRows[0].playlist_count, 60);
assert.deepEqual(detailRows[0].subtitle_languages, ["tr"]);
assert.deepEqual(detailRows[0].automatic_caption_languages, ["tr", "en"]);
const turkishArgs = source.catalogArgs("https://www.youtube.com/playlist?list=test", "recent", false, {
  metadataLanguage: "tr", thumbnailSize: "standard", subtitleLanguages: ["tr", "en"],
});
assert.equal(turkishArgs[turkishArgs.indexOf("youtube:lang=tr")], "youtube:lang=tr");
assert.ok(!source.catalogArgs("https://www.youtube.com/playlist?list=test", "recent", false, {
  metadataLanguage: "original", thumbnailSize: "standard", subtitleLanguages: ["tr"],
}).some((value) => String(value).startsWith("youtube:lang=")));
assert.match(source.thumbnailUrls("HGzLMopTOcE", "small")[0], /mqdefault\.jpg$/);
assert.match(source.thumbnailUrls("HGzLMopTOcE", "large")[0], /maxresdefault\.jpg$/);
assert.notEqual(
  thumbnailCache.thumbnailCacheFile("/tmp/channel-foundry-test", { channelId: "channel-test", videoId: "HGzLMopTOcE", thumbnailSize: "small" }),
  thumbnailCache.thumbnailCacheFile("/tmp/channel-foundry-test", { channelId: "channel-test", videoId: "HGzLMopTOcE", thumbnailSize: "large" }),
);

const normalized = catalog.normalizeEntry({
  id: "HGzLMopTOcE",
  title: "Örnek Video",
  upload_date: "20260810",
  duration: 3720,
}, "channel-test");
assert.equal(normalized.publishedAt, "2026-08-10");
assert.equal(normalized.durationSeconds, 3720);
assert.match(normalized.thumbnailUrl, /hqdefault\.jpg$/);

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
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
catalog.ensureSchema(db);
db.prepare(`
  INSERT INTO youtube_channels (id, url, title, handle, video_count)
  VALUES (?, ?, ?, ?, ?)
`).run("channel-test", "https://www.youtube.com/@example-channel", "Channel Foundry", "@example-channel", 1);
db.prepare(`
  INSERT INTO youtube_videos (
    video_id, channel_id, title, published_at, duration_seconds,
    canonical_url, thumbnail_url, thumbnail_file
  ) VALUES (?, ?, ?, ?, ?, ?, ?, '')
`).run(
  "HGzLMopTOcE",
  "channel-test",
  "Örnek Video",
  "2026-08-10",
  3720,
  "https://www.youtube.com/watch?v=HGzLMopTOcE",
  "https://i.ytimg.com/vi/HGzLMopTOcE/hqdefault.jpg",
);

db.prepare("UPDATE youtube_videos SET published_at='2026-08-10', subtitle_status='manual' WHERE video_id='HGzLMopTOcE'").run();
assert.deepEqual(store.detailedVideoIds(db, "test-signature"), ["HGzLMopTOcE"]);
assert.equal(db.prepare("SELECT detail_signature value FROM youtube_videos WHERE video_id='HGzLMopTOcE'").get().value, "test-signature");
store.upsertCatalog(db, { channelId: "channel-test", title: "Channel Foundry", handle: "@example-channel" }, "https://www.youtube.com/@example-channel", [{
  ...normalized,
  subtitleStatus: "unknown",
  subtitleLanguages: [],
  automaticCaptionLanguages: [],
  detailSignature: "",
}], "recent");
assert.equal(db.prepare("SELECT subtitle_status value FROM youtube_videos WHERE video_id='HGzLMopTOcE'").get().value, "manual");
assert.equal(db.prepare("SELECT detail_signature value FROM youtube_videos WHERE video_id='HGzLMopTOcE'").get().value, "test-signature");

let videos = catalog.listVideos(db, {});
assert.equal(videos.length, 1);
assert.equal(videos[0].contentKey, null);
assert.equal(videos[0].hasTranscript, false);

const imported = catalog.importCatalogVideo(db, { videoId: "HGzLMopTOcE" });
assert.equal(imported.imported, true);
assert.equal(imported.item.status, "draft");
assert.equal(imported.item.meta, "2026-08-10");

const duplicate = catalog.importCatalogVideo(db, { videoId: "HGzLMopTOcE" });
assert.equal(duplicate.imported, false);
assert.equal(duplicate.reason, "already_exists");

db.prepare(`
  INSERT INTO youtube_videos (
    video_id, channel_id, title, published_at, duration_seconds,
    canonical_url, thumbnail_url, thumbnail_file, availability
  ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'subscriber_only')
`).run(
  "MEMBERSONLY",
  "channel-test",
  "Üyelere Özel Video",
  "2026-08-09",
  1800,
  "https://www.youtube.com/watch?v=MEMBERSONLY",
  "https://i.ytimg.com/vi/MEMBERSONLY/hqdefault.jpg",
);
const membersImport = catalog.importCatalogVideo(db, { videoId: "MEMBERSONLY" });
assert.equal(membersImport.imported, true);
const recentResult = store.upsertCatalog(db, { channelId: "channel-test", title: "Channel Foundry", handle: "@example-channel" }, "https://www.youtube.com/@example-channel", [normalized], "recent");
assert.equal(recentResult.removedCount, 0);
assert.ok(db.prepare("SELECT 1 FROM youtube_videos WHERE video_id='MEMBERSONLY'").get());
const fullResult = store.upsertCatalog(db, { channelId: "channel-test", title: "Channel Foundry", handle: "@example-channel" }, "https://www.youtube.com/@example-channel", [normalized], "full");
assert.equal(fullResult.removedCount, 1);
assert.equal(db.prepare("SELECT 1 FROM youtube_videos WHERE video_id='MEMBERSONLY'").get(), undefined);
assert.ok(db.prepare("SELECT 1 FROM content_sources WHERE provider='youtube' AND external_id='MEMBERSONLY'").get());
assert.ok(db.prepare("SELECT 1 FROM content_items WHERE key=?").get(membersImport.item.key));

videos = catalog.listVideos(db, {});
assert.equal(videos[0].contentKey, "video:youtube-HGzLMopTOcE");
assert.equal(videos[0].editorialStatus, "draft");
assert.deepEqual(catalog.catalogStats(db), { total: 1, imported: 1, transcripts: 0, pendingImport: 0 });

console.log("youtube catalog contracts ready");
