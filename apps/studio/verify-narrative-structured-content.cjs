const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrative = require("./narrative-store.cjs");

function insertNode(db, { key, kind, name, summary, sourceVideoIds }) {
  db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'approved')
  `).run(key, kind, name, summary, JSON.stringify(sourceVideoIds), JSON.stringify({ name, summary }));
}

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);
narrative.ensureSchema(db);

insertNode(db, {
  key: "story-diary",
  kind: "story",
  name: "Araştırma Günlüğü",
  summary: "Günlük anlatısının onaylı hikâye kaydı.",
  sourceVideoIds: ["video-010"],
});
insertNode(db, {
  key: "object-stone",
  kind: "object",
  name: "Babil Taşı",
  summary: "Metin içinde açık referansla kullanılacak obje.",
  sourceVideoIds: ["video-010", "video-011"],
});

const run = narrative.prepareRun(db, { model: "structured-fixture" });
assert.throws(() => narrative.saveDraftSections(db, run.id, [{
  key: "chapter-invalid",
  title: "Geçersiz",
  sourceKeys: ["story-diary"],
  blocks: [{ type: "paragraph", spans: [
    { type: "text", text: "Taş: " },
    { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
  ] }],
}]), /sourceKeys/i, "Inline entity referansı aynı bölümün provenance sourceKeys listesinde yer almalı");

assert.throws(() => narrative.saveDraftSections(db, run.id, [{
  key: "chapter-invented",
  title: "Uydurma",
  sourceKeys: ["story-diary"],
  blocks: [{ type: "paragraph", spans: [
    { type: "reference", entityId: "object-invented", label: "Uydurma Nesne" },
  ] }],
}]), /onaylı bir Evren entity/i, "AI onaylı Evren dışında entity referansı üretememeli");

narrative.saveDraftSections(db, run.id, [{
  key: "chapter-diary",
  position: 12,
  title: "Taşın Yeniden Ortaya Çıkışı",
  sourceKeys: ["story-diary", "object-stone"],
  blocks: [
    {
      type: "paragraph",
      spans: [
        { type: "text", text: "Araştırma sırasında " },
        { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
        { type: "text", text: " yeniden karşıma çıktı." },
      ],
    },
    {
      type: "figure",
      assetId: "asset-stone-001",
      role: "artifact",
      entityId: "object-stone",
      alt: "İşaretli taşın arşiv görseli",
      caption: "İncelenen taşın kayıt görseli.",
    },
  ],
}]);

const draft = narrative.listSectionRevisions(db, "chapter-diary")[0];
assert.equal(draft.state, "draft");
assert.equal(draft.position, 12, "Position semantik anlatı sırası olmalı, fiziksel sayfa numarası değil");
assert.equal(draft.body, "Araştırma sırasında Babil Taşı yeniden karşıma çıktı.\n\nİncelenen taşın kayıt görseli.");
assert.equal(draft.blocks[0].spans[1].type, "reference");
assert.equal(draft.blocks[0].spans[1].entityId, "object-stone");
assert.deepEqual(draft.entityReferences, [{ entityId: "object-stone", kind: "object", label: "Babil Taşı" }]);
assert.deepEqual(draft.sourceVideoIds, ["video-010", "video-011"]);
assert.deepEqual(draft.media, [{
  assetId: "asset-stone-001",
  role: "artifact",
  entityId: "object-stone",
  alt: "İşaretli taşın arşiv görseli",
  caption: "İncelenen taşın kayıt görseli.",
}]);

const applied = narrative.applyRun(db, run.id);
assert.equal(applied.memory[0].sectionKey, "chapter-diary");
assert.equal(applied.memory[0].blocks[0].spans[1].entityId, "object-stone");
assert.equal(applied.memory[0].entityReferences[0].kind, "object");
assert.deepEqual(applied.memory[0].sourceVideoIds, ["video-010", "video-011"]);

const legacyDb = new DatabaseSync(":memory:");
legacyDb.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(legacyDb);
legacyDb.exec(`
  CREATE TABLE narrative_section_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_key TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    revision_no INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    source_keys_json TEXT NOT NULL DEFAULT '[]',
    retire INTEGER NOT NULL CHECK (retire IN (0,1)) DEFAULT 0,
    state TEXT NOT NULL CHECK (state IN ('draft','approved','published','superseded','discarded')) DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    published_at TEXT,
    UNIQUE (section_key, run_id),
    UNIQUE (section_key, revision_no)
  ) STRICT;
`);
narrative.ensureSchema(legacyDb);
const migratedColumns = new Set(legacyDb.prepare("PRAGMA table_info(narrative_section_revisions)").all().map((row) => String(row.name)));
for (const column of ["blocks_json", "entity_references_json", "source_video_ids_json", "media_json"]) {
  assert.equal(migratedColumns.has(column), true, `Eski narrative veritabanı ${column} kolonuna migrate edilmeli`);
}

console.log("Narrative structured content keeps stable sections, explicit approved-entity references, provenance video ids, semantic media and legacy schema migration ready");
