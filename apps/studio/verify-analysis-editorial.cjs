const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const analysis = require("./ai-analysis.cjs");
const workspace = require("./universe-workspace-core.cjs");

const db = new DatabaseSync(":memory:");
analysis.ensureSchema(db);
workspace.ensureSchema(db);

const insertUniverseNode = db.prepare(`
  INSERT INTO universe_workspace_nodes (
    key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
  ) VALUES (?, 1, 'character', ?, '', ?, '[]', ?, 'approved')
`);
insertUniverseNode.run(
  "universe-character-existing",
  "Evren Muhatabı",
  JSON.stringify(["Eski Lakap"]),
  JSON.stringify({ roles: ["Tanık"], details: [{ text: "Bilinen ayrıntı", sourceVideoIds: ["older-video"] }] }),
);
insertUniverseNode.run(
  "universe-character-ambiguous-a",
  "Birinci Aday",
  JSON.stringify(["Ortak Lakap"]),
  JSON.stringify({ roles: [], details: [] }),
);
insertUniverseNode.run(
  "universe-character-ambiguous-b",
  "İkinci Aday",
  JSON.stringify(["Ortak Lakap"]),
  JSON.stringify({ roles: [], details: [] }),
);

db.prepare(`
  INSERT INTO source_ai_analyses (
    provider, external_id, model, title, summary, topics_json,
    story_beats_json, story_hints_json, cover_visual_json,
    characters_json, locations_json, objects_json, scenes_json,
    sponsors_json, contributors_json
  ) VALUES ('youtube', 'video-1', 'test-model', 'Test', 'Özet', '[]', ?, ?, '{}', ?, '[]', '[]', '[]', ?, ?)
`).run(
  JSON.stringify(["Önemli ayrıntı", "Bağlam ayrıntısı"]),
  JSON.stringify(["Ana hikâye"]),
  JSON.stringify([
    { name: "Evren Muhatabı", aliases: [], role: "Tanık", details: ["Yeni ayrıntı"], visual: {} },
    { name: "Eski Lakap", aliases: [], role: "", details: [], visual: {} },
    { name: "Yeni Muhatap", aliases: [], role: "Tanık", details: ["İlk kez anlatılıyor"], visual: {} },
    { name: "Ortak Lakap", aliases: [], role: "", details: [], visual: {} },
    { name: "Hariç Muhatap", aliases: [], role: "Önemsiz", details: [], visual: {} },
  ]),
  JSON.stringify(["Defter Sponsoru"]),
  JSON.stringify(["Katkı İsmi"]),
);

const pending = analysis.editorialPackage(db, "video-1");
assert.equal(pending.state, "pending");
const storyHint = pending.items.find((item) => item.category === "storyHint");
const existingCharacter = pending.items.find((item) => item.category === "character" && item.label === "Evren Muhatabı");
const aliasCharacter = pending.items.find((item) => item.category === "character" && item.label === "Eski Lakap");
const newCharacter = pending.items.find((item) => item.category === "character" && item.label === "Yeni Muhatap");
const ambiguousCharacter = pending.items.find((item) => item.category === "character" && item.label === "Ortak Lakap");
const excludedCharacter = pending.items.find((item) => item.category === "character" && item.label === "Hariç Muhatap");
const contextBeat = pending.items.find((item) => item.category === "storyBeat" && item.label === "Bağlam ayrıntısı");
const contributor = pending.items.find((item) => item.category === "contributor");
assert.ok(storyHint && existingCharacter && aliasCharacter && newCharacter && ambiguousCharacter && excludedCharacter && contextBeat && contributor);

