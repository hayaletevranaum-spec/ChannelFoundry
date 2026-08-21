const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const ingest = require("./universe-ingest.cjs");
const workspaceCore = require("./universe-workspace-core.cjs");
const workspacePublic = require("./universe-workspace-public.cjs");
const { comparePublicSnapshots } = require("./publication-preview.cjs");

const scales = [100, 300, 600];

function round(value) {
  return Math.round(value * 10) / 10;
}

function emptySnapshot(label) {
  return {
    generatedAt: label,
    universe: {
      videos: [],
      characters: [],
      events: [],
      files: [],
      relations: [],
    },
    counts: { items: 0, relations: 0 },
  };
}

function analysisPayload(index) {
  const videoId = `scale-${String(index + 1).padStart(4, "0")}`;
  const characterName = `Muhatap ${String((index % 60) + 1).padStart(2, "0")}`;
  const locationName = `Mekân ${String((index % 30) + 1).padStart(2, "0")}`;
  const objectName = `Nesne ${String((index % 40) + 1).padStart(2, "0")}`;
  return {
    videoId,
    title: `Ölçek videosu ${index + 1}`,
    characterName,
    locationName,
    objectName,
  };
}

function seedCuratedAnalysis(db, index) {
  const source = analysisPayload(index);
  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube', ?, 'scale-test-model', ?, ?, ?, ?, ?, '{}', ?, ?, ?, '[]', '[]', '[]')
  `).run(
    source.videoId,
    source.title,
    `${source.title} için sentetik çözümleme özeti.`,
    JSON.stringify(["ölçek", `grup-${index % 12}`]),
    JSON.stringify([`${source.title} anlatı akışı.`]),
    JSON.stringify([`Hikâye hattı ${(index % 8) + 1}`]),
    JSON.stringify([{ name: source.characterName, aliases: [], role: "muhatap", details: [`${source.videoId} karakter ayrıntısı`], visual: {} }]),
    JSON.stringify([{ name: source.locationName, details: [`${source.videoId} mekân ayrıntısı`], visual: {} }]),
    JSON.stringify([{ name: source.objectName, details: [`${source.videoId} nesne ayrıntısı`], visual: {} }]),
  );

  const pack = aiAnalysis.editorialPackage(db, source.videoId);
  const decisions = Object.fromEntries(pack.items.map((item) => [item.key, "include"]));
  aiAnalysis.editorialSave(db, {
    videoId: source.videoId,
    state: "curated",
    decisions,
    manualSponsors: [],
    manualContributors: [],
  });
  return source.videoId;
}

function insertApprovedWorkspace(db, sourceIds) {
  workspaceCore.ensureSchema(db);
  const insertNode = db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'approved')
  `);
  const insertRelation = db.prepare(`
    INSERT INTO universe_workspace_relations (
      key, run_id, from_key, to_key, label, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, ?, '{}', 'approved')
  `);

  const storyKey = "scale-story-core";
  insertNode.run(
    storyKey,
    "story",
    "Ölçek Ana Hikâyesi",
    `${sourceIds.length} kaynak videodan biriken ana hikâye kaydı.`,
    JSON.stringify(sourceIds),
    JSON.stringify({
      name: "Ölçek Ana Hikâyesi",
      summary: `${sourceIds.length} kaynak videodan biriken ana hikâye kaydı.`,
      sourceVideoIds: sourceIds,
      sequence: [{ text: "Tüm ölçek kaynaklarını temsil eden iz.", sourceVideoIds: sourceIds }],
      characterNames: [],
      locationNames: [],
      objectNames: [],
      visual: {},
    }),
  );

  const bucketSize = 10;
  const bucketCount = Math.ceil(sourceIds.length / bucketSize);
  const nodeKeys = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketSources = sourceIds.slice(bucket * bucketSize, (bucket + 1) * bucketSize);
    const key = `scale-character-${String(bucket + 1).padStart(3, "0")}`;
    nodeKeys.push(key);
    insertNode.run(
      key,
      "character",
      `Ölçek Muhatabı ${bucket + 1}`,
      `${bucketSources.length} kaynakla doğrulanan sentetik muhatap.`,
      JSON.stringify(bucketSources),
      JSON.stringify({
        name: `Ölçek Muhatabı ${bucket + 1}`,
        summary: `${bucketSources.length} kaynakla doğrulanan sentetik muhatap.`,
        sourceVideoIds: bucketSources,
        roles: ["ölçek testi"],
        details: [{ text: `Kaynak grubu ${bucket + 1}`, sourceVideoIds: bucketSources }],
        visual: {},
      }),
    );
    insertRelation.run(
      `scale-relation-${String(bucket + 1).padStart(3, "0")}`,
      storyKey,
      key,
      "hikâyede yer alıyor",
      JSON.stringify(bucketSources),
    );
  }

  if (nodeKeys.length) {
    insertRelation.run(
      "scale-relation-full-provenance",
      storyKey,
      nodeKeys[0],
      "tüm kaynak izi",
      JSON.stringify(sourceIds),
    );
  }

  return { storyKey, bucketCount, fullRelationKey: "scale-relation-full-provenance" };
}

