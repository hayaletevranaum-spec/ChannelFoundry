const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrativeService = require("./narrative-service.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
workspace.ensureSchema(db);

db.prepare(`
  INSERT INTO universe_workspace_nodes (
    key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
  ) VALUES ('story-ui', 1, 'story', 'UI Hikâyesi', 'Onaylı anlatı kaynağı.', '[]', '["video-ui"]', '{}', 'approved')
`).run();

const response = (title) => ({
  contractVersion: 1,
  sections: [{
    order: 0,
    title,
    sourceKeys: ["story-ui"],
    blocks: [{
      type: "paragraph",
      spans: [
        { type: "text", text: "Kayda göre " },
        { type: "reference", entityId: "story-ui", label: "UI Hikâyesi" },
        { type: "text", text: " anlatıda yer alır." },
      ],
    }],
    media: [],
    retire: false,
  }],
});

let status = narrativeService.status(db);
assert.equal(status.workingRun, null, "Açık Hikâyeleştir çalışması yokken workingRun null olmalı");
assert.equal(status.next.hasChanges, true, "İlk approved Evren anlatı değişikliği olarak görünmeli");

const prepared = narrativeService.prepare(db, { model: "ui-fixture" });
status = narrativeService.status(db);
assert.equal(status.workingRun.run.id, prepared.run.id, "Status prepared çalışmayı uygulama yeniden açılmış gibi geri yüklemeli");
assert.equal(status.workingRun.run.state, "prepared");
assert.ok(status.workingRun.request, "Fresh prepared çalışma frozen AI request taşımalı");
assert.equal(status.workingRun.drafts.length, 0);

narrativeService.saveDraftResponse(db, { runId: prepared.run.id, response: response("UI anlatı bölümü") });
status = narrativeService.status(db);
assert.equal(status.workingRun.drafts.length, 1, "Status kaydedilmiş AI taslağını geri yüklemeli");
assert.equal(status.workingRun.drafts[0].entityReferences[0].entityId, "story-ui");

workspace.updateNode(db, { key: "story-ui", summary: "UI açık değilken approved Evren değişti." });
status = narrativeService.status(db);
assert.equal(status.workingRun.run.state, "stale", "Status eski prepared çalışmayı stale olarak göstermeli");
assert.equal(status.workingRun.request, null, "Stale çalışma yeni AI request vermemeli");
assert.equal(status.workingRun.drafts.length, 1, "Stale taslak editoryal inceleme için korunmalı");

const fresh = narrativeService.prepare(db, { model: "ui-fresh-fixture" });
assert.ok(fresh.run.id > prepared.run.id, "Güncel Evren yeni bir run oluşturmalı");
narrativeService.saveDraftResponse(db, { runId: fresh.run.id, response: response("Güncel UI anlatısı") });
narrativeService.apply(db, fresh.run.id);
status = narrativeService.status(db);
assert.equal(status.workingRun, null, "Daha yeni applied turdan önce kalan stale run yeniden açık çalışma gibi görünmemeli");
assert.equal(status.next.hasChanges, false, "Yeni applied anlatı güncel Evreni baseline yapmalı");
assert.equal(status.memory.length, 1, "Yeni applied tur yaşayan anlatı belleğini oluşturmalı");

narrativeService.discard(db, prepared.run.id);
status = narrativeService.status(db);
assert.equal(status.workingRun, null, "Eski stale run discard edilince de açık çalışma kalmamalı");

const aiWorkbench = fs.readFileSync(path.join(__dirname, "src", "AiWorkbench.tsx"), "utf8");
assert.match(aiWorkbench, /"narrative"/, "AI Atölyesi narrative workbench mode taşımalı");
assert.match(aiWorkbench, /<span>05<\/span>/, "Aşama rayında 05 bulunmalı");
assert.match(aiWorkbench, /Hikâyeleştir/, "Aşama rayında Hikâyeleştir etiketi bulunmalı");
assert.match(aiWorkbench, /<NarrativeWorkbench\/>/, "05 aşaması ayrı NarrativeWorkbench render etmeli");

const uiSource = fs.readFileSync(path.join(__dirname, "src", "NarrativeWorkbench.tsx"), "utf8");
for (const method of ["narrativeStatus", "narrativePrepare", "narrativeGenerateDraft", "narrativeApply", "narrativeDiscard"]) {
  assert.match(uiSource, new RegExp(method), `Narrative UI ${method} akışını kullanmalı`);
}
assert.match(uiSource, /entityReferences/, "Editoryal UI explicit Evren referanslarını göstermeli");
assert.match(uiSource, /sourceVideoIds/, "Editoryal UI kaynak video provenance bilgisini göstermeli");
assert.match(uiSource, /stale/, "Editoryal UI stale durumunu görünür kılmalı");
assert.match(uiSource, /confirm\(/, "Onay ve vazgeç kullanıcı kararını açıkça istemeli");
assert.doesNotMatch(uiSource, /visualImageGenerate|assetId\s*:/, "Hikâyeleştir UI Görsel Tamamlama üretimini başlatmamalı");

const cssSource = fs.readFileSync(path.join(__dirname, "src", "narrative-workbench.css"), "utf8");
assert.match(cssSource, /\.narrative-draft-card/, "Narrative draft inceleme kartı stili bulunmalı");
assert.match(cssSource, /\.narrative-state\.stale/, "Stale durumunun ayrı görsel sinyali bulunmalı");

db.close();
console.log("Narrative editorial UI restores current prepared or stale work, ignores obsolete stale runs after a newer apply, exposes provenance and keeps approval explicit");
