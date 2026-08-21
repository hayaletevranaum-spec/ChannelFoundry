const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const analysis = require("./ai-analysis.cjs");

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
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE content_sources (
    content_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE TABLE youtube_videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER,
    canonical_url TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    thumbnail_file TEXT NOT NULL DEFAULT '',
    availability TEXT NOT NULL DEFAULT '',
    live_status TEXT NOT NULL DEFAULT '',
    discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE source_transcripts (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, external_id)
  ) STRICT;

  INSERT INTO youtube_videos (
    video_id, channel_id, title, published_at, duration_seconds,
    canonical_url, thumbnail_url
  ) VALUES
    ('HGzLMopTOcE', 'channel-test', 'Örnek Video', '2026-08-10', 3600,
     'https://www.youtube.com/watch?v=HGzLMopTOcE', 'https://i.ytimg.com/vi/HGzLMopTOcE/hqdefault.jpg'),
    ('unselected-video', 'channel-test', 'Seçilmemiş Video', '2026-08-09', 1200,
     'https://www.youtube.com/watch?v=unselected-video', 'https://i.ytimg.com/vi/unselected-video/hqdefault.jpg');

  INSERT INTO source_transcripts (provider, external_id, source, language, text) VALUES
    ('youtube', 'HGzLMopTOcE', 'youtube', 'tr', 'Bu yerel bir örnek transkripttir.'),
    ('youtube', 'unselected-video', 'youtube', 'tr', 'Bu kayıt kaynak havuzunda kalır.');

  INSERT INTO content_items (key, id, kind, title, meta, summary, status)
  VALUES ('youtube:HGzLMopTOcE', 'HGzLMopTOcE', 'video', 'Örnek Video', '', '', 'draft');
  INSERT INTO content_sources (content_key, provider, external_id, canonical_url, author_name, thumbnail_url)
  VALUES ('youtube:HGzLMopTOcE', 'youtube', 'HGzLMopTOcE', 'https://www.youtube.com/watch?v=HGzLMopTOcE', 'Test', 'https://i.ytimg.com/vi/HGzLMopTOcE/hqdefault.jpg');
`);

analysis.ensureSchema(db);
assert.deepEqual(analysis.stats(db), { transcripts: 2, analyzed: 0, waiting: 0, running: 0, errors: 0 }, "Arşivlenmiş bütün kaynak transkriptleri üretim sayacına girmeli");
assert.equal(analysis.list(db).length, 2, "Arşivlenmiş kaynak videolar editoryal kayıt olmadan AI listesine girmeli");
const sourceOnly = analysis.sourceContext(db, "unselected-video");
assert.equal(sourceOnly.contentKey, null);
assert.match(sourceOnly.transcript, /kaynak havuzunda/);

const queued = analysis.enqueue(db, { videoIds: ["HGzLMopTOcE"] });
assert.equal(queued.accepted, 1);
assert.equal(analysis.stats(db).waiting, 1);

const job = analysis.claimNext(db);
assert.equal(job.videoId, "HGzLMopTOcE");
assert.equal(analysis.stats(db).running, 1);
const source = analysis.sourceContext(db, job.videoId);
assert.equal(source.language, "tr");
assert.equal(source.contentKey, "youtube:HGzLMopTOcE");
assert.match(source.transcript, /örnek transkripttir/);

const visual = {
  description: "Uzun boylu karanlık bir figür",
  attributes: ["Varlık türü: cin", "Boy: uzun"],
  atmosphere: "loş ve mistik",
  prompt: "Loş ortamda uzun boylu karanlık bir figür",
  negativePrompt: "yazı, filigran",
};
const completed = analysis.complete(db, job.videoId, "qwen2.5:7b", {
  title: "Sade başlık",
  summary: "Hikâye özeti",
  topics: ["Tema"],
  storyBeats: ["İlk olay anlatılır", "Karakter ikinci aşamada geri döner"],
  storyHints: ["Örnek hikâye hattı"],
  coverVisual: visual,
  characters: [{ name: "Örnek Karakter", aliases: ["Karakter A"], role: "Tanık", details: ["Önceki olayda da yer almıştır"], visual }],
  locations: [{ name: "Örnek mekân", details: ["Karanlık bir yapı"], visual }],
  objects: [{ name: "Örnek nesne", details: ["Taş biçiminde"], visual }],
  scenes: [{ name: "İlk karşılaşma", description: "Figür görünür", visual }],
});
assert.equal(completed.model, "qwen2.5:7b");
assert.equal(completed.characters[0].name, "Örnek Karakter");
assert.equal(completed.characters[0].visual.attributes[0], "Varlık türü: cin");
assert.equal(completed.storyHints[0], "Örnek hikâye hattı");
assert.equal(completed.storyBeats.length, 2);
assert.equal(completed.locations[0].name, "Örnek mekân");
assert.equal(completed.objects[0].visual.prompt, visual.prompt);
assert.equal(completed.scenes[0].name, "İlk karşılaşma");
assert.equal(completed.coverVisual.negativePrompt, "yazı, filigran");
const updatedItem = db.prepare("SELECT title, summary FROM content_items WHERE key = 'youtube:HGzLMopTOcE'").get();
assert.equal(updatedItem.title, "Sade başlık", "AI başlığı bağlı Kayıt Dosyasına otomatik uygulanmalı");
assert.equal(updatedItem.summary, "Hikâye özeti", "AI özeti bağlı Kayıt Dosyasına otomatik uygulanmalı");
assert.deepEqual(analysis.stats(db), { transcripts: 2, analyzed: 1, waiting: 0, running: 0, errors: 0 });

const listed = analysis.list(db);
assert.equal(listed.length, 2);
const analyzedVideo = listed.find((video) => video.videoId === "HGzLMopTOcE");
assert.equal(analyzedVideo.hasAnalysis, true);
assert.equal(analyzedVideo.jobState, "done");

analysis.enqueue(db, { videoIds: ["HGzLMopTOcE"], force: true });
assert.equal(analysis.stats(db).waiting, 1);
const retry = analysis.claimNext(db);
analysis.fail(db, retry.videoId, new Error("test failure"));
assert.equal(analysis.stats(db).errors, 1);
assert.match(analysis.list(db)[0].jobError, /test failure/);

analysis.enqueue(db, { videoIds: ["HGzLMopTOcE"], force: true });
analysis.claimNext(db);
assert.equal(analysis.resetInterrupted(db), 1);
assert.equal(analysis.stats(db).waiting, 1);
assert.equal(analysis.cancelPending(db).canceled, 1);
assert.equal(analysis.stats(db).waiting, 0);
assert.equal(analysis.list(db).find((video) => video.videoId === "HGzLMopTOcE").jobState, "");

console.log("source-transcript narrative AI analysis, automatic record update, and visual prompts ready");
