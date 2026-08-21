const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const { registerNarrativeIpc } = require("./narrative-ipc.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);
db.prepare(`
  INSERT INTO universe_workspace_nodes (
    key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
  ) VALUES ('story-ipc', 1, 'story', 'IPC Hikâyesi', 'Onaylı kaynak.', '[]', '["video-ipc"]', '{}', 'approved')
`).run();

const handlers = new Map();
const ipcMain = {
  handle(channel, callback) {
    assert.equal(handlers.has(channel), false, `IPC kanalı iki kez kaydedilmemeli: ${channel}`);
    handlers.set(channel, callback);
  },
};
let refreshCount = 0;
const runtime = {
  database: () => db,
  refreshMainWindow: () => { refreshCount += 1; },
};
registerNarrativeIpc(ipcMain, runtime);

const expectedChannels = [
  "studio:narrative-status",
  "studio:narrative-prepare",
  "studio:narrative-run",
  "studio:narrative-request",
  "studio:narrative-save-draft-response",
  "studio:narrative-generate-draft",
  "studio:narrative-apply",
  "studio:narrative-discard",
];
assert.deepEqual([...handlers.keys()], expectedChannels);
const call = (channel, payload) => handlers.get(channel)?.({}, payload);

const initial = call("studio:narrative-status");
assert.equal(initial.next.hasChanges, true);
const prepared = call("studio:narrative-prepare", { model: "ipc-fixture" });
assert.equal(prepared.run.state, "prepared");
assert.equal(prepared.request.contractVersion, 1);
assert.equal(refreshCount, 1, "Prepare renderer durumunu yenilemeli");
assert.equal(call("studio:narrative-run", prepared.run.id).run.id, prepared.run.id);
assert.equal(call("studio:narrative-request", prepared.run.id).run.id, prepared.run.id);

const saved = call("studio:narrative-save-draft-response", {
  runId: prepared.run.id,
  response: {
    contractVersion: 1,
    sections: [{
      order: 0,
      title: "IPC Bölümü",
      sourceKeys: ["story-ipc"],
      blocks: [{ type: "paragraph", spans: [{ type: "text", text: "IPC üzerinden kaydedilen anlatı taslağı." }] }],
      media: [],
      retire: false,
    }],
  },
});
assert.equal(saved.drafts.length, 1);
assert.equal(saved.drafts[0].title, "IPC Bölümü");
assert.equal(refreshCount, 2, "Taslak kaydı renderer durumunu yenilemeli");

const applied = call("studio:narrative-apply", prepared.run.id);
assert.equal(applied.run.state, "applied");
assert.equal(applied.memory.length, 1);
assert.equal(refreshCount, 3, "Apply renderer durumunu yenilemeli");

workspace.updateNode(db, { key: "story-ipc", summary: "Yeni onaylı değişiklik.", state: "approved" });
const second = call("studio:narrative-prepare");
assert.equal(second.run.state, "prepared");
const discarded = call("studio:narrative-discard", second.run.id);
assert.equal(discarded.run.state, "discarded");
assert.equal(refreshCount, 5, "İkinci prepare ve discard iki yenileme yapmalı");

const studioIpcSource = fs.readFileSync(path.join(__dirname, "studio-ipc.cjs"), "utf8");
assert.match(studioIpcSource, /registerNarrativeIpc\(ipcMain, runtime\)/, "Ana Studio IPC narrative handler'larını kaydetmeli");
const preloadSource = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
for (const method of [
  "narrativeStatus", "narrativePrepare", "narrativeGetRun", "narrativeBuildRequest",
  "narrativeSaveDraftResponse", "narrativeGenerateDraft", "narrativeApply", "narrativeDiscard",
]) {
  assert.match(preloadSource, new RegExp(`${method}:`), `Preload ${method} köprüsünü yayınlamalı`);
}

const typeSource = fs.readFileSync(path.join(__dirname, "src", "narrative-api-contract.d.ts"), "utf8");
assert.match(typeSource, /type StudioNarrativeBridge/, "Renderer için narrative TypeScript köprü sözleşmesi bulunmalı");
assert.match(typeSource, /narrativeGenerateDraft/, "Renderer type contract AI draft üretimini kapsamalı");

db.close();
console.log("Narrative IPC exposes the provider-independent lifecycle plus explicit AI draft generation and refreshes Studio after mutations");
