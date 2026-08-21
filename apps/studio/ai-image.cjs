const fs = require("node:fs");
const visualProfiles = require("./visual-profiles.cjs");
const { normalizeEndpoint, normalizeTimeoutSeconds, publicConfig, readConfig } = require("./ai-config.cjs");
const { authHeaders, normalizeListedModels } = require("./ai-client.cjs");
const aiCli = require("./ai-cli.cjs");

function imageProvider(config) {
  if (config.imageProvider === "codex-cli") return "codex-cli";
  return config.imageProvider === "cloudflare-workers-ai" ? "cloudflare-workers-ai" : "openai-compatible";
}

function cloudflareEndpoint(config) {
  if (!config.imageEndpoint) throw new Error("Cloudflare Account ID içeren görsel endpoint'i gerekli.");
  const endpoint = normalizeEndpoint(config.imageEndpoint, "openai-compatible").replace(/\/v1$/i, "");
  const url = new URL(endpoint);
  if (url.hostname !== "api.cloudflare.com" || !/^\/client\/v4\/accounts\/[^/]+\/ai$/i.test(url.pathname)) {
    throw new Error("Cloudflare endpoint'i https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai biçiminde olmalı.");
  }
  return endpoint;
}

function imageEndpoint(config) {
  return imageProvider(config) === "cloudflare-workers-ai"
    ? cloudflareEndpoint(config)
    : normalizeEndpoint(config.imageEndpoint || config.endpoint, "openai-compatible");
}

function imageApiKey(config) {
  if (imageProvider(config) === "codex-cli") return "";
  return imageProvider(config) === "cloudflare-workers-ai" ? config.imageApiKey : config.imageApiKey || config.apiKey;
}

function responseDetail(payload, fallback) {
  return payload?.error?.message
    || payload?.errors?.find((entry) => entry?.message)?.message
    || payload?.message
    || fallback;
}

function normalizeCloudflareModels(entries) {
  const seen = new Set();
  const models = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = String(entry?.name ?? entry?.id ?? entry?.model ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: String(entry?.display_name ?? entry?.displayName ?? entry?.description ?? id) });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function imageModelListConfig(userDataPath, input) {
  const existing = readConfig(userDataPath);
  if (!input || typeof input !== "object") return existing;
  const provider = input.provider === "ollama" || input.provider === "openai-compatible" || input.provider === "codex-cli"
    ? input.provider
    : existing.provider;
  const nextImageProvider = input.imageProvider === "cloudflare-workers-ai" || input.imageProvider === "openai-compatible" || input.imageProvider === "codex-cli"
    ? input.imageProvider
    : existing.imageProvider;
  const imageProviderChanged = nextImageProvider !== existing.imageProvider;
  return {
    ...existing,
    provider,
    endpoint: typeof input.endpoint === "string" ? input.endpoint : existing.endpoint,
    apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : existing.apiKey,
    timeoutSeconds: input.timeoutSeconds == null ? existing.timeoutSeconds : normalizeTimeoutSeconds(input.timeoutSeconds, existing.timeoutSeconds),
    imageProvider: nextImageProvider,
    imageEndpoint: typeof input.imageEndpoint === "string" ? input.imageEndpoint : existing.imageEndpoint,
    imageApiKey: typeof input.imageApiKey === "string" ? input.imageApiKey.trim() : imageProviderChanged ? "" : existing.imageApiKey,
  };
}

