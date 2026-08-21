const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const aiConfig = require("./ai-config.cjs");
const aiAnalysis = require("./ai-analysis.cjs");
const catalog = require("./youtube-catalog.cjs");
const transcriptStore = require("./transcript-store.cjs");
const ingest = require("./universe-ingest.cjs");
const workspace = require("./universe-workspace.cjs");

const VIDEO_ID = "FIRST000001";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-first-run-"));

function ensureBaseSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS content_items (
      key TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('video', 'character', 'event', 'file')),
      title TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('published', 'draft')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE TABLE IF NOT EXISTS content_sources (
      content_key TEXT PRIMARY KEY REFERENCES content_items(key) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, external_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      pair_key TEXT NOT NULL UNIQUE,
      from_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
      to_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'bağlantılı',
      note TEXT,
      source TEXT NOT NULL CHECK (source IN ('base', 'local')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (from_key <> to_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS studio_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `);
}

function seedCatalog(db) {
  catalog.ensureSchema(db);
  db.prepare(`INSERT INTO youtube_channels (id, url, title, handle, video_count) VALUES (?, ?, ?, ?, 1)`)
    .run("first-channel", "https://www.youtube.com/@FirstRun", "İlk Kanal", "@FirstRun");
  db.prepare(`
    INSERT INTO youtube_videos (
      video_id, channel_id, title, published_at, duration_seconds,
      canonical_url, thumbnail_url, thumbnail_file, subtitle_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'manual')
  `).run(
    VIDEO_ID,
    "first-channel",
    "İlk Evren Videosu",
    "2026-08-14",
    900,
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
  );
}

function seedAnalysis(db) {
  aiAnalysis.ensureSchema(db);
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube', ?, 'first-run-model', ?, ?, ?, ?, ?, '{}', ?, ?, ?, '[]', '[]', '[]')
  `).run(
    VIDEO_ID,
    "İlk Evren Videosu",
    "İlk kullanım akışını doğrulayan sentetik çözümleme.",
    JSON.stringify(["ilk kullanım"]),
    JSON.stringify(["Anlatıcı arşivde ilk izi bulur."]),
    JSON.stringify(["İlk hikâye hattı"]),
    JSON.stringify([{ name: "Anlatıcı", aliases: [], role: "anlatıcı", details: ["İlk kaynakta görünür."], visual: {} }]),
    JSON.stringify([{ name: "İlk Mekân", details: ["İlk kaynağın geçtiği yer."], visual: {} }]),
    JSON.stringify([{ name: "İlk Nesne", details: ["İlk kaynakta geçen nesne."], visual: {} }]),
  );

  const pack = aiAnalysis.editorialPackage(db, VIDEO_ID);
  assert.equal(pack.state, "pending");
  const decisions = Object.fromEntries(pack.items.map((item) => [item.key, item.target === "support" ? "exclude" : "include"]));
  const curated = aiAnalysis.editorialSave(db, {
    videoId: VIDEO_ID,
    state: "curated",
    decisions,
    manualSponsors: [],
    manualContributors: [],
  });
  assert.equal(curated.state, "curated");
}

function seedWorkspace(db) {
  workspace.ensureSchema(db);
  const storyKey = "first-story";
  const characterKey = "first-character";
  const insertNode = db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'draft')
  `);
  insertNode.run(
    storyKey,
    "story",
    "İlk Hikâye",
    "İlk kaynak videodan oluşturulan hikâye kaydı.",
    JSON.stringify([VIDEO_ID]),
    JSON.stringify({ name: "İlk Hikâye", summary: "İlk kaynak videodan oluşturulan hikâye kaydı.", sourceVideoIds: [VIDEO_ID], sequence: [{ text: "İlk anlatı izi.", sourceVideoIds: [VIDEO_ID] }], characterNames: ["Anlatıcı"], visual: {} }),
  );
  insertNode.run(
    characterKey,
    "character",
    "Anlatıcı",
    "İlk kaynakta görünen muhatap.",
    JSON.stringify([VIDEO_ID]),
    JSON.stringify({ name: "Anlatıcı", summary: "İlk kaynakta görünen muhatap.", sourceVideoIds: [VIDEO_ID], storyNames: ["İlk Hikâye"], roles: ["anlatıcı"], visual: {} }),
  );
  db.prepare(`
    INSERT INTO universe_workspace_relations (
      key, run_id, from_key, to_key, label, source_video_ids_json, payload_json, state
    ) VALUES ('first-relation', 1, ?, ?, 'hikâyede yer alıyor', ?, '{}', 'draft')
  `).run(storyKey, characterKey, JSON.stringify([VIDEO_ID]));
  return { storyKey, characterKey };
}

try {
  const cleanConfig = aiConfig.getConfig(tempRoot);
  assert.equal(cleanConfig.configured, false, "Temiz kurulum AI hazırmış gibi görünmemeli");

  const ollama = aiConfig.saveConfig(tempRoot, { provider: "ollama", endpoint: "http://127.0.0.1:11434/v1", model: "qwen-test" });
  assert.equal(ollama.configured, true);
  const codex = aiConfig.saveConfig(tempRoot, { provider: "codex-cli", model: "" });
  assert.equal(codex.configured, true);

  const db = new DatabaseSync(":memory:");
  ensureBaseSchema(db);
  catalog.ensureSchema(db);
  transcriptStore.ensureSchema(db);
  aiAnalysis.ensureSchema(db);
  ingest.ensureSchema(db);
  workspace.ensureSchema(db);

  assert.deepEqual(catalog.catalogStats(db), { total: 0, imported: 0, transcripts: 0, pendingImport: 0 });
  assert.equal(ingest.status(db).pending, 0);
  assert.equal(workspace.status(db).counts.total, 0);

  seedCatalog(db);
  const imported = catalog.importCatalogVideo(db, { videoId: VIDEO_ID });
  assert.equal(imported.imported, true);
  assert.equal(imported.item.status, "draft");

  const transcript = transcriptStore.saveSourceTranscript(db, {
    videoId: VIDEO_ID,
    source: "youtube",
    language: "tr",
    text: "Bu ilk kullanım akışı için örnek bir altyazıdır.",
  });
  assert.ok(transcript.wordCount > 0);

  seedAnalysis(db);
  const pending = ingest.pendingSources(db);
  assert.equal(pending.length, 1, "Ayıklanmış ilk kaynak Evrene İşleme için hazır olmalı");
  ingest.prepareRun(db, 1, pending);
  assert.deepEqual(ingest.markApplied(db, 1), { tracked: true, processed: 1 });
  assert.equal(aiAnalysis.editorialPackage(db, VIDEO_ID).universeLocked, true);

  const keys = seedWorkspace(db);
  let state = workspace.status(db);
  assert.equal(state.counts.draft, 2);
  assert.equal(state.counts.approved, 0);

  workspace.setNodeState(db, { keys: [keys.storyKey, keys.characterKey], state: "approved" });
  state = workspace.status(db);
  assert.equal(state.counts.approved, 2);
  assert.equal(state.counts.approvedRelations, 1);
  assert.equal(state.counts.draft, 0);

  db.close();
  console.log("Fresh Studio flow reaches approved Universe from catalog → transcript → analysis → curation → ingest → approval without legacy Web publication calls");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
