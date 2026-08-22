const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const visual = require("./visual-profiles.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-visual-"));
const db = new DatabaseSync(":memory:");
visual.ensureSchema(db, directory);

let profile = visual.save(db, {
  entityKey: "character:test",
  entityType: "character",
  source: "ai",
  description: "Uzun boylu bir varlık",
  attributes: ["Varlık türü: cin", "Boy: uzun"],
  atmosphere: "karanlık",
  prompt: "Karanlık ortamda uzun boylu bir varlık",
  negativePrompt: "yazı, filigran",
});
assert.equal(profile.entityKey, "character:test");
assert.deepEqual(profile.attributes, ["Varlık türü: cin", "Boy: uzun"]);
assert.equal(profile.imagePath, "");

const source = path.join(directory, "source.png");
fs.writeFileSync(source, Buffer.from("89504e470d0a1a0a", "hex"));
profile = visual.attachFile(db, directory, { entityKey: "character:test", entityType: "character", file: source });
assert.match(profile.imagePath, /visual-assets/);
assert.equal(profile.imageSource, "manual");
assert.equal(fs.existsSync(profile.imagePath), true);

const raw = db.prepare("SELECT image_path AS imagePath FROM entity_visual_profiles WHERE entity_key = ?").get("character:test");
assert.equal(path.isAbsolute(raw.imagePath), false, "Studio içindeki görseller taşınabilir göreli yol olarak saklanmalı");
assert.match(raw.imagePath, /^visual-assets\//);

const stored = visual.get(db, "character:test");
assert.equal(stored.prompt, "Karanlık ortamda uzun boylu bir varlık");
assert.match(stored.imageDataUrl, /^data:image\/png;base64,/);

const filename = path.basename(stored.imagePath);
db.prepare("UPDATE entity_visual_profiles SET image_path = ? WHERE entity_key = ?")
  .run(`/eski/bilgisayar/local-data/studio/visual-assets/${filename}`, "character:test");
const rebased = visual.get(db, "character:test");
assert.equal(rebased.imagePath, stored.imagePath, "Eski mutlak yollar yeni Studio veri kökündeki aynı görsele bağlanmalı");

const cleared = visual.clearImage(db, "character:test");
assert.equal(cleared.cleared, true);
assert.equal(cleared.profile.imagePath, "");
assert.equal(cleared.profile.prompt, "Karanlık ortamda uzun boylu bir varlık");

console.log("visual profile prompts and portable image assets ready");