async function listImageModels(userDataPath, input = null) {
  const config = imageModelListConfig(userDataPath, input);
  const provider = imageProvider(config);
  if (provider === "codex-cli") {
    const catalog = await aiCli.listModels({
      timeoutMs: Math.min(60000, normalizeTimeoutSeconds(config.timeoutSeconds) * 1000),
    });
    return {
      provider,
      models: catalog.models.map((entry) => ({ id: entry.id, label: entry.label })),
      imageModels: catalog.textModels,
      defaultModel: catalog.defaultModel,
      config: publicConfig(config),
    };
  }
  const endpoint = imageEndpoint(config);
  const apiKey = imageApiKey(config);
  if (provider === "cloudflare-workers-ai" && !apiKey) throw new Error("Cloudflare Workers AI API anahtarı gerekli.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(60000, normalizeTimeoutSeconds(config.timeoutSeconds) * 1000));
  try {
    let response;
    let payload = null;
    if (provider === "cloudflare-workers-ai") {
      for (const task of ["text-to-image", "Text-to-Image"]) {
        response = await fetch(`${endpoint}/models/search?task=${encodeURIComponent(task)}&per_page=100`, {
          method: "GET",
          headers: authHeaders(apiKey),
          signal: controller.signal,
        });
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok || payload?.success === false) {
          throw new Error(`Cloudflare görsel modelleri alınamadı: ${String(responseDetail(payload, `HTTP ${response.status}`)).slice(0, 500)}`);
        }
        const models = normalizeCloudflareModels(payload?.result ?? payload?.data);
        if (models.length) return { provider, models, imageModels: models.map((entry) => entry.id), config: publicConfig(config) };
      }
      throw new Error("Cloudflare hesabı erişilebilir bir text-to-image modeli döndürmedi.");
    }

    response = await fetch(`${endpoint}/models`, {
      method: "GET",
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
    try { payload = await response.json(); } catch {}
    if ((!response.ok || !(Array.isArray(payload?.data) || Array.isArray(payload?.models))) && endpoint.includes("generativelanguage.googleapis.com") && apiKey) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        signal: controller.signal,
      });
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!response.ok) {
      throw new Error(`Görsel model listesi alınamadı: ${String(responseDetail(payload, `HTTP ${response.status}`)).slice(0, 500)}`);
    }
    const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const models = normalizeListedModels(entries).filter((entry) => entry.image);
    return { provider, models, imageModels: models.map((entry) => entry.id), config: publicConfig(config) };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Görsel model listesi isteği zaman aşımına uğradı.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function detectImageCapability(userDataPath) {
  const config = readConfig(userDataPath);
  const provider = imageProvider(config);
  if (config.imageMode === "disabled") {
    return { supported: false, detected: true, mode: "disabled", provider, model: config.imageModel, reason: "Görsel üretimi ayarlardan kapatıldı." };
  }
  if (provider === "codex-cli") {
    const cliStatus = await aiCli.status();
    return {
      supported: cliStatus.ready,
      detected: true,
      mode: config.imageMode,
      provider,
      model: "",
      controllerModel: config.imageModel,
      reason: cliStatus.ready
        ? `Codex CLI görsel üretimi hazır; ${config.imageModel || "CLI varsayılanı"} isteği yönetir ve yerleşik görsel aracını çağırır.`
        : cliStatus.detail || "Codex CLI kurulumu veya açık oturumu bulunamadı.",
    };
  }
  if (!config.imageModel) {
    return { supported: false, detected: true, mode: config.imageMode, provider, model: "", reason: "Görsel modeli seçilmedi." };
  }
  if (config.imageMode === "enabled") {
    return { supported: true, detected: false, mode: "enabled", provider, model: config.imageModel, reason: "Kullanıcı tarafından etkinleştirildi." };
  }
  try {
    const catalog = await listImageModels(userDataPath);
    const target = catalog.imageModels.find((id) => id === config.imageModel);
    if (target) return { supported: true, detected: true, mode: "auto", provider, model: config.imageModel, reason: "Sağlayıcı model kataloğunda görsel üretim yeteneği bildirdi." };
    return { supported: false, detected: false, mode: "auto", provider, model: config.imageModel, reason: "Seçili görsel modeli sağlayıcının görsel model kataloğunda bulunamadı." };
  } catch (error) {
    return { supported: false, detected: false, mode: "auto", provider, model: config.imageModel, reason: `Yetenek algılanamadı: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function extensionFromContentType(contentType) {
  const value = String(contentType ?? "").toLowerCase();
  if (value.includes("webp")) return ".webp";
  if (value.includes("jpeg") || value.includes("jpg")) return ".jpg";
  return ".png";
}

function cloudflareModelPath(model) {
  const value = String(model ?? "").trim();
  if (!value.startsWith("@cf/") || value.split("/").length < 3) throw new Error("Cloudflare görsel modeli @cf/yayıncı/model biçiminde olmalı.");
  return value.split("/").map((part) => encodeURIComponent(part)).join("/").replace(/^%40/, "@");
}

async function imageBufferFromOpenAiPayload(payload) {
  const first = payload?.data?.[0] ?? payload?.images?.[0];
  if (!first) throw new Error("Görsel sağlayıcısı boş yanıt döndürdü.");
  if (typeof first.b64_json === "string" && first.b64_json) return { buffer: Buffer.from(first.b64_json, "base64"), extension: ".png" };
  if (typeof first.base64 === "string" && first.base64) return { buffer: Buffer.from(first.base64, "base64"), extension: ".png" };
  if (typeof first.url === "string" && first.url) {
    const download = await fetch(first.url);
    if (!download.ok) throw new Error(`Üretilen görsel indirilemedi (HTTP ${download.status}).`);
    return {
      buffer: Buffer.from(await download.arrayBuffer()),
      extension: extensionFromContentType(download.headers.get("content-type")),
    };
  }
  throw new Error("Görsel sağlayıcısı desteklenen base64 veya URL çıktısı döndürmedi.");
}

async function requestGeneratedImage(config, finalPrompt, size, signal) {
  const provider = imageProvider(config);
  if (provider === "codex-cli") {
    return aiCli.requestImageGeneration(config, finalPrompt, {
      size,
      signal,
      timeoutMs: normalizeTimeoutSeconds(config.timeoutSeconds) * 1000,
    });
  }
  const endpoint = imageEndpoint(config);
  const apiKey = imageApiKey(config);
  if (provider === "cloudflare-workers-ai" && !apiKey) throw new Error("Cloudflare Workers AI API anahtarı gerekli.");
  const requestUrl = provider === "cloudflare-workers-ai"
    ? `${endpoint}/run/${cloudflareModelPath(config.imageModel)}`
    : `${endpoint}/images/generations`;
  const body = provider === "cloudflare-workers-ai"
    ? { prompt: finalPrompt, steps: 4 }
    : { model: config.imageModel, prompt: finalPrompt, n: 1, size };
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: authHeaders(apiKey),
    signal,
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  if (response.ok && contentType.toLowerCase().startsWith("image/")) {
    return { buffer: Buffer.from(await response.arrayBuffer()), extension: extensionFromContentType(contentType) };
  }
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok || payload?.success === false) {
    const detail = responseDetail(payload, text || `HTTP ${response.status}`);
    throw new Error(`Görsel üretim isteği başarısız: ${String(detail).slice(0, 700)}`);
  }
  if (provider === "cloudflare-workers-ai") {
    const base64 = payload?.result?.image ?? payload?.image ?? (typeof payload?.result === "string" ? payload.result : "");
    if (typeof base64 !== "string" || !base64) throw new Error("Cloudflare Workers AI boş görsel yanıtı döndürdü.");
    return { buffer: Buffer.from(base64, "base64"), extension: ".jpg" };
  }
  return imageBufferFromOpenAiPayload(payload);
}

async function generateImage(userDataPath, input) {
  const config = readConfig(userDataPath);
  const provider = imageProvider(config);
  const capability = await detectImageCapability(userDataPath);
  if (!capability.supported) throw new Error(`Görsel üretimi kullanılamıyor: ${capability.reason}`);
  const prompt = String(input?.prompt ?? "").trim();
  if (!prompt) throw new Error("Görsel üretimi için prompt gerekli.");
  const entityKey = String(input?.entityKey ?? "generated-preview").trim() || "generated-preview";
  const size = ["1024x1024", "1536x1024", "1024x1536"].includes(String(input?.size)) ? String(input.size) : "1024x1024";
  const negative = String(input?.negativePrompt ?? "").trim();
  const finalPrompt = negative ? `${prompt}\n\nKaçınılacak özellikler: ${negative}` : prompt;
  const controller = new AbortController();
  const timeoutMs = normalizeTimeoutSeconds(config.timeoutSeconds) * 1000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const generated = await requestGeneratedImage(config, finalPrompt, size, controller.signal);
    const { buffer, extension } = generated;
    if (!buffer?.length || buffer.length > 25 * 1024 * 1024) throw new Error("Üretilen görsel boş veya 25 MB sınırını aşıyor.");
    const file = visualProfiles.targetFile(userDataPath, entityKey, extension);
    fs.writeFileSync(file, buffer);
    return {
      ok: true,
      file,
      provider,
      model: generated.model || (provider === "codex-cli" ? "" : config.imageModel),
      controllerModel: generated.controllerModel || "",
      size,
      capability,
    };
  } catch (error) {
    if (error?.name === "AbortError" || (error?.code === "AI_REQUEST_CANCELED" && controller.signal.aborted)) {
      throw new Error(`Görsel üretim isteği ${Math.round(timeoutMs / 1000)} saniyelik zaman aşımı sınırına ulaştı.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { detectImageCapability, generateImage, imageModelListConfig, listImageModels };
