const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { mergePayload, privateConfig, _test } = require("./universe-merge-ai.cjs");
const mergeStore = require("./universe-merge-store.cjs");
const analysisSchema = require("./ai-analysis-schema.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-universe-merge-"));
fs.writeFileSync(path.join(directory, "ai-config.json"), JSON.stringify({
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434/v1",
  model: "test-model",
  timeoutSeconds: 60,
}));

const videos = [
  {
    videoId: "video-a",
    title: "Birinci Hikâye",
    summary: "Ömer birinci olayı araştırır.",
    storyBeats: ["Ömer eve girer."],
    characters: [{ name: "Ömer", aliases: ["Ömer Abi"], role: "Araştırmacı", details: [] }],
    locations: [],
    objects: [],
    scenes: [],
  },
  {
    videoId: "video-b",
    title: "İkinci Hikâye",
    summary: "Ömer ikinci olayı araştırır.",
    storyBeats: ["Ömer ormana gider."],
    characters: [{ name: "Ömer", aliases: ["Ömer Abi"], role: "Araştırmacı", details: [] }],
    locations: [],
    objects: [],
    scenes: [],
  },
];

const originalFetch = global.fetch;
const requests = [];
let truncatedStoryAttempts = 0;

function videoIds(input) {
  return (Array.isArray(input?.videos) ? input.videos : []).map((video) => String(video.videoId));
}

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body);
  requests.push(body);
  const system = String(body.messages?.[0]?.content ?? "");
  const target = system.match(/HEDEF DİZİ: ([a-z]+)/)?.[1] ?? "";
  const input = JSON.parse(body.messages?.at(-1)?.content ?? "{}");
  const ids = videoIds(input);
  if (target === "stories" && ids.length > 1 && body.model !== "fallback-model") {
    truncatedStoryAttempts += 1;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: '{"items":[{"name":"Kesilmiş' } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let items = [];
  if (target === "stories") {
    items = ids.map((id) => ({
      name: id === "video-a" ? "Birinci Hikâye" : "İkinci Hikâye",
      aliases: [],
      summary: "Kısa özet.",
      sourceVideoIds: [id],
      sequence: [],
      characterNames: ["Ömer"],
      locationNames: [],
      objectNames: [],
      visual: {},
    }));
  } else if (target === "characters") {
    items = [{
      name: "Ömer",
      aliases: ["Ömer Abi"],
      summary: "Araştırmacı.",
      roles: ["Araştırmacı"],
      details: [],
      storyNames: ["Birinci Hikâye", "İkinci Hikâye"],
      sourceVideoIds: ids,
      visual: {},
    }];
  } else if (target === "events") {
    items = ids.map((id) => ({
      name: id === "video-a" ? "Eve giriş" : "Ormana gidiş",
      summary: "Olay.",
      sourceVideoIds: [id],
      storyNames: [id === "video-a" ? "Birinci Hikâye" : "İkinci Hikâye"],
      characterNames: ["Ömer"],
      locationNames: [],
      visual: {},
    }));
  }
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ items }) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