function runScale(sourceCount) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  aiAnalysis.ensureSchema(db);
  ingest.ensureSchema(db);
  workspaceCore.ensureSchema(db);

  const heapStart = process.memoryUsage().heapUsed;
  const started = performance.now();

  const seedStarted = performance.now();
  const sourceIds = [];
  for (let index = 0; index < sourceCount; index += 1) sourceIds.push(seedCuratedAnalysis(db, index));
  const seedMs = performance.now() - seedStarted;

  const ingestStarted = performance.now();
  const pending = ingest.pendingSources(db);
  assert.equal(pending.length, sourceCount, `${sourceCount}: tüm ayıklanmış kaynaklar Evrene İşleme için beklemeli`);
  ingest.prepareRun(db, 1, pending);
  const applied = ingest.markApplied(db, 1);
  assert.deepEqual(applied, { tracked: true, processed: sourceCount });
  assert.equal(ingest.status(db).pending, 0, `${sourceCount}: uygulama sonrası bekleyen kaynak kalmamalı`);
  const ingestMs = performance.now() - ingestStarted;

  const workspaceStarted = performance.now();
  const layout = insertApprovedWorkspace(db, sourceIds);
  const workspaceMs = performance.now() - workspaceStarted;

  const publicationStarted = performance.now();
  const snapshot = workspacePublic.attachPublicSnapshot(db, emptySnapshot(`scale-${sourceCount}-v1`));
  const editorial = snapshot.universe.editorial;
  assert.equal(editorial.counts.nodes, layout.bucketCount + 1, `${sourceCount}: public node sayısı korunmalı`);
  assert.equal(editorial.counts.relations, layout.bucketCount + 1, `${sourceCount}: public bağlantı sayısı korunmalı`);

  const central = editorial.nodes.find((node) => node.id === layout.storyKey);
  assert.ok(central, `${sourceCount}: ana hikâye public pakette bulunmalı`);
  assert.equal(central.sourceVideoIds.length, sourceCount, `${sourceCount}: node kaynak izi kesilmemeli`);
  assert.equal(central.sequence?.[0]?.sourceVideoIds?.length, sourceCount, `${sourceCount}: ayrıntı kaynak izi kesilmemeli`);

  const fullRelation = editorial.relations.find((relation) => relation.id === layout.fullRelationKey);
  assert.ok(fullRelation, `${sourceCount}: tam kaynak izli bağlantı bulunmalı`);
  assert.equal(fullRelation.sourceVideoIds.length, sourceCount, `${sourceCount}: bağlantı kaynak izi kesilmemeli`);

  const firstDiff = comparePublicSnapshots(null, snapshot, []);
  assert.equal(firstDiff.nodes.added, editorial.counts.nodes, `${sourceCount}: ilk yayın farkı tüm düğümleri yeni göstermeli`);
  assert.equal(firstDiff.relations.added, editorial.counts.relations, `${sourceCount}: ilk yayın farkı tüm bağlantıları yeni göstermeli`);

  db.prepare("UPDATE universe_workspace_nodes SET summary=summary || ' Güncellendi.', updated_at=CURRENT_TIMESTAMP WHERE key=?").run(layout.storyKey);
  const changedSnapshot = workspacePublic.attachPublicSnapshot(db, emptySnapshot(`scale-${sourceCount}-v2`));
  const secondDiff = comparePublicSnapshots(snapshot, changedSnapshot, []);
  assert.equal(secondDiff.nodes.changed, 1, `${sourceCount}: yalnız değişen kayıt yayın farkına düşmeli`);
  assert.equal(secondDiff.nodes.added, 0);
  assert.equal(secondDiff.nodes.removed, 0);
  assert.equal(secondDiff.relations.changed, 0);
  const publicationMs = performance.now() - publicationStarted;

  const totalMs = performance.now() - started;
  const heapDeltaMb = Math.max(0, process.memoryUsage().heapUsed - heapStart) / 1024 / 1024;
  const result = {
    sources: sourceCount,
    nodes: editorial.counts.nodes,
    relations: editorial.counts.relations,
    seedMs: round(seedMs),
    ingestMs: round(ingestMs),
    workspaceMs: round(workspaceMs),
    publicationMs: round(publicationMs),
    totalMs: round(totalMs),
    heapDeltaMb: round(heapDeltaMb),
  };
  db.close();
  return result;
}

const results = scales.map(runScale);
console.table(results);

const largest = results.at(-1);
assert.equal(largest.sources, 600);
assert.ok(largest.nodes >= 61, "600 kaynak testinde gerçekçi sayıda editoryal kayıt oluşmalı");
assert.ok(largest.relations >= 61, "600 kaynak testinde gerçekçi sayıda bağlantı oluşmalı");
console.log("Scale verification: 100/300/600 curated sources keep ingest locks, 600-source provenance and publication diffs intact without AI calls");
