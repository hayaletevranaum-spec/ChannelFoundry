const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const workspace = require("./universe-workspace.cjs");
const narrativeService = require("./narrative-service.cjs");
const generation = require("./narrative-ai-generation.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-narrative-ai-"));
  const databasePath = path.join(root, "channel-foundry-studio.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    workspace.ensureSchema(db);
    db.prepare(`
      INSERT INTO universe_workspace_nodes (
        key, run_id, kind, name, summary, aliases_json, source_video_ids_json, payload_json, state
      ) VALUES ('story-ai', 1, 'story', 'Kayıtlı Hikâye', 'Yalnız onaylı gerçek.', '[]', '["video-ai"]', '{}', 'approved')
    `).run();

    const prepared = narrativeService.prepare(db);
    assert.equal(prepared.run.state, "prepared");
    assert.equal(generation.userDataPathFromDb(db), root);

    const validResponse = {
      contractVersion: 1,
      sections: [{
        order: 0,
        title: "Onaylı kaydın anlatısı",
        sourceKeys: ["story-ai"],
        blocks: [{
          type: "paragraph",
          spans: [
            { type: "text", text: "Kayda göre " },
            { type: "reference", entityId: "story-ai", label: "Kayıtlı Hikâye" },
            { type: "text", text: " anlatının parçasıdır." },
          ],
        }],
        media: [],
        retire: false,
      }],
    };

    let calls = 0;
    const fakeChat = async (_userDataPath, messages, options) => {
      calls += 1;
      assert.equal(options.json, true);
      assert.ok(options.outputSchema, "Hikâyeleştir provider isteği structured output schema taşımalı");
      if (calls === 1) {
        assert.match(messages[0].content, /Yalnız verilen frozen request/i);
        assert.match(messages[0].content, /Görsel Tamamlama ayrı bir aşamadır/i);
        assert.match(messages[0].content, /Fiziksel sayfa/i);
        assert.match(messages[1].content, /story-ai/);
        return { content: "bozuk-json", model: "fixture-primary-model", fallbackUsed: false };
      }
      assert.match(messages[0].content, /JSON onarım aracısısın/i);
      assert.match(messages[0].content, /Yeni olay, cümle, referans/i);
      assert.match(messages[0].content, /figure, media içeriği veya assetId ekleme/i);
      return { content: JSON.stringify(validResponse), model: "fixture-repair-model", fallbackUsed: false };
    };
    const fakeConfig = () => ({ provider: "openai-compatible", model: "configured-model" });

    const generated = await generation.generateDraft(root, db, { runId: prepared.run.id }, {
      chat: fakeChat,
      getConfig: fakeConfig,
    });
    assert.equal(calls, 2, "Bozuk JSON yalnız bir kontrollü onarım çağrısı yapmalı");
    assert.equal(generated.run.state, "prepared", "AI üretimi editoryal apply yapmamalı");
    assert.equal(generated.run.model, "fixture-primary-model", "Narrative run asıl içerik modelini saklamalı");
    assert.equal(generated.generation.provider, "openai-compatible");
    assert.equal(generated.generation.repaired, true);
    assert.equal(generated.generation.repairModel, "fixture-repair-model");
    assert.equal(generated.drafts.length, 1);
    assert.equal(generated.drafts[0].state, "draft");
    assert.equal(generated.drafts[0].entityReferences[0].entityId, "story-ai");
    assert.equal(narrativeService.status(db).counts.applied, 0, "AI taslağı kullanıcı onayı olmadan applied olmamalı");

    await assert.rejects(
      () => generation.generateDraft(root, db, { runId: prepared.run.id }, {
        getConfig: fakeConfig,
        chat: async () => ({
          content: JSON.stringify({ ...validResponse, page: 3 }),
          model: "malicious-layout-model",
          fallbackUsed: false,
        }),
      }),
      /sayfa|spread/i,
    );
    let afterRejected = narrativeService.getRun(db, prepared.run.id);
    assert.equal(afterRejected.run.model, "fixture-primary-model", "Reddedilen layout yanıtı model provenance'ını değiştirmemeli");
    assert.equal(afterRejected.drafts.length, 1, "Reddedilen layout yanıtı mevcut geçerli taslağı bozmamalı");

    const visualResponse = {
      ...validResponse,
      sections: [{
        ...validResponse.sections[0],
        blocks: [
          ...validResponse.sections[0].blocks,
          { type: "figure", assetId: "invented-asset", role: "scene", alt: "", caption: "" },
        ],
        media: [{ assetId: "invented-asset", role: "scene", alt: "", caption: "" }],
      }],
    };
    await assert.rejects(
      () => generation.generateDraft(root, db, { runId: prepared.run.id }, {
        getConfig: fakeConfig,
        chat: async () => ({
          content: JSON.stringify(visualResponse),
          model: "premature-visual-model",
          fallbackUsed: false,
        }),
      }),
      /Görsel Tamamlama|figure|assetId|medya/i,
    );
    afterRejected = narrativeService.getRun(db, prepared.run.id);
    assert.equal(afterRejected.run.model, "fixture-primary-model", "Erken görsel yanıtı model provenance'ını değiştirmemeli");
    assert.equal(afterRejected.drafts.length, 1, "Erken görsel yanıtı mevcut taslağı bozmamalı");

    await assert.rejects(
      () => generation.generateDraft(root, db, { runId: prepared.run.id }, {
        getConfig: fakeConfig,
        chat: async () => {
          workspace.updateNode(db, { key: "story-ai", summary: "AI çağrısı sürerken approved Evren değişti." });
          return {
            content: JSON.stringify(validResponse),
            model: "stale-race-model",
            fallbackUsed: false,
          };
        },
      }),
      /stale|Evren değişti/i,
    );
    const stale = narrativeService.getRun(db, prepared.run.id);
    assert.equal(stale.run.state, "stale", "AI çağrısı sırasında Evren değişirse frozen run stale olmalı");
    assert.equal(stale.run.model, "fixture-primary-model", "Stale sonuç model provenance'ını değiştirmemeli");
    assert.equal(stale.drafts.length, 1, "Stale sonuç son geçerli taslağın üzerine yazmamalı");
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Narrative AI generation stays factual, text-only before visual completion, stale-safe and editorially unapplied while recording provider provenance");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
