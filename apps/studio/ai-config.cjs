const fs = require("node:fs");
const path = require("node:path");

const TEXT_PROVIDERS = new Set(["ollama", "openai-compatible", "codex-cli"]);
const IMAGE_PROVIDERS = new Set(["openai-compatible", "cloudflare-workers-ai", "codex-cli"]);
const CODEX_REASONING_EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;

const DEFAULT_CONFIG = {
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434/v1",
  model: "",
  reasoningEffort: "",
  fallbackModel: "",
  apiKey: "",
  timeoutSeconds: 420,
  imageMode: "auto",
  imageProvider: "openai-compatible",
  imageEndpoint: "",
  imageModel: "",
  imageApiKey: "",
};

function configPath(userDataPath) {
  return path.join(userDataPath, "ai-config.json");
}

function normalizeEndpoint(value, provider) {
  const fallback = provider === "ollama" ? DEFAULT_CONFIG.endpoint : "";
  const raw = String(value ?? fallback).trim().replace(/\/+$/, "");
  if (!raw) throw new Error("AI endpoint adresi gerekli.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("AI endpoint adresi geçersiz."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AI endpoint HTTP veya HTTPS olmalıdır.");
  if (provider === "ollama" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Ollama sağlayıcısı yalnız bu bilgisayardaki localhost endpoint'ine bağlanabilir.");
  }
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Uzak AI endpoint'leri HTTPS kullanmalıdır.");
  }
  return raw;
}

function normalizeTimeoutSeconds(value, fallback = DEFAULT_CONFIG.timeoutSeconds) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(30, Math.min(1800, Math.round(numeric)));
}

function normalizeProvider(value) {
  const provider = String(value ?? "").trim();
  return TEXT_PROVIDERS.has(provider) ? provider : "ollama";
}

function normalizeReasoningEffort(value, strict = false) {
  const effort = String(value ?? "").trim().toLowerCase();
  if (!effort || CODEX_REASONING_EFFORT_PATTERN.test(effort)) return effort;
  if (strict) throw new Error("Codex reasoning seviyesi geçersiz.");
  return "";
}

function isCliProvider(provider) {
  return normalizeProvider(provider) === "codex-cli";
}

function sanitizeConfig(input, existing = DEFAULT_CONFIG) {
  const provider = normalizeProvider(input?.provider ?? existing.provider);
  const cliProvider = isCliProvider(provider);
  const model = String(input?.model ?? existing.model ?? "").trim();
  const reasoningEffort = normalizeReasoningEffort(input?.reasoningEffort ?? existing.reasoningEffort, true);
  if (!model && !cliProvider) throw new Error("AI model adı gerekli.");
  const requestedFallbackModel = String(input?.fallbackModel ?? existing.fallbackModel ?? "").trim();
  const fallbackModel = !cliProvider && requestedFallbackModel && requestedFallbackModel !== model ? requestedFallbackModel : "";
  const endpoint = cliProvider ? "" : normalizeEndpoint(input?.endpoint ?? existing.endpoint, provider);
  let apiKey = existing.apiKey ?? "";
  if (typeof input?.apiKey === "string" && input.apiKey.trim()) apiKey = input.apiKey.trim();
  if (input?.clearApiKey === true) apiKey = "";
  if (cliProvider) apiKey = "";
  const timeoutSeconds = normalizeTimeoutSeconds(input?.timeoutSeconds, existing.timeoutSeconds);

  const requestedImageMode = String(input?.imageMode ?? existing.imageMode ?? "auto");
  const imageMode = ["auto", "enabled", "disabled"].includes(requestedImageMode) ? requestedImageMode : "auto";
  const requestedImageProvider = String(input?.imageProvider ?? existing.imageProvider ?? "openai-compatible");
  const imageProvider = IMAGE_PROVIDERS.has(requestedImageProvider) ? requestedImageProvider : "openai-compatible";
  const imageProviderChanged = imageProvider !== existing.imageProvider;
  const imageModel = String(input?.imageModel ?? (imageProviderChanged ? "" : existing.imageModel) ?? "").trim();
  const imageEndpointRaw = String(input?.imageEndpoint ?? (imageProviderChanged ? "" : existing.imageEndpoint) ?? "").trim();
  const imageEndpoint = imageProvider === "codex-cli" ? "" : imageEndpointRaw ? normalizeEndpoint(imageEndpointRaw, "openai-compatible") : "";
  let imageApiKey = imageProviderChanged ? "" : existing.imageApiKey ?? "";
  if (typeof input?.imageApiKey === "string" && input.imageApiKey.trim()) imageApiKey = input.imageApiKey.trim();
  if (input?.clearImageApiKey === true) imageApiKey = "";
  if (imageProvider === "codex-cli") imageApiKey = "";

  return { provider, endpoint, model, reasoningEffort, fallbackModel, apiKey, timeoutSeconds, imageMode, imageProvider, imageEndpoint, imageModel, imageApiKey };
}

