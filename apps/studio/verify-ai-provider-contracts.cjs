const assert = require("node:assert/strict");
const http = require("node:http");
const aiClient = require("./ai-client.cjs");
const aiCli = require("./ai-cli.cjs");
const aiConfig = require("./ai-config.cjs");
const { NARRATIVE_OUTPUT_SCHEMA } = require("./ai-output-schemas.cjs");

const messages = [
  { role: "system", content: "Yalnız kısa ve geçerli bir yanıt ver." },
  { role: "user", content: "Channel Foundry sağlayıcı sözleşmesini doğrula." },
];

function assertStrictObjectSchemas(schema, location = "schema") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    const propertyNames = Object.keys(schema.properties ?? {}).sort();
    const requiredNames = [...(schema.required ?? [])].sort();
    assert.deepEqual(requiredNames, propertyNames, `${location} strict structured output için tüm properties alanlarını required yapmalı`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      for (const [propertyName, propertySchema] of Object.entries(value ?? {})) {
        assertStrictObjectSchemas(propertySchema, `${location}.properties.${propertyName}`);
      }
      continue;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => assertStrictObjectSchemas(entry, `${location}.${key}[${index}]`));
    else assertStrictObjectSchemas(value, `${location}.${key}`);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function reply(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function verifyHttpProviders() {
  const requests = [];
  let retryFailures = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}
      requests.push({ url: req.url, headers: req.headers, body });

      if (body.model === "ollama-retry" && retryFailures === 0) {
        retryFailures += 1;
        req.socket.destroy();
        return;
      }
      if (body.model === "primary-limit") {
        reply(res, 200, {
          model: "primary-limit",
          choices: [{ finish_reason: "length", message: { content: "kısmi yanıt" } }],
        });
        return;
      }
      if (body.model === "fallback-model") {
        reply(res, 200, {
          model: "fallback-model",
          choices: [{ finish_reason: "stop", message: { content: "yedek model yanıtı" } }],
        });
        return;
      }
      if (body.model === "slow-model") {
        setTimeout(() => {
          if (res.destroyed) return;
          reply(res, 200, {
            model: "slow-model",
            choices: [{ finish_reason: "stop", message: { content: "geç yanıt" } }],
          });
        }, 120);
        return;
      }
      reply(res, 200, {
        model: body.model || "unknown",
        choices: [{ finish_reason: "stop", message: { content: `ok:${body.model || "unknown"}` } }],
      });
    });
  });

  const endpoint = await listen(server);
  try {
    const ollama = await aiClient.requestModelCompletion({
      provider: "ollama",
      endpoint,
      model: "ollama-retry",
      apiKey: "",
      timeoutSeconds: 30,
    }, messages, {
      json: true,
      maxTokens: 321,
      retryDelaysMs: [0, 0],
    });
    assert.equal(ollama.content, "ok:ollama-retry");
    assert.equal(ollama.model, "ollama-retry");
    const ollamaRequests = requests.filter((entry) => entry.body.model === "ollama-retry");
    assert.equal(ollamaRequests.length, 2, "Geçici Ollama taşıma hatası bir kez yeniden denenmeli");
    const successfulOllama = ollamaRequests.at(-1);
    assert.equal(successfulOllama.url, "/v1/chat/completions");
    assert.equal(successfulOllama.headers.authorization, "Bearer ollama");
    assert.equal(successfulOllama.body.max_tokens, 321);
    assert.deepEqual(successfulOllama.body.response_format, { type: "json_object" });
    assert.equal(successfulOllama.body.stream, false);

    const openai = await aiClient.requestModelCompletion({
      provider: "openai-compatible",
      endpoint,
      model: "openai-model",
      apiKey: "provider-secret",
      timeoutSeconds: 30,
    }, messages, { retryDelaysMs: [] });
    assert.equal(openai.content, "ok:openai-model");
    const openaiRequest = requests.find((entry) => entry.body.model === "openai-model");
    assert.equal(openaiRequest.headers.authorization, "Bearer provider-secret");
    assert.equal(openaiRequest.body.response_format, undefined);

    const fallback = await aiClient.requestTextCompletion({
      provider: "openai-compatible",
      endpoint,
      model: "primary-limit",
      fallbackModel: "fallback-model",
      apiKey: "provider-secret",
      timeoutSeconds: 30,
    }, messages, { retryDelaysMs: [] });
    assert.equal(fallback.content, "yedek model yanıtı");
    assert.equal(fallback.model, "fallback-model");
    assert.equal(fallback.fallbackUsed, true);
    assert.equal(fallback.primaryModel, "primary-limit");
    assert.match(fallback.primaryError, /token sınırına ulaştı/i);

    await assert.rejects(
      aiClient.requestModelCompletion({
        provider: "openai-compatible",
        endpoint,
        model: "slow-model",
        apiKey: "provider-secret",
        timeoutSeconds: 30,
      }, messages, { timeoutMs: 25, retryDelaysMs: [] }),
      /zaman aşımı sınırına ulaştı/i,
    );

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      aiClient.requestModelCompletion({
        provider: "openai-compatible",
        endpoint,
        model: "openai-model",
        apiKey: "provider-secret",
        timeoutSeconds: 30,
      }, messages, { signal: controller.signal, retryDelaysMs: [] }),
      (error) => error?.code === "AI_REQUEST_CANCELED",
    );
  } finally {
    await close(server);
  }
}

