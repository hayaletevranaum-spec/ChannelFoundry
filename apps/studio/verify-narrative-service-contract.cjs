const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const youtubeCatalog = require("./youtube-catalog.cjs");
const narrativeService = require("./narrative-service.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);
youtubeCatalog.ensureSchema(db);

db.prepare(`
  INSERT INTO youtube_channels (id, url, title, handle, video_count)
  VALUES ('channel-test', 'https://www.youtube.com/@test', 'Test', '@test', 2)
`).run();
const insertVideo = db.prepare(`
  INSERT INTO youtube_videos (
    video_id, channel_id, title, published_at, canonical_url, thumbnail_url
  ) VALUES (?, 'channel-test', ?, ?, ?, '')
`);
insertVideo.run("video-010", "İlk kaynak", "2024-02-10T10:00:00Z", "https://www.youtube.com/watch?v=video-010");
insertVideo.run("video-011", "İkinci kaynak", "2024-03-12T10:00:00Z", "https://www.youtube.com/watch?v=video-011");

function insertNode({ key, kind, name, summary, sourceVideoIds }) {
  db.prepare(`
    INSERT INTO universe_workspace_nodes (
      key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
    ) VALUES (?, 1, ?, ?, ?, '[]', ?, ?, 'approved')
  `).run(key, kind, name, summary, JSON.stringify(sourceVideoIds), JSON.stringify({ name, summary }));
}

insertNode({ key: "story-diary", kind: "story", name: "Araştırma Günlüğü", summary: "Onaylı hikâye.", sourceVideoIds: ["video-010"] });
insertNode({ key: "object-stone", kind: "object", name: "Babil Taşı", summary: "Onaylı obje.", sourceVideoIds: ["video-010", "video-011"] });

const initial = narrativeService.status(db);
assert.equal(initial.next.hasChanges, true);
assert.equal(initial.next.changes, 2);

const prepared = narrativeService.prepare(db, { model: "contract-fixture" });
assert.equal(prepared.run.state, "prepared");
assert.equal(prepared.request.contractVersion, 1);
assert.equal(prepared.request.rules.physicalPaginationAllowed, false);
assert.equal(prepared.request.input.allowedSources.length, 2);
assert.deepEqual(prepared.request.input.sourceVideos.map((item) => [item.videoId, item.publishedAt]), [
  ["video-010", "2024-02-10T10:00:00Z"],
  ["video-011", "2024-03-12T10:00:00Z"],
]);

assert.throws(() => narrativeService.saveDraftResponse(db, {
  runId: prepared.run.id,
  response: {
    contractVersion: 1,
    sections: [{ pageNumber: 4, order: 0, title: "Yanlış", sourceKeys: ["story-diary"], blocks: [{ type: "paragraph", spans: [{ type: "text", text: "Metin" }] }] }],
  },
}), /sayfa|spread/i, "Studio fiziksel sayfa numarasını kabul etmemeli");

assert.throws(() => narrativeService.saveDraftResponse(db, {
  runId: prepared.run.id,
  response: {
    contractVersion: 1,
    sections: [{ sectionId: "ai-invented-id", order: 0, title: "Yanlış", sourceKeys: ["story-diary"], blocks: [{ type: "paragraph", spans: [{ type: "text", text: "Metin" }] }] }],
  },
}), /sectionId AI tarafından belirlenemez/i, "Yeni stable section kimliğini AI belirlememeli");

const saved = narrativeService.saveDraftResponse(db, {
  runId: prepared.run.id,
  response: {
    contractVersion: 1,
    sections: [{
      order: 0,
      title: "Taşın İzinde",
      sourceKeys: ["story-diary", "object-stone"],
      blocks: [{ type: "paragraph", spans: [
        { type: "text", text: "Araştırma sırasında " },
        { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
        { type: "text", text: " yeniden karşıma çıktı." },
      ] }],
    }],
  },
});
assert.equal(saved.drafts.length, 1);
assert.match(saved.drafts[0].sectionKey, /^narrative-section-[a-f0-9]{14}$/);
assert.equal(saved.drafts[0].entityReferences[0].entityId, "object-stone");
assert.deepEqual(saved.drafts[0].sourceVideoIds, ["video-010", "video-011"]);
const stableSectionId = saved.drafts[0].sectionKey;

const applied = narrativeService.apply(db, prepared.run.id);
assert.equal(applied.run.state, "applied");
assert.equal(applied.memory[0].sectionKey, stableSectionId);
assert.equal(applied.status.next.hasChanges, false);

workspace.updateNode(db, { key: "object-stone", summary: "Onaylı obje yeni bilgiyle güncellendi.", state: "approved" });
const second = narrativeService.prepare(db, { model: "contract-fixture" });
assert.equal(second.request.input.baselineNarrative[0].sectionKey, stableSectionId);
assert.deepEqual(second.request.input.changes.map((item) => item.sourceKey), ["object-stone"]);

const revised = narrativeService.saveDraftResponse(db, {
  runId: second.run.id,
  response: {
    contractVersion: 1,
    sections: [{
      sectionId: stableSectionId,
      order: 0,
      title: "Taşın İzinde — Güncel",
      sourceKeys: ["story-diary", "object-stone"],
      blocks: [{ type: "paragraph", spans: [
        { type: "reference", entityId: "object-stone", label: "Babil Taşı" },
        { type: "text", text: " hakkındaki yeni onaylı bilgi anlatıya işlendi." },
      ] }],
    }],
  },
});
assert.equal(revised.drafts[0].sectionKey, stableSectionId, "Mevcut bölüm revizyonunda stable sectionId korunmalı");
assert.equal(revised.drafts[0].revisionNo, 2);

console.log("Narrative service builds provider-independent factual requests with real source dates, Studio-owned stable section ids and page-free structured responses");