function readConfig(userDataPath) {
  const file = configPath(userDataPath);
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const requestedImageMode = String(raw?.imageMode ?? "auto");
    const provider = normalizeProvider(raw?.provider);
    return {
      provider,
      endpoint: isCliProvider(provider) ? "" : String(raw?.endpoint ?? DEFAULT_CONFIG.endpoint),
      model: String(raw?.model ?? ""),
      reasoningEffort: normalizeReasoningEffort(raw?.reasoningEffort),
      fallbackModel: isCliProvider(provider) ? "" : String(raw?.fallbackModel ?? ""),
      apiKey: isCliProvider(provider) ? "" : String(raw?.apiKey ?? ""),
      timeoutSeconds: normalizeTimeoutSeconds(raw?.timeoutSeconds),
      imageMode: ["auto", "enabled", "disabled"].includes(requestedImageMode) ? requestedImageMode : "auto",
      imageProvider: IMAGE_PROVIDERS.has(raw?.imageProvider) ? raw.imageProvider : "openai-compatible",
      imageEndpoint: raw?.imageProvider === "codex-cli" ? "" : String(raw?.imageEndpoint ?? ""),
      imageModel: String(raw?.imageModel ?? ""),
      imageApiKey: raw?.imageProvider === "codex-cli" ? "" : String(raw?.imageApiKey ?? ""),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function publicConfig(config) {
  const cliProvider = isCliProvider(config.provider);
  return {
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.model,
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    fallbackModel: config.fallbackModel,
    timeoutSeconds: normalizeTimeoutSeconds(config.timeoutSeconds),
    configured: cliProvider || Boolean(config.model && config.endpoint),
    apiKeyConfigured: Boolean(config.apiKey),
    image: {
      mode: config.imageMode,
      provider: config.imageProvider,
      endpoint: config.imageEndpoint,
      model: config.imageModel,
      configured: config.imageProvider === "codex-cli"
        ? config.imageMode !== "disabled"
        : Boolean(config.imageModel && (config.imageEndpoint || (!cliProvider && config.endpoint))),
      apiKeyConfigured: Boolean(config.imageApiKey),
    },
  };
}

function getConfig(userDataPath) {
  return publicConfig(readConfig(userDataPath));
}

function getSecret(userDataPath, kind) {
  const config = readConfig(userDataPath);
  return kind === "image" ? config.imageApiKey : config.apiKey;
}

function saveConfig(userDataPath, input) {
  const current = readConfig(userDataPath);
  const next = sanitizeConfig(input, current);
  const file = configPath(userDataPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return publicConfig(next);
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  getSecret,
  isCliProvider,
  normalizeEndpoint,
  normalizeProvider,
  normalizeReasoningEffort,
  normalizeTimeoutSeconds,
  publicConfig,
  readConfig,
  saveConfig,
};