(async () => {
  try {
    const result = await mergePayload(directory, { videos }, 0);
    assert.equal(truncatedStoryAttempts, 1, "Kesilmiş toplu yanıt görülmeli");
    assert.equal(result.fallbackUsed, true, "Kesilme sonrasında küçük parçalara düşülmeli");
    assert.equal(result.repairedJson, false, "Token kesilmesi JSON onarımıyla başarılı sayılmamalı");
    assert.deepEqual(result.universe.stories.map((story) => story.name), ["Birinci Hikâye", "İkinci Hikâye"]);
    assert.deepEqual([...new Set(result.universe.stories.flatMap((story) => story.sourceVideoIds))].sort(), ["video-a", "video-b"]);
    assert.equal(result.universe.characters.length, 1);
    assert.deepEqual(result.universe.characters[0].sourceVideoIds.sort(), ["video-a", "video-b"]);
    assert.equal(result.universe.events.length, 2);
    assert.equal(result.universe.relations.filter((relation) => relation.toName === "Ömer").length >= 2, true);
    assert.equal(requests.every((request) => request.max_tokens === 12000), true);
    assert.equal(fs.readdirSync(path.join(directory, "ai-debug")).some((file) => file.includes("universe-stories")), true);

    fs.writeFileSync(path.join(directory, "ai-config.json"), JSON.stringify({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "test-model",
      fallbackModel: "fallback-model",
      timeoutSeconds: 60,
    }));
    const modelFallbackResult = await mergePayload(directory, { videos }, 0);
    assert.equal(modelFallbackResult.modelFallbackUsed, true, "MAX_TOKENS sonrasında seçili yedek model kullanılmalı");
    assert.equal(modelFallbackResult.fallbackUsed, false, "Yedek model başarılıysa girdiyi daha küçük parçalara bölmeye gerek kalmamalı");
    assert.equal(requests.some((request) => request.model === "fallback-model"), true);

    assert.throws(
      () => _test.validateKindCoverage("stories", [{ name: "Eksik", sourceVideoIds: ["video-a"] }], new Set(["video-a", "video-b"])),
      (error) => error?.code === "UNIVERSE_COVERAGE_MISSING" && /video-b/.test(error.message),
    );
    assert.equal(_test.looksTruncated({ finishReason: "MAX_TOKENS", content: "{}" }), true);
    assert.equal(_test.looksTruncated({ finishReason: "stop", content: '{"items":[]}' }), false);

    fs.writeFileSync(path.join(directory, "ai-config.json"), JSON.stringify({
      provider: "codex-cli",
      endpoint: "",
      model: "",
      timeoutSeconds: 60,
    }));
    const codexMergeConfig = privateConfig(directory);
    assert.equal(codexMergeConfig.provider, "codex-cli");
    assert.equal(codexMergeConfig.endpoint, "");
    assert.equal(codexMergeConfig.model, "");
    assert.equal(codexMergeConfig.displayModel, "Codex CLI · varsayılan");
    fs.writeFileSync(path.join(directory, "ai-config.json"), JSON.stringify({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "test-model",
      timeoutSeconds: 60,
    }));

    global.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
    const controller = new AbortController();
    const canceledMerge = mergePayload(directory, { videos: [videos[0]] }, 0, { signal: controller.signal });
    controller.abort();
    await assert.rejects(canceledMerge, (error) => error?.code === "AI_REQUEST_CANCELED");

    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    analysisSchema.ensureSchema(db);
    mergeStore.ensureSchema(db);
    db.prepare(`
      INSERT INTO universe_merge_runs (id, state, model, analysis_count, source_signature)
      VALUES (1, 'running', 'test-model', 2, 'video-a|video-b')
    `).run();
    db.prepare(`
      INSERT INTO universe_merge_chunks (run_id, level, batch_index, state, input_json, output_json)
      VALUES (1, 0, 0, 'done', '{}', ?)
    `).run(JSON.stringify({ universe: {
      stories: [result.universe.stories[0]],
      characters: [],
      events: [],
      locations: [],
      objects: [],
      relations: [],
    } }));
    const rejected = mergeStore.advance(db, 1);
    assert.equal(rejected.run.state, "error");
    assert.match(rejected.run.error, /1\/2 kaynak video korundu/);

    db.prepare(`
      INSERT INTO universe_merge_runs (id, state, model, analysis_count, source_signature)
      VALUES (2, 'waiting', 'test-model', 2, 'video-a|video-b')
    `).run();
    db.prepare(`
      INSERT INTO universe_merge_chunks (run_id, level, batch_index, state, input_json)
      VALUES (2, 0, 0, 'waiting', '{}')
    `).run();
    assert.deepEqual(mergeStore.cancelActive(db), { canceled: 1, runId: 2 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_runs WHERE id=2").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_chunks WHERE run_id=2").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_runs WHERE id=1").get().count, 1);
    db.close();

    console.log("Universe merge kind isolation, truncation fallback, cancellation, source coverage and deterministic relations ready");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  global.fetch = originalFetch;
  fs.rmSync(directory, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
