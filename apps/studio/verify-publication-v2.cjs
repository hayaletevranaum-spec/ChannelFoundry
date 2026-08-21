const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrative = require("./narrative-store.cjs");
const visualCompletion = require("./visual-completion-store.cjs");
const visualProfiles = require("./visual-profiles.cjs");
const aiAnalysis = require("./ai-analysis.cjs");
const youtubeCatalog = require("./youtube-catalog.cjs");
const publicationV2 = require("./publication-v2.cjs");

function insertNode(db, { key, kind, name, summary, sourceVideoIds, payload = {} }) {
  db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'approved')
  `).run(key, kind, name, summary, JSON.stringify(sourceVideoIds), JSON.stringify({ name, summary, ...payload }));
}

function assertNoPhysicalLayout(value, currentPath = "publication") {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoPhysicalLayout(entry, `${currentPath}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    assert.equal(["page", "pagenumber", "pageindex", "spread", "spreadnumber", "spreadindex"].includes(normalized), false, `${currentPath}.${key} fiziksel layout bilgisi taşımamalı`);
    assertNoPhysicalLayout(child, `${currentPath}.${key}`);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-publication-v2-"));
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);
narrative.ensureSchema(db);
visualCompletion.ensureSchema(db);
aiAnalysis.ensureSchema(db);
youtubeCatalog.ensureSchema(db);

