const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrative = require("./narrative-store.cjs");
const visualProfiles = require("./visual-profiles.cjs");
const visualCompletion = require("./visual-completion-store.cjs");

function insertNode(db, { key, kind, name, summary, sourceVideoIds, visual }) {
  db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'approved')
  `).run(key, kind, name, summary, JSON.stringify(sourceVideoIds), JSON.stringify({ name, summary, visual }));
}

function saveNarrative(db, runId, input = {}) {
  narrative.saveDraftSections(db, runId, [{
    key: "chapter-visual",
    position: 5,
    title: "Taşın Kaydı",
    sourceKeys: ["story-visual", "object-stone"],
    blocks: [{ type: "paragraph", spans: [
      { type: "text", text: input.revised ? "Yeni kayıtta " : "Araştırma sırasında " },
      { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
      { type: "text", text: input.revised ? " için ek bir ayrıntı kayda geçti." : " yeniden karşıma çıktı." },
    ] }],
    media: [],
    retire: false,
  }]);
  return narrative.applyRun(db, runId);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-visual-completion-"));
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
try {
  workspace.ensureSchema(db);
  narrative.ensureSchema(db);
  insertNode(db, {
    key: "story-visual",
    kind: "story",
    name: "Görsel Kaynak Hikâyesi",
    summary: "Bölümün onaylı anlatı kaynağı.",
    sourceVideoIds: ["video-visual"],
    visual: {},
  });
  insertNode(db, {
    key: "object-stone",
    kind: "object",
    name: "Babil Taşı",
    summary: "Koyu yüzeyli, işaretli taş nesnesi.",
    sourceVideoIds: ["video-visual"],
    visual: {
      description: "Kaynakta koyu yüzeyli ve işaretli taş olarak tarif edilir.",
      attributes: ["koyu yüzey", "işaretli taş"],
      atmosphere: "Nötr arşiv kaydı",
      prompt: "Koyu yüzeyli, işaretli taşın nötr arşiv illüstrasyonu.",
      negativePrompt: "metin, logo, ek nesne",
    },
  });

  const firstRun = narrative.prepareRun(db, { model: "visual-fixture" });
  const firstApplied = saveNarrative(db, firstRun.id);
  assert.equal(firstApplied.memory.length, 1);

  let status = visualCompletion.status(db);
  assert.equal(status.counts.sections, 1);
  assert.equal(status.counts.scenePending, 1);
  assert.equal(status.counts.sceneReady, 0);
  assert.equal(status.counts.entities, 1);
  assert.equal(status.entities[0].entityId, "object-stone");
  assert.equal(status.entities[0].role, "artifact");
  assert.match(status.entities[0].seed.prompt, /Koyu yüzeyli/);
  assert.match(status.sections[0].seed.prompt, /Taşın Kaydı/);
  assert.match(status.sections[0].seed.prompt, /yeni bilgi eklememeli|yalnız/i);
  assert.equal(Object.prototype.hasOwnProperty.call(status.sections[0].profile ?? {}, "imageDataUrl"), false, "Liste durumu base64 görsel taşımamalı");

  const firstScene = status.sections[0];
  const firstAssetId = firstScene.assetId;
  const firstProfileKey = firstScene.profileKey;
  status = visualCompletion.setSceneState(db, { sectionKey: firstScene.sectionKey, revisionId: firstScene.revisionId, state: "skipped" });
  assert.equal(status.sections[0].state, "skipped");
  assert.equal(status.complete, true, "Açık görselsiz kararı sahne kararını tamamlamalı");
  status = visualCompletion.setSceneState(db, { sectionKey: firstScene.sectionKey, revisionId: firstScene.revisionId, state: "pending" });
  assert.equal(status.sections[0].state, "pending");

  const sceneFile = path.join(root, "scene.png");
  fs.writeFileSync(sceneFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  visualProfiles.attachStoredFile(db, firstProfileKey, {
    entityType: "narrative-scene",
    file: sceneFile,
    source: "generated",
    provider: "fixture-image",
    model: "fixture-scene-model",
  });
  status = visualCompletion.status(db);
  assert.equal(status.sections[0].state, "ready");
  assert.equal(status.sections[0].profile.imageModel, "fixture-scene-model");
  assert.equal(status.complete, true);

  const entityFile = path.join(root, "entity.png");
  fs.writeFileSync(entityFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  visualProfiles.attachStoredFile(db, "object-stone", {
    entityType: "object",
    file: entityFile,
    source: "manual",
    provider: "",
    model: "",
  });
  status = visualCompletion.status(db);
  assert.equal(status.entities[0].hasImage, true, "Entity görseli ortak entity_visual_profiles kaydından yeniden kullanılmalı");

  workspace.updateNode(db, { key: "story-visual", summary: "Onaylı hikâye kaynağı yeni ayrıntıyla güncellendi." });
  const secondRun = narrative.prepareRun(db, { model: "visual-fixture-2" });
  const secondApplied = saveNarrative(db, secondRun.id, { revised: true });
  assert.equal(secondApplied.memory[0].revisionNo, 2);

  status = visualCompletion.status(db);
  assert.equal(status.sections.length, 1, "Yalnız güncel anlatı revizyonu Görsel Tamamlama listesinde görünmeli");
  assert.equal(status.sections[0].state, "pending", "Yeni anlatı revizyonu eski sahne görselini sessizce miras almamalı");
  assert.notEqual(status.sections[0].profileKey, firstProfileKey);
  assert.notEqual(status.sections[0].assetId, firstAssetId);
  assert.equal(status.entities[0].hasImage, true, "Global entity görseli anlatı revizyonları arasında yeniden kullanılmalı");

  const ui = fs.readFileSync(path.join(__dirname, "src", "VisualCompletionWorkbench.tsx"), "utf8");
  assert.match(ui, /06 · GÖRSEL TAMAMLAMA/);
  assert.match(ui, /visualCompletionSetSceneState/);
  assert.match(ui, /VisualProfileEditor/);
  assert.match(ui, /1536x1024/);
  const rail = fs.readFileSync(path.join(__dirname, "src", "AiWorkbench.tsx"), "utf8");
  assert.match(rail, /<span>06<\/span>/);
  assert.match(rail, /VisualCompletionWorkbench/);
  const compact = fs.readFileSync(path.join(__dirname, "src", "ai-stage-rail-compact.css"), "utf8");
  assert.match(compact, /repeat\(6,/);
  const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
  assert.match(preload, /visualCompletionStatus/);
  assert.match(preload, /visualCompletionSetSceneState/);
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Visual completion keeps scene assets revision-bound, entity visuals reusable, skip decisions explicit and list metadata base64-free");
