const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ai = require("./ai-service.cjs");
const aiClient = require("./ai-client.cjs");
const aiCli = require("./ai-cli.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-ai-"));

assert.throws(() => ai.normalizeEndpoint("http://example.com/v1", "ollama"), /localhost/);
assert.equal(ai.normalizeEndpoint("http://127.0.0.1:11434/v1/", "ollama"), "http://127.0.0.1:11434/v1");
assert.equal(ai.normalizeTimeoutSeconds(12), 30);
assert.equal(ai.normalizeTimeoutSeconds(9999), 1800);

const googleQuickstart = ai.parseGoogleAiStudioQuickstart(`curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \\
  -H 'Content-Type: application/json' \\
  -H 'X-goog-api-key: test-google-key' \\
  -X POST \\
  -d '{"contents":[]}'`);
assert.deepEqual(googleQuickstart, {
  endpoint: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-flash-latest",
  apiKey: "test-google-key",
});
assert.throws(
  () => ai.parseGoogleAiStudioQuickstart("curl https://example.com/v1/models/test:generateContent"),
  /Google Generative Language adresi bulunamadı/,
);

const saved = ai.saveConfig(directory, {
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434/v1",
  model: "test-model",
  timeoutSeconds: 690,
  imageMode: "enabled",
  imageEndpoint: "http://127.0.0.1:11434/v1",
  imageModel: "test-image-model",
});
assert.equal(saved.configured, true);
assert.equal(saved.apiKeyConfigured, false);
assert.equal(saved.timeoutSeconds, 690);
assert.equal(saved.image.mode, "enabled");
assert.equal(saved.image.provider, "openai-compatible");
assert.equal(saved.image.model, "test-image-model");
assert.equal(ai.getConfig(directory).model, "test-model");