try {
  db.prepare(`
    INSERT INTO youtube_channels (id, url, title)
    VALUES ('channel-001', 'https://www.youtube.com/@fixture', 'Fixture Kanalı')
  `).run();
  db.prepare(`
    INSERT INTO youtube_videos (
      video_id, channel_id, title, published_at, canonical_url, thumbnail_url
    ) VALUES (
      'video-001', 'channel-001', 'Destek Kaynak Videosu', '2026-08-14',
      'https://www.youtube.com/watch?v=video-001', 'https://i.ytimg.com/vi/video-001/hqdefault.jpg'
    )
  `).run();
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json,
      story_beats_json, story_hints_json, cover_visual_json,
      characters_json, locations_json, objects_json, scenes_json,
      sponsors_json, contributors_json
    ) VALUES (
      'youtube', 'video-001', 'fixture-model', 'Destek Kaynak Videosu', 'Fixture özeti',
      '[]', '[]', '[]', '{}', '[]', '[]', '[]', '[]', ?, ?
    )
  `).run(JSON.stringify(["Defter Sponsoru"]), JSON.stringify(["Araştırma Katkısı"]));
  const supportPackage = aiAnalysis.editorialPackage(db, "video-001");
  const supportDecisions = Object.fromEntries(supportPackage.items.map((item) => [item.key, item.decision]));
  aiAnalysis.editorialSave(db, {
    videoId: "video-001",
    state: "curated",
    decisions: supportDecisions,
    nameOverrides: {},
    manualSponsors: [],
    manualContributors: [],
  });

  insertNode(db, {
    key: "story-diary",
    kind: "story",
    name: "Araştırma Günlüğü",
    summary: "Onaylı günlük omurgası.",
    sourceVideoIds: ["video-001"],
    payload: { sequence: [{ text: "İlk kayıt açıldı.", sourceVideoIds: ["video-001"] }] },
  });
  insertNode(db, {
    key: "object-stone",
    kind: "object",
    name: "Babil Taşı",
    summary: "Günlükte açıkça adı geçen taş.",
    sourceVideoIds: ["video-001", "video-002"],
    payload: { details: [{ text: "Üzerinde işaretler tarif edildi.", sourceVideoIds: ["video-002"] }] },
  });
  insertNode(db, {
    key: "location-room",
    kind: "location",
    name: "Çalışma Odası",
    summary: "Arşiv kayıtlarının tutulduğu mekân.",
    sourceVideoIds: ["video-002"],
  });
  db.prepare(`
    INSERT INTO universe_workspace_relations (
      key, run_id, from_key, to_key, label, source_video_ids_json, payload_json, state
    ) VALUES ('relation-story-stone', 1, 'story-diary', 'object-stone', 'inceliyor', '["video-001"]', '{}', 'approved')
  `).run();

  const run = narrative.prepareRun(db, { model: "publication-v2-fixture" });
  narrative.saveDraftSections(db, run.id, [
    {
      key: "section-first",
      position: 10,
      title: "Taşın İlk Kaydı",
      sourceKeys: ["story-diary", "object-stone"],
      blocks: [{ type: "paragraph", spans: [
        { type: "text", text: "Araştırma sırasında " },
        { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
        { type: "text", text: " yeniden incelendi." },
      ] }],
    },
    {
      key: "section-second",
      position: 20,
      title: "Odada Kalan Notlar",
      sourceKeys: ["story-diary", "location-room"],
      blocks: [{ type: "paragraph", spans: [
        { type: "text", text: "Notlar " },
        { type: "reference", entityId: "location-room", label: "Çalışma Odası" },
        { type: "text", text: " içinde tutuldu." },
      ] }],
    },
  ]);
  narrative.applyRun(db, run.id);

  let visualStatus = visualCompletion.status(db);
  assert.equal(visualStatus.sections.length, 2);
  const firstScene = visualStatus.sections.find((entry) => entry.sectionKey === "section-first");
  const secondScene = visualStatus.sections.find((entry) => entry.sectionKey === "section-second");
  assert.ok(firstScene && secondScene);

  const sceneFile = path.join(root, "scene.png");
  const objectFile = path.join(root, "object.webp");
  fs.writeFileSync(sceneFile, Buffer.from("scene-image-v1"));
  fs.writeFileSync(objectFile, Buffer.from("object-image-v1"));
  visualProfiles.attachStoredFile(db, firstScene.profileKey, {
    entityType: "narrative-scene",
    file: sceneFile,
    source: "generated",
    provider: "fixture-image-provider",
    model: "fixture-scene-model",
  });
  visualProfiles.save(db, {
    entityKey: "object-stone",
    entityType: "object",
    source: "ai",
    description: "Taşın kaynaklara dayalı arşiv görseli.",
  });
  visualProfiles.attachStoredFile(db, "object-stone", {
    entityType: "object",
    file: objectFile,
    source: "manual",
    provider: "",
    model: "",
  });
  visualStatus = visualCompletion.setSceneState(db, {
    sectionKey: secondScene.sectionKey,
    revisionId: secondScene.revisionId,
    state: "skipped",
  });
  assert.equal(visualStatus.complete, true);

  const first = publicationV2.buildPublicationV2(db, { generatedAt: "2026-08-14T17:00:00.000Z" });
  const second = publicationV2.buildPublicationV2(db, { generatedAt: "2026-08-14T18:00:00.000Z" });
  assert.equal(first.snapshot.schemaVersion, 2);
  assert.equal(first.snapshot.publication.contentFingerprint, second.snapshot.publication.contentFingerprint, "generatedAt content fingerprint'i değiştirmemeli");
  assert.equal(first.snapshot.publication.id, second.snapshot.publication.id, "Aynı semantik içerik stable publication id üretmeli");
  assert.equal(first.readiness.readyForTheme, true, "Onaylı anlatı + tamamlanmış sahne kararları tema yayınına hazır olmalı");
  assert.equal(first.snapshot.journal.sections.length, 2);
  assert.equal(first.snapshot.archive.entities.length, 3);
  assert.equal(first.snapshot.archive.relations.length, 1);
  assert.equal(first.snapshot.assets.length, 2, "Bir sahne ve bir entity görseli yayın asset'i olmalı");
  assert.deepEqual(first.snapshot.support.sponsors.map((entry) => entry.name), ["Defter Sponsoru"]);
  assert.deepEqual(first.snapshot.support.contributors.map((entry) => entry.name), ["Araştırma Katkısı"]);
  assert.deepEqual(first.snapshot.support.sponsors[0].video, {
    id: "video-001",
    title: "Destek Kaynak Videosu",
    url: "https://www.youtube.com/watch?v=video-001",
  });
  assert.equal(first.snapshot.support.sponsors[0].date, "2026-08-14");

  const sectionOne = first.snapshot.journal.sections.find((entry) => entry.sectionId === "section-first");
  const sectionTwo = first.snapshot.journal.sections.find((entry) => entry.sectionId === "section-second");
  assert.equal(sectionOne.order, 10, "order fiziksel sayfa değil semantik anlatı sırası olmalı");
  assert.equal(sectionOne.media.length, 1);
  assert.equal(sectionOne.media[0].role, "scene");
  assert.equal(sectionTwo.media.length, 0, "Görselsiz bırakılan bölüm sahne media'sı yayınlamamalı");
  assert.deepEqual(sectionOne.blocks[0].spans[1], { type: "reference", entityId: "object-stone", label: "Babil Taşı" });

  const stone = first.snapshot.archive.entities.find((entry) => entry.entityId === "object-stone");
  assert.ok(stone.visual.assetId, "Arşiv entity görseli stable assetId ile bağlanmalı");
  assert.deepEqual(stone.relations, ["relation-story-stone"]);
  assert.equal(first.snapshot.archive.relations[0].fromEntityId, "story-diary");
  assert.equal(first.snapshot.archive.relations[0].toEntityId, "object-stone");
  assert.ok(first.snapshot.assets.every((asset) => /^assets\/asset-.+-[a-f0-9]{12}\.(png|jpg|webp)$/.test(asset.url)), "Asset URL içerik hash'i taşımalı");
  assertNoPhysicalLayout(first.snapshot);
  assert.equal(JSON.stringify(first.snapshot).includes(root), false, "Publication v2 yerel dosya yolunu dışarı sızdırmamalı");

  const originalFingerprint = first.snapshot.publication.contentFingerprint;
  const originalObjectAsset = first.snapshot.assets.find((asset) => asset.entityId === "object-stone");
  fs.writeFileSync(objectFile, Buffer.from("object-image-v2-different"));
  const changedAsset = publicationV2.buildPublicationV2(db, { generatedAt: "2026-08-14T19:00:00.000Z" });
  const changedObjectAsset = changedAsset.snapshot.assets.find((asset) => asset.entityId === "object-stone");
  assert.notEqual(changedAsset.snapshot.publication.contentFingerprint, originalFingerprint, "Görsel binary değişirse content fingerprint değişmeli");
  assert.equal(changedObjectAsset.assetId, originalObjectAsset.assetId, "Görsel yenilense bile stable assetId korunmalı");
  assert.notEqual(changedObjectAsset.url, originalObjectAsset.url, "Görsel yenilenince cache-safe URL değişmeli");

  aiAnalysis.editorialSave(db, {
    videoId: "video-001",
    state: "curated",
    decisions: supportDecisions,
    nameOverrides: {},
    manualSponsors: [],
    manualContributors: ["Yayın Katkısı"],
  });
  const changedSupport = publicationV2.buildPublicationV2(db, { generatedAt: "2026-08-14T19:30:00.000Z" });
  assert.notEqual(
    changedSupport.snapshot.publication.contentFingerprint,
    changedAsset.snapshot.publication.contentFingerprint,
    "Sponsor/katkı değişikliği publication fingerprint'ini değiştirmeli",
  );
  assert.deepEqual(changedSupport.snapshot.support.contributors.map((entry) => entry.name), ["Araştırma Katkısı", "Yayın Katkısı"]);

  const staleAssetsDirectory = path.join(root, "public-export", "content", "assets");
  fs.mkdirSync(staleAssetsDirectory, { recursive: true });
  fs.writeFileSync(path.join(staleAssetsDirectory, "stale.png"), "stale");
  const exported = publicationV2.exportPublicationV2(db, root, { generatedAt: "2026-08-14T20:00:00.000Z" });
  assert.equal(fs.existsSync(exported.file), true);
  assert.equal(fs.existsSync(path.join(exported.assetsDirectory, "stale.png")), false, "Eski v2 asset artıkları export sırasında temizlenmeli");
  const diskSnapshot = JSON.parse(fs.readFileSync(exported.file, "utf8"));
  assert.equal(diskSnapshot.publication.contentFingerprint, exported.contentFingerprint);
  for (const asset of diskSnapshot.assets) assert.equal(fs.existsSync(path.join(path.dirname(exported.file), asset.url)), true, `${asset.assetId} dosyası self-contained pakette bulunmalı`);

  workspace.updateNode(db, { key: "object-stone", summary: "Publication exportundan sonra değişen onaylı Evren kaydı." });
  const pending = publicationV2.buildPublicationV2(db, { generatedAt: "2026-08-14T21:00:00.000Z" });
  assert.equal(pending.readiness.narrativeChangesPending, true);
  assert.equal(pending.readiness.readyForTheme, false, "Onaylı Evren anlatının önüne geçtiyse tema publish readiness kapanmalı");

  console.log("Publication v2 exports stable sections, explicit archive references, revision-bound semantic visuals, content-addressed assets and readiness without physical pagination");
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