async function verifyCodexContract() {
  assertStrictObjectSchemas(NARRATIVE_OUTPUT_SCHEMA, "NARRATIVE_OUTPUT_SCHEMA");
  const sectionSchema = NARRATIVE_OUTPUT_SCHEMA.properties.sections.items;
  assert.deepEqual(sectionSchema.properties.sectionId.anyOf.map((entry) => entry.type), ["string", "null"]);

  const args = aiCli.codexArgs({ model: "gpt-test", reasoningEffort: "low" }, "/tmp/schema.json");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-test"));
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.some((entry) => entry === 'model_reasoning_effort="low"'));
  assert.ok(args.includes("shell_tool"), "Codex çözümleme oturumunda shell aracı kapatılmalı");
  assert.ok(args.includes("browser_use"), "Codex çözümleme oturumunda browser aracı kapatılmalı");
  assert.throws(() => aiCli.validatedCodexReasoningEffort("low\nunsafe"), /reasoning seviyesi geçersiz/i);

  let captured = null;
  const result = await aiCli.requestTextCompletion({
    provider: "codex-cli",
    model: "",
    reasoningEffort: "low",
    timeoutSeconds: 31,
  }, messages, {
    command: "fake-codex",
    json: true,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
    commandRunner: async (input) => {
      captured = input;
      const schemaIndex = input.args.indexOf("--output-schema");
      assert.ok(schemaIndex >= 0);
      const schemaPath = input.args[schemaIndex + 1];
      assert.ok(schemaPath && require("node:fs").existsSync(schemaPath), "Codex JSON şeması geçici dosyaya yazılmalı");
      return { code: 0, stdout: "\u001b[32m{\"ok\":true}\u001b[0m\n", stderr: "" };
    },
  });
  assert.equal(result.content, '{"ok":true}');
  assert.equal(result.finishReason, "stop");
  assert.equal(result.model, "Codex CLI · varsayılan");
  assert.equal(captured.command, "fake-codex");
  assert.equal(captured.timeoutMs, 31_000);
  assert.match(captured.input, /Yalnız kısa ve geçerli bir yanıt ver/);
  assert.match(captured.input, /Channel Foundry sağlayıcı sözleşmesini doğrula/);

  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(
    aiCli.runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('unexpected')"],
      signal: canceled.signal,
    }),
    (error) => error?.code === "AI_REQUEST_CANCELED",
  );

  await assert.rejects(
    aiCli.runProcess({
      command: process.execPath,
      args: ["-e", "process.stderr.write('prompt:' + 'x'.repeat(1800) + '\\nERROR: invalid_json_schema: Missing entityId.\\n'); process.exit(1)"],
      timeoutMs: 5000,
    }),
    (error) => error?.code === "AI_CLI_FAILED"
      && /invalid_json_schema: Missing entityId/.test(error.message)
      && !/prompt:xxx/.test(error.message),
  );
}

async function main() {
  assert.equal(aiConfig.normalizeTimeoutSeconds(1), 30);
  assert.equal(aiConfig.normalizeTimeoutSeconds(99999), 1800);
  assert.equal(aiConfig.normalizeEndpoint("http://localhost:11434/v1/", "ollama"), "http://localhost:11434/v1");
  assert.throws(
    () => aiConfig.normalizeEndpoint("https://example.test/v1", "ollama"),
    /yalnız bu bilgisayardaki localhost endpoint/i,
  );
  assert.throws(
    () => aiConfig.normalizeEndpoint("http://example.test/v1", "openai-compatible"),
    /Uzak AI endpoint'leri HTTPS kullanmalıdır/i,
  );
  assert.equal(aiClient.authHeaders("", "ollama").Authorization, "Bearer ollama");
  assert.equal(aiClient.authHeaders("provider-secret", "openai-compatible").Authorization, "Bearer provider-secret");

  await verifyHttpProviders();
  await verifyCodexContract();

  console.log("Ollama, OpenAI-compatible and Codex CLI provider contracts keep request shape, retry, fallback, timeout and cancellation behavior stable without external AI calls");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
