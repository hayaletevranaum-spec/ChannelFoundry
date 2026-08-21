const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const universeMerge = require("./universe-merge.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
universeMerge.ensureSchema(db);
db.exec(`
  CREATE TABLE youtube_videos (
    video_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE TABLE universe_workspace_imports (
    run_id INTEGER PRIMARY KEY,
    analysis_count INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '',
    node_count INTEGER NOT NULL DEFAULT 0,
    relation_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
`);
db.prepare("INSERT INTO youtube_videos (video_id,title,published_at) VALUES (?,?,?)").run("video-a", "Eski Kaynak", "2026-01-01");
db.prepare("INSERT INTO youtube_videos (video_id,title,published_at) VALUES (?,?,?)").run("video-b", "Yeni Kaynak", "2026-02-01");

const universe = {
  stories: [{ name: "Deneme Hikâyesi", aliases: [], summary: "Özet", sourceVideoIds: ["video-a", "video-b"], sequence: [], characterNames: [], locationNames: [], objectNames: [], visual: {} }],
  characters: [], events: [], locations: [], objects: [], relations: [],
};

db.prepare(`
  INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
  VALUES (1,'done','test-model',2,'video-a|video-b',?,CURRENT_TIMESTAMP)
`).run(JSON.stringify(universe));
db.prepare("INSERT INTO universe_ingest_runs (run_id,state,source_count) VALUES (1,'prepared',2)").run();
db.prepare("INSERT INTO universe_ingest_run_sources (run_id,provider,external_id,fingerprint) VALUES (1,'youtube','video-a','a')").run();
db.prepare("INSERT INTO universe_ingest_run_sources (run_id,provider,external_id,fingerprint) VALUES (1,'youtube','video-b','b')").run();

const result = universeMerge.latestResult(db, 1);
assert.equal(result.sources.length, 2);
assert.deepEqual(result.sources.map((source) => source.title), ["Eski Kaynak", "Yeni Kaynak"]);
assert.equal(result.complete, true);

assert.deepEqual(universeMerge.cancelActive(db), { canceled: 1, runId: 1 });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_runs WHERE id=1").get().count, 0);
assert.equal(db.prepare("SELECT state FROM universe_ingest_runs WHERE run_id=1").get().state, "discarded");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_ingest_sources").get().count, 0, "İptal edilen sonuç hiçbir kaynağı işlenmiş olarak kilitlememeli");

db.prepare(`
  INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
  VALUES (2,'error','test-model',1,'video-a','{}',CURRENT_TIMESTAMP)
`).run();
db.prepare("INSERT INTO universe_ingest_runs (run_id,state,source_count) VALUES (2,'prepared',1)").run();
assert.deepEqual(universeMerge.cancelActive(db), { canceled: 1, runId: 2 });
assert.equal(db.prepare("SELECT state FROM universe_ingest_runs WHERE run_id=2").get().state, "discarded", "Başarısız çalışma da güvenle temizlenebilmeli");

db.prepare(`
  INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
  VALUES (3,'done','test-model',1,'video-a',?,CURRENT_TIMESTAMP)
`).run(JSON.stringify({ ...universe, stories: [{ ...universe.stories[0], sourceVideoIds: ["video-a"] }] }));
db.prepare("INSERT INTO universe_ingest_runs (run_id,state,source_count,applied_at) VALUES (3,'applied',1,CURRENT_TIMESTAMP)").run();
assert.throws(() => universeMerge.cancelActive(db), /zaten 04 · İnceleme alanına aktarıldı/);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_runs WHERE id=3").get().count, 1, "Uygulanmış çalışma sonuç ekranından silinmemeli");

db.prepare(`
  INSERT INTO universe_merge_runs (id,state,model,analysis_count,source_signature,result_json,finished_at)
  VALUES (4,'done','test-model',1,'video-b',?,CURRENT_TIMESTAMP)
`).run(JSON.stringify({ ...universe, stories: [{ ...universe.stories[0], sourceVideoIds: ["video-b"] }] }));
db.prepare("INSERT INTO universe_ingest_runs (run_id,state,source_count) VALUES (4,'prepared',1)").run();
db.prepare("INSERT INTO universe_workspace_imports (run_id,analysis_count,model,node_count,relation_count) VALUES (4,1,'test-model',1,0)").run();
assert.throws(() => universeMerge.cancelActive(db), /zaten 04 · İnceleme alanına aktarıldı/, "Eski/veri göçü durumunda import kaydı da iptali engellemeli");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_runs WHERE id=4").get().count, 1);

const workbench = fs.readFileSync(path.join(__dirname, "src", "IncrementalUniverseWorkbench.tsx"), "utf8");
assert.match(workbench, /Çalışmayı iptal et/, "03 · Evrene İşleme tamamlanmış veya başarısız sonucu iptal edebilmeli");
assert.match(workbench, /ÜRETİLEN EVREN TASLAĞI/, "03 · Evrene İşleme gerçek sonuçları inceleme yüzeyi göstermeli");
assert.match(workbench, /Kaynak videolar/, "Sonuç ekranı kullanılan kaynakları göstermeli");
assert.match(workbench, /resultCategories/, "Sonuç ekranı Hikâye, Muhatap, Olay, Mekân, Nesne ve Bağlantı türlerine ayrılmalı");

db.close();
console.log("Universe result inspection and safe pre-apply cancellation verified");