const originalFetch = global.fetch;
const requests = [];
let transientConnectivityFailures = 2;
let geminiFallbackScenario = false;
const analysisPayload = {
  title: "Onarılan Video Başlığı",
  summary: "Kesilmiş model yanıtından güvenle kurtarılan özet.",
  topics: ["gece"],
  storyBeats: ["Anlatı başladı."],
  storyHints: [],
  coverVisual: { description: "", attributes: [], atmosphere: "", prompt: "", negativePrompt: "" },
  characters: [],
  locations: [],
  objects: [],
  scenes: [
    {
      name: "Onarılan Sahne",
      description: "Yapısal kapanış hatasından kurtarılan sahne.",
      visual: { description: "", attributes: [], atmosphere: "", prompt: "", negativePrompt: "" },
    },
  ],
};
const malformedAnalysisRepair = JSON.stringify(analysisPayload).replace(/}}]}$/, "}]}\n}");
const suggestionPayload = {
  title: "Düzenlenmiş Başlık",
  summary: "Yalnız verilen bilgilerden hazırlanmış kısa özet.",
  relations: [
    { key: "event:e1", label: "olaya bağlanıyor", reason: "Aynı bağlam." },
    { key: "unknown:x", label: "uydurma", reason: "Atılmalı." },
  ],
};
global.fetch = async (url, options = {}) => {
  let body = null;
  try { body = options.body ? JSON.parse(options.body) : null; } catch {}
  requests.push({ url: String(url), body, method: options.method || "GET", headers: options.headers || {} });
  if (String(url).includes("/ai/models/search")) {
    return new Response(JSON.stringify({
      success: true,
      result: [
        { name: "@cf/black-forest-labs/flux-1-schnell", description: "FLUX.1 Schnell" },
        { name: "@cf/black-forest-labs/flux-2-klein-4b", description: "FLUX.2 Klein" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).includes("/ai/run/@cf/")) {
    return new Response(JSON.stringify({ success: true, result: { image: Buffer.from("cloudflare-image").toString("base64") } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (String(url) === "https://generativelanguage.googleapis.com/v1beta/models") {
    return new Response(JSON.stringify({
      models: [
        { name: "models/gemini-flash-latest", displayName: "Gemini Flash Latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).includes("generativelanguage.googleapis.com/v1beta/models/") && String(url).includes(":generateContent")) {
    const model = decodeURIComponent(String(url).match(/\/models\/([^/:]+):generateContent/)?.[1] ?? "");
    if (geminiFallbackScenario && model === "gemini-primary-max") {
      return new Response(JSON.stringify({
        candidates: [{ finishReason: "MAX_TOKENS" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      modelVersion: model === "gemini-flash-latest" ? "gemini-2.5-flash-001" : model,
      candidates: [{ content: { role: "model", parts: [{ text: geminiFallbackScenario && model === "gemini-fallback-ok" ? "FALLBACK OK" : "OK" }] }, finishReason: "STOP" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).endsWith("/models")) {
    return new Response(JSON.stringify({
      data: [
        { id: "text-model", owned_by: "test" },
        { id: "image-model", owned_by: "test", capabilities: { image_generation: true } },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).endsWith("/images/generations")) {
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated-image").toString("base64") }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const requestText = String(options.body || "");
  const isConnectivity = requestText.includes("connectivity test");
  const isAnalysis = requestText.includes("kanalın anlatı arşivini yapılandıran");
  const isRepair = requestText.includes("JSON onarım aracısın");
  const isPersistentNetworkFailure = requestText.includes("persistent network failure test");
  const isCertificateFailure = requestText.includes("certificate failure test");
  const isHttpFailure = requestText.includes("http failure test");
  if (isConnectivity && transientConnectivityFailures > 0) {
    transientConnectivityFailures -= 1;
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("socket disconnected before response"), { code: "ECONNRESET" });
    throw error;
  }
  if (isPersistentNetworkFailure) {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("temporary DNS lookup failure"), { code: "EAI_AGAIN" });
    throw error;
  }
  if (isCertificateFailure) {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    throw error;
  }
  if (isHttpFailure) {
    return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  const content = isConnectivity
    ? "OK"
    : isRepair
      ? malformedAnalysisRepair
      : isAnalysis
        ? '{"title":"Onarılan Video Başlığı","summary":"Token sınırında yarım kalan'
        : `Model yanıtı:\n\`\`\`json\n${JSON.stringify(suggestionPayload)}\n\`\`\`\n`;
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

(async () => {
  try {
    const test = await ai.testConnection(directory, { retryDelaysMs: [0, 0] });
    assert.equal(test.ok, true);
    assert.equal(test.reply, "OK");
    assert.equal(requests.filter((request) => JSON.stringify(request.body).includes("connectivity test")).length, 3);

    const networkRequestCount = requests.length;
    await assert.rejects(
      () => aiClient.chat(directory, [{ role: "user", content: "persistent network failure test" }], { retryDelaysMs: [0, 0] }),
      (error) => error?.code === "AI_NETWORK_FAILED"
        && /3 denemeden sonra/.test(error.message)
        && /EAI_AGAIN/.test(error.message),
    );
    assert.equal(requests.length, networkRequestCount + 3);

    const certificateRequestCount = requests.length;
    await assert.rejects(
      () => aiClient.chat(directory, [{ role: "user", content: "certificate failure test" }], { retryDelaysMs: [0, 0] }),
      (error) => error?.code === "AI_NETWORK_FAILED"
        && /1 denemeden sonra/.test(error.message)
        && /CERT_HAS_EXPIRED/.test(error.message),
    );
    assert.equal(requests.length, certificateRequestCount + 1);

    const httpRequestCount = requests.length;
    await assert.rejects(
      () => aiClient.chat(directory, [{ role: "user", content: "http failure test" }], { retryDelaysMs: [0, 0] }),
      /AI isteği başarısız: quota exceeded/,
    );
    assert.equal(requests.length, httpRequestCount + 1);

    const catalog = await ai.listModels(directory);
    assert.equal(catalog.models.length, 2);
    assert.equal(catalog.textModels.includes("text-model"), true);
    assert.equal(catalog.imageModels.includes("image-model"), true);

    const unsavedTextCatalog = await ai.listModels(directory, {
      provider: "openai-compatible",
      endpoint: "https://unsaved-model-list.example/v1",
      apiKey: "unsaved-text-key",
      timeoutSeconds: 30,
    });
    assert.equal(unsavedTextCatalog.textModels.includes("text-model"), true);
    const unsavedTextCatalogRequest = requests.at(-1);
    assert.equal(unsavedTextCatalogRequest.url, "https://unsaved-model-list.example/v1/models");
    assert.equal(unsavedTextCatalogRequest.headers.Authorization, "Bearer unsaved-text-key");

    const capability = await ai.detectImageCapability(directory);
    assert.equal(capability.supported, true);
    assert.equal(capability.mode, "enabled");

    const analysis = await ai.analyzeTranscript(directory, {
      videoId: "video-json-repair",
      title: "Ham video başlığı",
      publishedAt: "2026-08-12",
      language: "tr",
      transcript: "Bu, video çözümleme onarım akışını doğrulayan örnek transkripttir.",
    });
    assert.equal(analysis.title, analysisPayload.title);
    assert.equal(analysis.summary, analysisPayload.summary);
    assert.deepEqual(analysis.topics, analysisPayload.topics);
    assert.equal(analysis.scenes[0].name, analysisPayload.scenes[0].name);
    const debugFiles = fs.readdirSync(path.join(directory, "ai-debug"));
    const analysisDebugFile = debugFiles.find((file) => file.includes("video-analysis-video-json-repair"));
    assert.equal(Boolean(analysisDebugFile), true);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, "ai-debug", analysisDebugFile), "utf8")).outcome,
      "repaired-locally-after-ai",
    );
    assert.equal(requests.some((request) => request.body?.max_tokens === 6500), true);
    assert.equal(requests.some((request) => request.body?.max_tokens === 7000), true);

    const suggestion = await ai.suggestContent(directory, {
      selected: { key: "video:v1", kind: "video", title: "Başlık", meta: "2026", summary: "Ham özet" },
      related: [],
      candidates: [
        { key: "event:e1", kind: "event", title: "Olay", meta: "2026", summary: "Aynı bağlam" },
        { key: "character:c1", kind: "character", title: "Tanık", meta: "Tanık", summary: "Başka kayıt" },
      ],
    });
    assert.equal(suggestion.title, "Düzenlenmiş Başlık");
    assert.equal(suggestion.relations.length, 1);
    assert.equal(suggestion.relations[0].key, "event:e1");

    const generated = await ai.generateImage(directory, {
      entityKey: "character:test",
      prompt: "Karanlık ortamda bir karakter",
      negativePrompt: "yazı",
    });
    assert.equal(generated.model, "test-image-model");
    assert.equal(fs.existsSync(generated.file), true);
    assert.equal(requests.some((request) => request.url.endsWith("/models")), true);
    assert.equal(requests.some((request) => request.url.endsWith("/images/generations") && request.body.model === "test-image-model"), true);
    assert.equal(requests.some((request) => request.url.endsWith("/chat/completions") && request.body.response_format?.type === "json_object"), true);

    const cloudflareConfig = ai.saveConfig(directory, {
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "test-model",
      imageMode: "enabled",
      imageProvider: "cloudflare-workers-ai",
      imageEndpoint: "https://api.cloudflare.com/client/v4/accounts/abc123/ai",
      imageModel: "@cf/black-forest-labs/flux-1-schnell",
      imageApiKey: "cloudflare-token",
    });
    assert.equal(cloudflareConfig.image.provider, "cloudflare-workers-ai");
    const cloudflareCatalog = await ai.listImageModels(directory);
    assert.equal(cloudflareCatalog.imageModels.length, 2);
    assert.equal(cloudflareCatalog.imageModels.includes("@cf/black-forest-labs/flux-1-schnell"), true);
    const unsavedImageCatalog = await ai.listImageModels(directory, {
      provider: "openai-compatible",
      endpoint: "https://unsaved-image-list.example/v1",
      apiKey: "unsaved-text-key",
      imageProvider: "cloudflare-workers-ai",
      imageEndpoint: "https://api.cloudflare.com/client/v4/accounts/unsaved/ai",
      imageApiKey: "unsaved-image-key",
      timeoutSeconds: 30,
    });
    assert.equal(unsavedImageCatalog.imageModels.includes("@cf/black-forest-labs/flux-1-schnell"), true);
    const unsavedImageCatalogRequest = requests.at(-1);
    assert.equal(unsavedImageCatalogRequest.url.includes("/accounts/unsaved/ai/models/search"), true);
    assert.equal(unsavedImageCatalogRequest.headers.Authorization, "Bearer unsaved-image-key");
    const cloudflareGenerated = await ai.generateImage(directory, {
      entityKey: "character:cloudflare-test",
      prompt: "Sis içinde bir arşiv odası",
    });
    assert.equal(cloudflareGenerated.provider, "cloudflare-workers-ai");
    assert.equal(fs.existsSync(cloudflareGenerated.file), true);
    assert.equal(requests.some((request) => request.url.includes("/ai/run/@cf/black-forest-labs/flux-1-schnell") && request.body.steps === 4), true);

    const disk = JSON.parse(fs.readFileSync(path.join(directory, "ai-config.json"), "utf8"));
    assert.equal(disk.model, "test-model");
    assert.equal(disk.timeoutSeconds, 690);
    assert.equal(disk.imageModel, "@cf/black-forest-labs/flux-1-schnell");
    assert.equal(disk.imageProvider, "cloudflare-workers-ai");

    ai.saveConfig(directory, {
      provider: "openai-compatible",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-flash-latest",
      apiKey: "gemini-test-key",
      imageMode: "disabled",
      imageModel: "",
    });
    const geminiTest = await ai.testConnection(directory);
    assert.equal(geminiTest.reply, "OK");
    const geminiMeta = await aiClient.chat(directory, [{ role: "user", content: "Gerçek model sürümünü döndür." }], { returnMeta: true });
    assert.equal(geminiMeta.model, "gemini-2.5-flash-001");
    const geminiCatalog = await ai.listModels(directory);
    assert.equal(geminiCatalog.textModels.includes("gemini-flash-latest"), true);
    const geminiRequest = requests.find((request) => request.url.includes("/models/gemini-flash-latest:generateContent"));
    assert.equal(geminiRequest?.headers?.["x-goog-api-key"], "gemini-test-key");
    assert.equal(geminiRequest?.body?.systemInstruction?.parts?.[0]?.text.includes("connectivity test"), true);

    geminiFallbackScenario = true;
    ai.saveConfig(directory, {
      provider: "openai-compatible",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-flash-latest",
      fallbackModel: "gemini-fallback-ok",
      apiKey: "gemini-test-key",
      imageMode: "disabled",
      imageModel: "",
    });
    const fallbackConnectionTest = await ai.testConnection(directory);
    assert.equal(fallbackConnectionTest.reply, "OK");
    assert.deepEqual(fallbackConnectionTest.fallback, { model: "gemini-fallback-ok", reply: "FALLBACK OK" });

    ai.saveConfig(directory, {
      provider: "openai-compatible",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-primary-max",
      fallbackModel: "gemini-fallback-ok",
      apiKey: "gemini-test-key",
      imageMode: "disabled",
      imageModel: "",
    });
    const fallbackReply = await aiClient.chat(directory, [{ role: "user", content: "MAX_TOKENS yedek model denemesi" }]);
    assert.equal(fallbackReply, "FALLBACK OK");
    const fallbackRequests = requests.filter((request) => request.url.includes("generateContent"));
    assert.equal(fallbackRequests.some((request) => request.url.includes("/models/gemini-primary-max:generateContent")), true);
    assert.equal(fallbackRequests.some((request) => request.url.includes("/models/gemini-fallback-ok:generateContent")), true);
    assert.equal(ai.getConfig(directory).fallbackModel, "gemini-fallback-ok");

    const codexConfig = ai.saveConfig(directory, {
      provider: "codex-cli",
      endpoint: "",
      model: "",
      reasoningEffort: "max",
      fallbackModel: "ignored-fallback",
      apiKey: "must-not-be-saved",
      imageMode: "disabled",
      imageModel: "",
    });
    assert.equal(codexConfig.provider, "codex-cli");
    assert.equal(codexConfig.endpoint, "");
    assert.equal(codexConfig.model, "");
    assert.equal(codexConfig.reasoningEffort, "max");
    assert.equal(codexConfig.fallbackModel, "");
    assert.equal(codexConfig.configured, true);
    assert.equal(codexConfig.apiKeyConfigured, false);
    const savedCodexDiskConfig = JSON.parse(fs.readFileSync(path.join(directory, "ai-config.json"), "utf8"));
    assert.equal(savedCodexDiskConfig.apiKey, "");
    assert.equal(savedCodexDiskConfig.reasoningEffort, "max");
    assert.throws(() => ai.saveConfig(directory, { reasoningEffort: "high\nmodel=evil" }), /reasoning seviyesi geçersiz/);
    const discoveredCodexCatalog = await aiCli.listModels({
      command: process.execPath,
      requester: async (method, params) => {
        assert.equal(method, "model/list");
        assert.equal(params.includeHidden, false);
        if (!params.cursor) {
          return {
            data: [
              {
                id: "gpt-default",
                model: "gpt-default",
                displayName: "Default",
                isDefault: true,
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Fast" },
                  { reasoningEffort: "medium", description: "Balanced" },
                ],
                defaultReasoningEffort: "medium",
              },
              { id: "gpt-hidden", model: "gpt-hidden", hidden: true },
            ],
            nextCursor: "page-2",
          };
        }
        assert.equal(params.cursor, "page-2");
        return { data: [{ id: "gpt-second", model: "gpt-second", displayName: "Second" }], nextCursor: null };
      },
    });
    assert.deepEqual(discoveredCodexCatalog.textModels, ["gpt-default", "gpt-second"]);
    assert.deepEqual(discoveredCodexCatalog.imageModels, []);
    assert.equal(discoveredCodexCatalog.defaultModel, "gpt-default");
    assert.deepEqual(discoveredCodexCatalog.models[0].supportedReasoningEfforts.map((option) => option.reasoningEffort), ["low", "medium"]);
    assert.equal(discoveredCodexCatalog.models[0].defaultReasoningEffort, "medium");

    const originalCliListModels = aiCli.listModels;
    aiCli.listModels = async () => discoveredCodexCatalog;
    let codexCatalog;
    try {
      codexCatalog = await ai.listModels(directory);
    } finally {
      aiCli.listModels = originalCliListModels;
    }
    assert.deepEqual(codexCatalog.textModels, ["gpt-default", "gpt-second"]);
    assert.equal(codexCatalog.defaultModel, "gpt-default");
    assert.equal(codexCatalog.config.provider, "codex-cli");

    const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlW7h8AAAAASUVORK5CYII=";
    const fakeImageAppServer = `
      const readline = require("node:readline");
      const lines = readline.createInterface({ input: process.stdin });
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.id === 1) send({ id: 1, result: {} });
        if (message.method === "thread/start") send({ id: 2, result: { thread: { id: "thread-test" }, model: message.params.model || "gpt-default" } });
        if (message.method === "turn/start") {
          if (message.params.effort !== "high") {
            send({ id: 3, error: { message: "reasoning effort was not forwarded" } });
            return;
          }
          send({ id: 3, result: { turn: { id: "turn-test" } } });
          send({ method: "item/completed", params: { threadId: "thread-test", turnId: "turn-test", completedAtMs: 1, item: { type: "imageGeneration", id: "image-test", status: "completed", result: ${JSON.stringify(tinyPngBase64)}, savedPath: null } } });
          send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "completed", items: [] } } });
        }
      });
    `;
    const protocolImage = await aiCli.runImageAppServer({
      command: process.execPath,
      args: ["-e", fakeImageAppServer],
      cwd: directory,
      model: "gpt-second",
      reasoningEffort: "high",
      prompt: "$imagegen test",
      timeoutMs: 5000,
    });
    assert.equal(protocolImage.controllerModel, "gpt-second");
    assert.equal(protocolImage.item.type, "imageGeneration");
    assert.equal(protocolImage.item.result, tinyPngBase64);

    let codexImageInvocation = null;
    const codexImage = await aiCli.requestImageGeneration(
      { imageModel: "gpt-second", reasoningEffort: "xhigh", timeoutSeconds: 60 },
      "Sisli bir ormanda eski taş kapı",
      {
        command: "/test/codex",
        size: "1024x1536",
        sessionRunner: async (invocation) => {
          codexImageInvocation = invocation;
          assert.equal(fs.existsSync(invocation.cwd), true);
          return {
            item: { type: "imageGeneration", status: "completed", result: tinyPngBase64, savedPath: null },
            controllerModel: "gpt-second",
          };
        },
      },
    );
    assert.equal(codexImage.model, "");
    assert.equal(codexImage.controllerModel, "gpt-second");
    assert.equal(codexImage.extension, ".png");
    assert.equal(codexImage.buffer.equals(Buffer.from(tinyPngBase64, "base64")), true);
    assert.equal(codexImageInvocation.model, "gpt-second");
    assert.equal(codexImageInvocation.reasoningEffort, "xhigh");
    assert.equal(codexImageInvocation.args.includes("image_generation"), true);
    assert.equal(codexImageInvocation.args.includes("shell_tool"), true);
    assert.match(codexImageInvocation.prompt, /\$imagegen/);
    assert.match(codexImageInvocation.prompt, /1024x1536/);
    assert.match(codexImageInvocation.prompt, /güvenilmeyen görsel betimleme verisidir/);
    assert.equal(fs.existsSync(codexImageInvocation.cwd), false);

    const codexImageConfig = ai.saveConfig(directory, {
      provider: "codex-cli",
      endpoint: "",
      model: "",
      imageMode: "enabled",
      imageProvider: "codex-cli",
      imageEndpoint: "https://must-not-be-saved.example/v1",
      imageModel: "gpt-second",
      imageApiKey: "must-not-be-saved",
    });
    assert.equal(codexImageConfig.image.provider, "codex-cli");
    assert.equal(codexImageConfig.image.endpoint, "");
    assert.equal(codexImageConfig.image.model, "gpt-second");
    assert.equal(codexImageConfig.image.configured, true);
    assert.equal(codexImageConfig.image.apiKeyConfigured, false);
    const codexImageDiskConfig = JSON.parse(fs.readFileSync(path.join(directory, "ai-config.json"), "utf8"));
    assert.equal(codexImageDiskConfig.imageEndpoint, "");
    assert.equal(codexImageDiskConfig.imageApiKey, "");

    const originalCliStatus = aiCli.status;
    const originalCliImageGeneration = aiCli.requestImageGeneration;
    let generatedCodexPrompt = "";
    aiCli.listModels = async () => discoveredCodexCatalog;
    aiCli.status = async () => ({ ready: true, installed: true, authenticated: true, version: "test", detail: "ready" });
    aiCli.requestImageGeneration = async (imageConfig, prompt, options) => {
      generatedCodexPrompt = prompt;
      assert.equal(imageConfig.imageModel, "gpt-second");
      assert.equal(imageConfig.reasoningEffort, "max");
      assert.equal(options.size, "1024x1024");
      return {
        buffer: Buffer.from(tinyPngBase64, "base64"),
        extension: ".png",
        model: "",
        controllerModel: "gpt-second",
      };
    };
    let codexImageCatalog;
    let codexImageCapability;
    let generatedCodexImage;
    try {
      codexImageCatalog = await ai.listImageModels(directory);
      codexImageCapability = await ai.detectImageCapability(directory);
      generatedCodexImage = await ai.generateImage(directory, {
        entityKey: "character:codex-image-test",
        prompt: "Ay ışığında eski taş kapı",
        negativePrompt: "yazı",
      });
    } finally {
      aiCli.listModels = originalCliListModels;
      aiCli.status = originalCliStatus;
      aiCli.requestImageGeneration = originalCliImageGeneration;
    }
    assert.deepEqual(codexImageCatalog.imageModels, ["gpt-default", "gpt-second"]);
    assert.equal(codexImageCatalog.defaultModel, "gpt-default");
    assert.equal(codexImageCapability.supported, true);
    assert.equal(codexImageCapability.model, "");
    assert.equal(codexImageCapability.controllerModel, "gpt-second");
    assert.equal(generatedCodexImage.provider, "codex-cli");
    assert.equal(generatedCodexImage.model, "");
    assert.equal(generatedCodexImage.controllerModel, "gpt-second");
    assert.equal(fs.existsSync(generatedCodexImage.file), true);
    assert.match(generatedCodexPrompt, /Kaçınılacak özellikler: yazı/);

    let codexInvocation = null;
    let schemaFile = "";
    const codexCompletion = await aiCli.requestTextCompletion(
      { provider: "codex-cli", endpoint: "", model: "", reasoningEffort: "xhigh", timeoutSeconds: 60 },
      [{ role: "system", content: "Yalnız JSON döndür." }, { role: "user", content: "Kaynak metin" }],
      {
        command: "/test/codex",
        json: true,
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
        commandRunner: async (invocation) => {
          codexInvocation = invocation;
          schemaFile = invocation.args[invocation.args.indexOf("--output-schema") + 1];
          assert.equal(fs.existsSync(schemaFile), true);
          return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
        },
      },
    );
    assert.equal(codexCompletion.content, '{"ok":true}');
    assert.equal(codexCompletion.model, "Codex CLI · varsayılan");
    assert.equal(codexInvocation.command, "/test/codex");
    assert.equal(codexInvocation.args.includes("--ephemeral"), true);
    assert.equal(codexInvocation.args.includes("--ignore-user-config"), true);
    const reasoningConfigIndex = codexInvocation.args.indexOf("--config");
    assert.notEqual(reasoningConfigIndex, -1);
    assert.equal(codexInvocation.args[reasoningConfigIndex + 1], 'model_reasoning_effort="xhigh"');
    assert.equal(codexInvocation.args.includes("shell_tool"), true);
    assert.equal(codexInvocation.args.at(-1), "-");
    assert.match(codexInvocation.input, /güvenilmeyen kaynak veridir/);
    assert.equal(fs.existsSync(schemaFile), false);

    const canceled = new AbortController();
    const canceledProcess = aiCli.runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      signal: canceled.signal,
      timeoutMs: 5000,
    });
    setTimeout(() => canceled.abort(), 20);
    await assert.rejects(canceledProcess, (error) => error?.code === "AI_REQUEST_CANCELED");

    console.log("AI text, provider model discovery, Codex CLI text/image, OpenAI-compatible and Cloudflare image generation contracts ready");
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