assert.equal(storyHint.decision, "include");
assert.equal(existingCharacter.decision, "include");
assert.equal(existingCharacter.resolution.status, "existing");
assert.equal(existingCharacter.resolution.canonicalName, "Evren Muhatabı");
assert.equal(existingCharacter.resolution.needsReview, false);
assert.equal(aliasCharacter.decision, "context");
assert.equal(aliasCharacter.resolution.status, "existing");
assert.equal(aliasCharacter.resolution.matchedBy, "alias");
assert.equal(aliasCharacter.nameOverride, "Evren Muhatabı");
assert.equal(newCharacter.decision, "include");
assert.equal(newCharacter.resolution.status, "new");
assert.equal(ambiguousCharacter.decision, "context");
assert.equal(ambiguousCharacter.resolution.status, "ambiguous");
assert.equal(ambiguousCharacter.resolution.needsReview, true);
assert.deepEqual(ambiguousCharacter.resolution.candidates.map((item) => item.name).sort(), ["Birinci Aday", "İkinci Aday"]);
assert.equal(contextBeat.decision, "context");

const decisions = Object.fromEntries(pending.items.map((item) => [item.key, item.decision]));
decisions[excludedCharacter.key] = "exclude";
decisions[contextBeat.key] = "context";
decisions[contributor.key] = "exclude";
const nameOverrides = Object.fromEntries(pending.items.filter((item) => item.nameOverride).map((item) => [item.key, item.nameOverride]));
analysis.editorialSave(db, {
  videoId: "video-1",
  state: "curated",
  decisions,
  nameOverrides,
  manualSponsors: ["Manuel Defter İsmi"],
  manualContributors: ["Manuel Katkı"],
});

const curated = analysis.curatedResult(db, "video-1");
assert.ok(curated);
assert.equal(curated.characters.some((item) => item.name === "Evren Muhatabı"), true);
assert.equal(curated.characters.some((item) => item.name === "Yeni Muhatap"), true);
assert.equal(curated.characters.some((item) => item.name === "Hariç Muhatap"), false);
assert.equal(curated.storyBeats.includes("Bağlam ayrıntısı"), false);
assert.equal(curated.context.storyBeats.includes("Bağlam ayrıntısı"), true);
assert.equal(curated.context.characters.some((item) => item.name === "Evren Muhatabı"), true);
assert.equal(curated.sponsors.includes("Defter Sponsoru"), true);
assert.equal(curated.sponsors.includes("Manuel Defter İsmi"), true);
assert.deepEqual(curated.contributors, ["Manuel Katkı"]);
assert.equal(analysis.stats(db).curated, 1);
assert.deepEqual(analysis.stats(db), { transcripts: 0, analyzed: 0, waiting: 0, running: 0, errors: 0 });

analysis.editorialSave(db, {
  videoId: "video-1",
  state: "excluded",
  decisions,
  nameOverrides,
  manualSponsors: ["Manuel Defter İsmi"],
  manualContributors: ["Manuel Katkı"],
});
assert.equal(analysis.curatedResult(db, "video-1"), null);
const support = analysis.supportRecords(db);
assert.equal(support.some((row) => row.kind === "sponsor" && row.name === "Defter Sponsoru"), true);
assert.equal(support.some((row) => row.kind === "sponsor" && row.name === "Manuel Defter İsmi"), true);
assert.equal(support.some((row) => row.kind === "contributor" && row.name === "Manuel Katkı"), true);

const workbench = fs.readFileSync(path.join(__dirname, "src", "AnalysisCurationWorkbench.tsx"), "utf8");
assert.match(workbench, /type SortMode = "date-desc" \| "date-asc" \| "title-asc" \| "title-desc"/, "02 · Ayıklama tarih ve ad sıralamasını korumalı");
assert.match(workbench, /Tarih · Yeni → Eski/, "02 · Ayıklama yeni → eski sıralamasını göstermeli");
assert.match(workbench, /Tarih · Eski → Yeni/, "02 · Ayıklama eski → yeni sıralamasını göstermeli");
assert.match(workbench, /Ad · A → Z/, "02 · Ayıklama alfabetik sıralamayı göstermeli");
assert.match(workbench, /Mevcut kayda katkı/, "02 · Ayıklama mevcut Evren kaydına katkıyı görünür kılmalı");
assert.match(workbench, /kontrol bekliyor|kontrol gerekenleri/, "02 · Ayıklama yalnız belirsiz eşleşmeleri insan kararına bırakmalı");

db.close();
console.log("analysis editorial entity resolution, sorting, selective curation and support separation ready");
