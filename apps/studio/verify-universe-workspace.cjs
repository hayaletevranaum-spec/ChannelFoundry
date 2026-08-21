const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const universeMerge = require("./universe-merge.cjs");
const workspace = require("./universe-workspace.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
universeMerge.ensureSchema(db);
workspace.ensureSchema(db);

function insertRun(id, universe) {
  const sourceIds = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.sourceVideoIds)) value.sourceVideoIds.forEach((videoId) => sourceIds.add(String(videoId)));
    Object.values(value).forEach(visit);
  };
  visit(universe);
  db.prepare(`
    INSERT INTO universe_merge_runs (id, state, model, analysis_count, source_signature, result_json, finished_at)
    VALUES (?, 'done', 'test-model', ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, sourceIds.size, [...sourceIds].sort().join("|"), JSON.stringify(universe));
}

const firstUniverse = {
  stories: [{
    name: "Babil Taşı ve Metafizik Sırlar",
    aliases: ["Babil Taşı"],
    summary: "İlk özet",
    sourceVideoIds: ["video-a"],
    sequence: [{ text: "Taş incelenir.", sourceVideoIds: ["video-a"] }],
    characterNames: ["65. Davetli"],
    locationNames: [],
    objectNames: ["Babil Taşı"],
    visual: {
      description: "Eski bir taş",
      attributes: ["işaretli yüzey"],
      atmosphere: "karanlık",
      prompt: "Birleştirilmiş evren kayıtlarına göre işaretli eski Babil Taşı",
      negativePrompt: "modern nesneler",
    },
  }],
  characters: [{
    name: "65. Davetli",
    aliases: [],
    summary: "Hikâyedeki karakter.",
    sourceVideoIds: ["video-a"],
    storyNames: ["Babil Taşı ve Metafizik Sırlar"],
    details: [{ text: "Taş hakkında bilgi verir.", sourceVideoIds: ["video-a"] }],
    visual: {},
    roles: ["Davetli"],
  }],
  events: [],
  locations: [],
  objects: [{
    name: "Babil Taşı",
    aliases: [],
    summary: "Hikâyenin nesnesi.",
    sourceVideoIds: ["video-a"],
    storyNames: ["Babil Taşı ve Metafizik Sırlar"],
    details: [],
    visual: {},
  }],
  relations: [{
    fromType: "story",
    fromName: "Babil Taşı ve Metafizik Sırlar",
    toType: "character",
    toName: "65. Davetli",
    label: "hikâyede yer alıyor",
    sourceVideoIds: ["video-a"],
  }],
};

insertRun(1, firstUniverse);
const first = workspace.applyRun(db, 1);
assert.equal(first.created, 3);
assert.equal(first.relationCreated, 1);
assert.equal(first.counts.stories, 1);
assert.equal(first.counts.characters, 1);
assert.equal(first.counts.objects, 1);
assert.equal(first.counts.relations, 1);
assert.equal(first.counts.draft, 3);
assert.equal(first.counts.approvedRelations, 0);

const nodes = workspace.listNodes(db);
assert.equal(nodes.length, 3);
const story = nodes.find((node) => node.kind === "story");
const character = nodes.find((node) => node.kind === "character");
const object = nodes.find((node) => node.kind === "object");
assert.ok(story && character && object);
assert.equal(story.summary, "İlk özet");
assert.equal(story.payload.sequence[0].text, "Taş incelenir.");
assert.equal(story.payload.visual.prompt, "Birleştirilmiş evren kayıtlarına göre işaretli eski Babil Taşı");

const storyApproval = workspace.setNodeState(db, { keys: [story.key], state: "approved" });
assert.equal(storyApproval.affected, 1);
assert.equal(storyApproval.counts.approved, 1);
assert.equal(storyApproval.counts.approvedRelations, 0, "Tek uç onaylıyken bağlantı public olmamalı");
assert.equal(workspace.publicEditorial(db).relations.length, 0);

const characterApproval = workspace.setNodeState(db, { keys: [character.key], state: "approved" });
assert.equal(characterApproval.counts.approved, 2);
assert.equal(characterApproval.counts.approvedRelations, 1, "İki uç onaylanınca bağlantı onaylanmalı");
assert.equal(workspace.listRelations(db, { state: "approved" }).length, 1);

const editedCharacter = workspace.updateNode(db, {
  key: character.key,
  name: "65. Davetli / Rehber",
  summary: "Kullanıcı tarafından düzenlenen karakter özeti.",
  aliases: ["65. Davetli", "Rehber"],
  roles: ["Davetli", "Bilgi aktarıcı"],
  storyNames: ["Babil Taşı ve Metafizik Sırlar"],
  state: "approved",
});
assert.equal(editedCharacter.name, "65. Davetli / Rehber");
assert.equal(editedCharacter.summary, "Kullanıcı tarafından düzenlenen karakter özeti.");
assert.deepEqual(editedCharacter.aliases, ["65. Davetli", "Rehber"]);
assert.deepEqual(editedCharacter.payload.roles, ["Davetli", "Bilgi aktarıcı"]);
assert.deepEqual(editedCharacter.sourceVideoIds, ["video-a"], "Kaynak izi editoryal düzenlemede korunmalı");

const editorial = workspace.publicEditorial(db);
assert.equal(editorial.nodes.length, 2);
assert.equal(editorial.counts.stories, 1);
assert.equal(editorial.counts.characters, 1);
assert.equal(editorial.counts.objects, 0, "Taslak nesne public pakete girmemeli");
assert.equal(editorial.relations.length, 1);
assert.equal(editorial.nodes.find((node) => node.kind === "story").visual.description, "Eski bir taş");
assert.equal(editorial.nodes.find((node) => node.kind === "character").name, "65. Davetli / Rehber");
assert.deepEqual(editorial.nodes.find((node) => node.kind === "character").roles, ["Davetli", "Bilgi aktarıcı"]);

const snapshot = { schemaVersion: 1, universe: { videos: [], characters: [], events: [], relations: [], files: [] } };
workspace.attachPublicSnapshot(db, snapshot);
assert.equal(snapshot.universe.editorial.nodes.length, 2);
assert.equal(snapshot.universe.editorial.relations.length, 1);
assert.deepEqual(snapshot.counts, { items: 2, relations: 1 }, "Public sayaçları onaylı editoryal içeriği kapsamalı");

workspace.setNodeState(db, { keys: [character.key], state: "draft" });
assert.equal(workspace.status(db).counts.approvedRelations, 0, "Uç taslağa çekilince ilişki de taslağa dönmeli");
workspace.setNodeState(db, { keys: [character.key], state: "approved" });

const secondUniverse = JSON.parse(JSON.stringify(firstUniverse));
secondUniverse.stories[0].summary = "AI tarafından daha sonra değiştirilmiş özet";
secondUniverse.characters[0].summary = "AI tarafından değiştirilmiş karakter özeti";
insertRun(2, secondUniverse);
const second = workspace.applyRun(db, 2);
assert.equal(second.approvedProtected, 2);
assert.equal(db.prepare("SELECT summary FROM universe_workspace_nodes WHERE key=?").get(story.key).summary, "İlk özet");
assert.equal(db.prepare("SELECT summary FROM universe_workspace_nodes WHERE key=?").get(character.key).summary, "Kullanıcı tarafından düzenlenen karakter özeti.");
assert.equal(second.counts.approved, 2);
assert.equal(second.counts.total, 3);

db.prepare(`
  INSERT INTO universe_merge_runs (id, state, model, analysis_count, source_signature, result_json, finished_at)
  VALUES (3, 'done', 'test-model', 2, 'video-a|video-b', ?, CURRENT_TIMESTAMP)
`).run(JSON.stringify(firstUniverse));
assert.throws(
  () => workspace.applyRun(db, 3),
  /Eksik Evrene İşleme sonucu çalışma alanına uygulanamaz: 1\/2/,
  "Kaynak kapsamı eksik eski çalışmalar editoryal alana alınmamalı",
);

db.prepare(`
  INSERT INTO universe_merge_runs (id, state, model, analysis_count, source_signature, error, finished_at)
  VALUES (4, 'error', 'test-model', 2, 'video-a|video-b', 'fetch failed', CURRENT_TIMESTAMP)
`).run();
assert.equal(
  universeMerge.latestResult(db)?.id,
  3,
  "Yeni çalışma hata verdiğinde son tamamlanan birleşim liste görünümünde kalmalı",
);

console.log("Universe workspace approval, editing, public filtering, relation gating and approved-record protection ready");
