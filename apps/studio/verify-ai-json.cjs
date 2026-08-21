const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const aiJson = require("./ai-json.cjs");

const direct = aiJson.parseLoose('{"ok":true,"value":1}');
assert.equal(direct.value.ok, true);

const fenced = aiJson.parseLoose('```json\n{"ok":true,"items":[1,2]}\n```');
assert.deepEqual(fenced.value.items, [1, 2]);

const prose = aiJson.parseLoose('İşte sonuç:\n```json\n{"story":"Babil","summary":"metin"}\n```\nBitti.');
assert.equal(prose.value.story, "Babil");

const bracesInString = aiJson.parseLoose('Ön bilgi {geçersiz} sonra {"text":"Taşın üzerinde {işaret} var","nested":{"ok":true}} sonuç.');
assert.equal(bracesInString.value.nested.ok, true);
assert.equal(bracesInString.value.text, "Taşın üzerinde {işaret} var");

const missingArrayItemCloser = aiJson.repairStructure('{"locations":[{"name":"Babil","visual":{"prompt":"x"}],"objects":[]}');
assert.deepEqual(JSON.parse(missingArrayItemCloser), {
  locations: [{ name: "Babil", visual: { prompt: "x" } }],
  objects: [],
});

const duplicateRootCloser = aiJson.repairStructure('{"scenes":[{"name":"Sahne","visual":{"prompt":"x"}]}' + "\n}");
assert.equal(JSON.parse(duplicateRootCloser).scenes[0].name, "Sahne");

const duplicatedNestedClosers = aiJson.repairStructure('{"scenes":[{"name":"Sahne","visual":{"prompt":"x"}}]}],"storyHints":["İpucu"]}');
assert.equal(JSON.parse(duplicatedNestedClosers).storyHints[0], "İpucu");

const strayPropertyDot = aiJson.repairStructure('{"visual":{"attributes":["ışık"],. "atmosphere":"loş"}}');
assert.equal(JSON.parse(strayPropertyDot).visual.atmosphere, "loş");

const dotInsteadOfPropertyQuote = aiJson.repairStructure('{"visual":{"attributes":["ışık"],.atmosphere":"gergin"}}');
assert.equal(JSON.parse(dotInsteadOfPropertyQuote).visual.atmosphere, "gergin");

const unsafeTruncation = aiJson.repairStructure('{"locations":[{"name":"Babil"}],"objects":[]} "scenes":[{"name":"Kaybolmamalı"}]}');
assert.equal(unsafeTruncation, "");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-ai-json-"));
let repairs = 0;

(async () => {
  const recovered = await aiJson.parseWithRepair(directory, '{"stories":[{"name":"Babil"}', {
    label: "verify-repair",
    repair: async () => {
      repairs += 1;
      return '{"stories":[{"name":"Babil"}],"characters":[]}';
    },
  });
  assert.equal(repairs, 0);
  assert.equal(recovered.repaired, true);
  assert.equal(recovered.locallyRepaired, true);
  assert.equal(recovered.value.stories[0].name, "Babil");
  assert.equal(Boolean(recovered.debugFile), true);
  assert.equal(fs.existsSync(recovered.debugFile), true);
  assert.equal(JSON.parse(fs.readFileSync(recovered.debugFile, "utf8")).outcome, "repaired-locally");

  const recoveredAfterAi = await aiJson.parseWithRepair(directory, '{"scenes":[{"name":"Kesik', {
    label: "verify-ai-then-local-repair",
    repair: async () => {
      repairs += 1;
      return '{"scenes":[{"name":"Sahne","visual":{"prompt":"x"}]}' + "\n}";
    },
  });
  assert.equal(repairs, 1);
  assert.equal(recoveredAfterAi.value.scenes[0].name, "Sahne");
  assert.equal(recoveredAfterAi.locallyRepaired, true);
  assert.equal(JSON.parse(fs.readFileSync(recoveredAfterAi.debugFile, "utf8")).outcome, "repaired-locally-after-ai");

  await assert.rejects(
    () => aiJson.parseWithRepair(directory, "not json", {
      label: "verify-failed-repair",
      repair: async () => "still not json",
    }),
    /otomatik onarım da başarısız oldu/,
  );

  console.log("AI JSON tolerant parsing, repair and debug contracts ready");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
