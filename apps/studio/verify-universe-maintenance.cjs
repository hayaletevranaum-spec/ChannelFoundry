const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const aiAnalysis = require("./ai-analysis.cjs");
const ingest = require("./universe-ingest.cjs");
const universeMerge = require("./universe-merge.cjs");
const workspace = require("./universe-workspace.cjs");
const maintenance = require("./universe-maintenance.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-universe-maintenance-"));
const databasePath = path.join(root, "studio.sqlite");
const db = new DatabaseSync(databasePath);

try {
  aiAnalysis.ensureSchema(db);
  ingest.ensureSchema(db);
  universeMerge.ensureSchema(db);
  workspace.ensureSchema(db);

  db.prepare(`
    INSERT INTO source_ai_analyses (
      provider, external_id, model, title, summary, topics_json, story_beats_json, story_hints_json,
      cover_visual_json, characters_json, locations_json, objects_json, scenes_json, sponsors_json, contributors_json
    ) VALUES ('youtube','video-a','test-model','Video A','Özet','[]','[]','[]','{}',?,'[]','[]','[]','[]','[]')
  `).run(JSON.stringify([{ name: "Ömer", aliases: [], role: "Araştırmacı", details: ["Defteri inceler"], visual: {} }]));

  const initial = aiAnalysis.editorialPackage(db, "video-a");
  const character = initial.items.find((item) => item.category === "character");
  const decisions = Object.fromEntries(initial.items.map((item) => [item.key, item.decision]));
  decisions[character.key] = "include";
  aiAnalysis.editorialSave(db, { videoId: "video-a", state: "curated", decisions });

  db.prepare("INSERT INTO universe_ingest_sources (provider, external_id, fingerprint, last_run_id) VALUES ('youtube','video-a','processed',1)").run();
  db.prepare(`
    INSERT INTO universe_workspace_nodes (key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state)
    VALUES ('node-a',1,'character','Ömer','Özet','[]','["video-a"]','{}','approved')
  `).run();

  const before = maintenance.status(db);
  assert.equal(before.reset.universe_workspace_nodes, 1);
  assert.equal(before.reset.universe_ingest_sources, 1);
  assert.equal(before.preserved.source_ai_analyses, 1);
  assert.equal(before.active, false);
  assert.throws(() => maintenance.reset(db, root, { confirmation: "yanlış" }), /Onay metni tam olarak/);

  const result = maintenance.reset(db, root, { confirmation: maintenance.CONFIRMATION });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.backup), "Reset öncesi SQLite yedeği oluşturulmalı");
  assert.equal(result.after.reset.universe_workspace_nodes, 0);
  assert.equal(result.after.reset.universe_ingest_sources, 0);
  assert.equal(result.after.preserved.source_ai_analyses, 1);
  assert.equal(ingest.status(db).pending, 1, "Korunan Ayıklama yeniden Evrene İşleme için beklemeli");

  const backupDb = new DatabaseSync(result.backup, { readOnly: true });
  try {
    assert.equal(Number(backupDb.prepare("SELECT COUNT(*) AS count FROM universe_workspace_nodes").get().count), 1);
    assert.equal(Number(backupDb.prepare("SELECT COUNT(*) AS count FROM source_ai_analyses").get().count), 1);
  } finally {
    backupDb.close();
  }
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Studio universe rebuild maintenance requires explicit confirmation, creates a backup and preserves curated source data");
