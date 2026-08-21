const {
  getConfig,
  normalizeEndpoint,
  normalizeTimeoutSeconds,
  publicConfig,
  readConfig,
} = require("./ai-config.cjs");
const aiJson = require("./ai-json.cjs");
const aiCli = require("./ai-cli.cjs");
const aiActivity = require("./ai-activity.cjs");

const TRANSIENT_FETCH_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const DEFAULT_FETCH_RETRY_DELAYS_MS = [750, 2000];

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current) && chain.length < 6) {
    seen.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function isTransientFetchError(error) {
  if (error?.name === "AbortError") return false;
  const chain = errorChain(error);
  const codes = chain.map((entry) => String(entry?.code ?? "").toUpperCase()).filter(Boolean);
  if (codes.length) return codes.some((code) => TRANSIENT_FETCH_CODES.has(code));
  return error instanceof TypeError && /fetch failed|network|socket/i.test(String(error.message ?? ""));
}

function isFetchTransportError(error) {
  if (error?.name === "AbortError") return false;
  if (errorChain(error).some((entry) => String(entry?.code ?? "").trim())) return true;
  return error instanceof TypeError && /fetch failed|network|socket/i.test(String(error.message ?? ""));
}

function networkErrorDetail(error) {
  const details = [];
  for (const entry of errorChain(error)) {
    const code = String(entry?.code ?? "").trim();
    const message = String(entry?.message ?? "").trim();
    if (code && !details.includes(code)) details.push(code);
    if (message && !/^fetch failed$/i.test(message) && !details.includes(message)) details.push(message);
  }
  return details.join(": ").slice(0, 500) || String(error?.message || "Bilinmeyen ağ hatası").slice(0, 500);
}

function retryDelays(value) {
  const source = Array.isArray(value) ? value : DEFAULT_FETCH_RETRY_DELAYS_MS;
  return source
    .slice(0, 4)
    .map(Number)
    .filter((delay) => Number.isFinite(delay) && delay >= 0)
    .map((delay) => Math.min(10000, Math.round(delay)));
}

function networkFailure(error, attempts) {
  const failure = new Error(`AI bağlantısı ${attempts} denemeden sonra başarısız: ${networkErrorDetail(error)}`);
  failure.code = "AI_NETWORK_FAILED";
  failure.cause = error;
  return failure;
}

async function fetchWithTransientRetry(url, init, options = {}) {
  const delays = retryDelays(options.retryDelaysMs);
  let failures = 0;
  while (true) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (!isFetchTransportError(error)) throw error;
      failures += 1;
      if (!isTransientFetchError(error) || failures > delays.length) throw networkFailure(error, failures);
      const delay = delays[failures - 1];
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function parseAssistantJson(content) {
  const value = aiJson.parseLoose(content).value;
  if (!value || typeof value !== "object") throw new Error("AI yanıtı geçersiz.");
  return value;
}

function authHeaders(apiKey, provider = "") {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  else if (provider === "ollama") headers.Authorization = "Bearer ollama";
  return headers;
}

function geminiApiBase(endpoint) {
  let url;
  try { url = new URL(String(endpoint || "")); } catch { return ""; }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "generativelanguage.googleapis.com") return "";
  const match = url.pathname.replace(/\/+$/, "").match(/^\/(v1(?:beta|alpha)?)(?:\/openai)?$/i);
  if (!match) return "";
  return `${url.origin}/${match[1].toLowerCase()}`;
}

function isGeminiApiEndpoint(endpoint) {
  return Boolean(geminiApiBase(endpoint));
}

function geminiHeaders(apiKey) {
  if (!apiKey) throw new Error("Gemini API anahtarı gerekli.");
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}

function messageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return String(entry.text ?? entry.content ?? "");
    return "";
  }).join("\n").trim();
}

function geminiBody(messages, options = {}) {
  const system = [];
  const contents = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = messageText(message?.content);
    if (!text) continue;
    if (message?.role === "system") {
      system.push(text);
      continue;
    }
    contents.push({
      role: message?.role === "assistant" || message?.role === "model" ? "model" : "user",
      parts: [{ text }],
    });
  }
  if (!contents.length) throw new Error("Gemini isteği için en az bir kullanıcı mesajı gerekli.");
  const generationConfig = {
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxTokens ?? 1200,
    ...(options.json ? { responseMimeType: "application/json" } : {}),
  };
  return {
    contents,
    generationConfig,
    ...(system.length ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } } : {}),
  };
}

function geminiResponseText(payload) {
  const candidate = payload?.candidates?.[0];
  const content = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts.map((part) => typeof part?.text === "string" ? part.text : "").join("").trim()
    : "";
  if (content) return {
    content,
    finishReason: String(candidate?.finishReason ?? "").toLowerCase(),
    model: String(payload?.modelVersion ?? payload?.model ?? "").replace(/^models\//, "").trim(),
  };
  const reason = candidate?.finishReason || payload?.promptFeedback?.blockReason || "yanıt metni bulunamadı";
  const error = new Error(`Gemini sağlayıcısı metin yanıtı üretmedi (${String(reason).slice(0, 160)}).`);
  if (isOutputLimitFinishReason(reason)) {
    error.code = "AI_OUTPUT_MAX_TOKENS";
    error.finishReason = String(reason);
  }
  throw error;
}

async function requestGeminiContent(config, messages, options = {}) {
  const endpoint = geminiApiBase(config?.endpoint);
  if (!endpoint) throw new Error("Gemini endpoint'i geçersiz.");
  const model = String(config?.model || "").replace(/^models\//, "").trim();
  if (!model) throw new Error("Gemini model adı gerekli.");
  const request = options.fetcher || fetch;
  const response = await request(`${endpoint}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: geminiHeaders(config?.apiKey),
    signal: options.signal,
    body: JSON.stringify(geminiBody(messages, options)),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(`Gemini isteği başarısız: ${String(detail).slice(0, 500)}`);
  }
  return geminiResponseText(payload);
}

function isOutputLimitFinishReason(value) {
  const reason = String(value ?? "").trim();
  return /max(?:imum)?[_\s-]?(?:output[_\s-]?)?tokens?|^length$/i.test(reason);
}

function outputLimitError(provider, finishReason) {
  const reason = String(finishReason || "MAX_TOKENS").slice(0, 160);
  const error = new Error(`${provider} sağlayıcısı yanıtı token sınırına ulaştı (${reason}).`);
  error.code = "AI_OUTPUT_MAX_TOKENS";
  error.finishReason = reason;
  return error;
}

function configuredFallbackModel(config) {
  const primary = String(config?.model ?? "").trim().replace(/^models\//, "");
  const fallback = String(config?.fallbackModel ?? "").trim().replace(/^models\//, "");
  return fallback && fallback !== primary ? fallback : "";
}

function isFallbackEligibleError(error) {
  if (error?.code === "AI_OUTPUT_MAX_TOKENS" || error?.code === "AI_OUTPUT_TRUNCATED") return true;
  return /metin yanıtı üretmedi\s*\(\s*max(?:imum)?[_\s-]?(?:output[_\s-]?)?tokens?/i.test(String(error?.message ?? ""));
}

function requestCanceledError() {
  const canceled = new Error("AI çözümleme işlemi kullanıcı tarafından durduruldu.");
  canceled.code = "AI_REQUEST_CANCELED";
  return canceled;
}

function requestTimeoutMs(config, options) {
  const configured = normalizeTimeoutSeconds(config?.timeoutSeconds) * 1000;
  const requested = Number(options?.timeoutMs ?? configured);
  return Number.isFinite(requested) && requested > 0 ? Math.round(requested) : configured;
}

async function requestModelCompletion(config, messages, options = {}) {
  const model = String(config?.model ?? "").trim();
  if (!model) throw new Error("Önce Ayarlar bölümünden bir AI modeli yapılandır.");
  const endpoint = normalizeEndpoint(config?.endpoint, config?.provider);
  const timeoutMs = requestTimeoutMs(config, options);
  const externalSignal = options.signal;
  if (externalSignal?.aborted) throw requestCanceledError();

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternalSignal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });

  try {
    if (isGeminiApiEndpoint(endpoint)) {
      const result = await requestGeminiContent({ ...config, endpoint, model }, messages, {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        json: options.json,
        signal: controller.signal,
        fetcher: (url, init) => fetchWithTransientRetry(url, init, { retryDelaysMs: options.retryDelaysMs }),
      });
      return { content: result.content, finishReason: result.finishReason, model: result.model || model };
    }

    const response = await fetchWithTransientRetry(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: authHeaders(config.apiKey, config.provider),
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        stream: false,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
    }, { retryDelaysMs: options.retryDelaysMs });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
      throw new Error(`AI isteği başarısız: ${String(detail).slice(0, 500)}`);
    }
    const finishReason = String(payload?.choices?.[0]?.finish_reason ?? "").trim().toLowerCase();
    const content = payload?.choices?.[0]?.message?.content;
    if (isOutputLimitFinishReason(finishReason) && (typeof content !== "string" || !content.trim())) throw outputLimitError("AI", finishReason);
    if (typeof content !== "string" || !content.trim()) throw new Error("AI sağlayıcısı boş yanıt döndürdü.");
    const responseModel = String(payload?.model ?? "").replace(/^models\//, "").trim();
    return { content, finishReason, model: responseModel || model };
  } catch (error) {
    if (externalSignal?.aborted && !timedOut) throw requestCanceledError();
    if (error?.name === "AbortError") throw new Error(`AI isteği ${Math.round(timeoutMs / 1000)} saniyelik zaman aşımı sınırına ulaştı.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

function fallbackFailureError(primaryModel, fallbackModel, primaryError, fallbackError) {
  const message = String(fallbackError?.message ?? fallbackError ?? "Bilinmeyen hata").slice(0, 700);
  const error = new Error(`Ana model (${primaryModel}) token sınırına ulaştı; yedek model (${fallbackModel}) de başarısız oldu: ${message}`);
  error.code = fallbackError?.code;
  error.cause = fallbackError;
  error.primaryError = primaryError;
  error.response = fallbackError?.response;
  return error;
}

function throwIfOutputLimited(config, result) {
  if (!isOutputLimitFinishReason(result?.finishReason)) return result;
  const provider = isGeminiApiEndpoint(config?.endpoint) ? "Gemini" : "AI";
  const error = outputLimitError(provider, result.finishReason);
  error.response = result;
  throw error;
}

async function requestTextCompletion(config, messages, options = {}) {
  if (aiCli.isCliProvider(config?.provider)) {
    const activityRequest = aiActivity.beginRequest(options.activity, {
      provider: config?.provider,
      model: String(config?.model ?? "").trim() || "Codex CLI · varsayılan",
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      json: options.json,
      reasoningEffort: config?.reasoningEffort,
    });
    try {
      const result = await aiCli.requestTextCompletion(config, messages, options);
      aiActivity.completeRequest(activityRequest, {
        content: result.content,
        finishReason: result.finishReason,
        model: result.model,
      });
      return { ...result, fallbackUsed: false };
    } catch (error) {
      aiActivity.failRequest(activityRequest, error);
      throw error;
    }
  }
  const primaryModel = String(config?.model ?? "").trim();
  const trackedRequest = async (model, attempt) => {
    const activity = options.activity
      ? { ...options.activity, attempt: attempt === "fallback" ? "fallback" : options.activity.attempt }
      : null;
    const activityRequest = aiActivity.beginRequest(activity, {
      provider: config?.provider,
      model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      json: options.json,
    });
    try {
      const result = await requestModelCompletion({ ...config, model, fallbackModel: "" }, messages, options);
      aiActivity.completeRequest(activityRequest, {
        content: result.content,
        finishReason: result.finishReason,
        model: result.model,
      });
      return throwIfOutputLimited(config, result);
    } catch (error) {
      aiActivity.failRequest(activityRequest, error);
      throw error;
    }
  };
  try {
    const result = await trackedRequest(primaryModel, "primary");
    return { ...result, fallbackUsed: false };
  } catch (error) {
    const fallbackModel = configuredFallbackModel(config);
    if (options.allowFallback === false || !fallbackModel || !isFallbackEligibleError(error) || options.signal?.aborted) {
      if (error?.response) return { ...error.response, fallbackUsed: false };
      throw error;
    }
    try {
      const result = await trackedRequest(fallbackModel, "fallback");
      return { ...result, fallbackUsed: true, primaryModel, primaryError: String(error.message ?? error) };
    } catch (fallbackError) {
      throw fallbackFailureError(primaryModel, fallbackModel, error, fallbackError);
    }
  }
}

function modelId(entry) {
  return String(entry?.id ?? entry?.name ?? "").replace(/^models\//, "").trim();
}

function modelSignalsImage(model) {
  if (!model || typeof model !== "object") return false;
  if (model.capabilities?.image_generation === true || model.capabilities?.images === true) return true;
  const values = [model.modalities, model.output_modalities, model.outputModalities, model.capabilities?.modalities]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => String(value).toLowerCase());
  return values.includes("image") || values.includes("images");
}

function normalizeListedModels(entries) {
  const seen = new Set();
  const models = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = modelId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const methods = Array.isArray(entry?.supportedGenerationMethods) ? entry.supportedGenerationMethods.map(String) : [];
    const image = modelSignalsImage(entry) || /(?:^|[-_.])(image|imagen)(?:[-_.]|$)/i.test(id);
    const text = methods.length ? methods.includes("generateContent") : !/^imagen(?:-|$)/i.test(id);
    models.push({ id, text, image, label: String(entry?.displayName ?? entry?.owned_by ?? id) });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function modelListConfig(userDataPath, input) {
  const existing = readConfig(userDataPath);
  if (!input || typeof input !== "object") return existing;
  const provider = input.provider === "ollama" || input.provider === "openai-compatible" || aiCli.isCliProvider(input.provider)
    ? input.provider
    : existing.provider;
  return {
    ...existing,
    provider,
    endpoint: typeof input.endpoint === "string" ? input.endpoint : existing.endpoint,
    apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : existing.apiKey,
    timeoutSeconds: input.timeoutSeconds == null ? existing.timeoutSeconds : normalizeTimeoutSeconds(input.timeoutSeconds, existing.timeoutSeconds),
  };
}

async function listModels(userDataPath, input = null) {
  const config = modelListConfig(userDataPath, input);
  if (aiCli.isCliProvider(config.provider)) {
    const catalog = await aiCli.listModels({
      timeoutMs: Math.min(60000, normalizeTimeoutSeconds(config.timeoutSeconds) * 1000),
    });
    return { ...catalog, config: publicConfig(config) };
  }
  if (!config.endpoint) throw new Error("Model listesini almak için önce AI endpoint'i yapılandırılmalı.");
  const endpoint = normalizeEndpoint(config.endpoint, config.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(60000, normalizeTimeoutSeconds(config.timeoutSeconds) * 1000));
  try {
    const geminiEndpoint = geminiApiBase(endpoint);
    let response = await fetch(geminiEndpoint ? `${geminiEndpoint}/models` : `${endpoint}/models`, {
      method: "GET",
      headers: geminiEndpoint ? geminiHeaders(config.apiKey) : authHeaders(config.apiKey, config.provider),
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}

    if (!geminiEndpoint && (!response.ok || !(Array.isArray(payload?.data) || Array.isArray(payload?.models))) && endpoint.includes("generativelanguage.googleapis.com") && config.apiKey) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`, {
        method: "GET",
        signal: controller.signal,
      });
      try { payload = await response.json(); } catch { payload = null; }
    }

    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      throw new Error(`Model listesi alınamadı: ${String(detail).slice(0, 500)}`);
    }
    const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const models = normalizeListedModels(entries);
    return {
      models,
      textModels: models.filter((entry) => entry.text).map((entry) => entry.id),
      imageModels: models.filter((entry) => entry.image).map((entry) => entry.id),
      config: publicConfig(config),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Model listesi isteği zaman aşımına uğradı.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function chat(userDataPath, messages, options = {}) {
  const config = readConfig(userDataPath);
  if (!config.model && !aiCli.isCliProvider(config.provider)) throw new Error("Önce Ayarlar bölümünden bir AI modeli yapılandır.");
  const result = await requestTextCompletion(config, messages, options);
  return options.returnMeta ? result : result.content;
}

async function testConnection(userDataPath, options = {}) {
  const config = readConfig(userDataPath);
  if (!config.model && !aiCli.isCliProvider(config.provider)) throw new Error("Önce Ayarlar bölümünden bir AI modeli yapılandır.");
  const messages = [
    { role: "system", content: "You are a connectivity test. Reply with only OK." },
    { role: "user", content: "OK yaz." },
  ];
  const requestOptions = { temperature: 0, maxTokens: 12, timeoutMs: 60000, retryDelaysMs: options.retryDelaysMs };
  if (aiCli.isCliProvider(config.provider)) {
    try {
      const primary = await requestTextCompletion(config, messages, { ...requestOptions, allowFallback: false });
      return {
        ok: true,
        reply: primary.content.trim().slice(0, 80),
        fallback: null,
        config: getConfig(userDataPath),
      };
    } catch (error) {
      const failure = new Error(`Codex CLI bağlantı testi başarısız: ${String(error?.message ?? error).slice(0, 600)}`);
      failure.code = error?.code;
      failure.cause = error;
      throw failure;
    }
  }
  const testModel = async (label, model) => {
    try {
      const result = await requestModelCompletion({ ...config, model, fallbackModel: "" }, messages, requestOptions);
      return throwIfOutputLimited(config, result);
    } catch (error) {
      const failure = new Error(`${label} (${model}) bağlantı testi başarısız: ${String(error?.message ?? error).slice(0, 600)}`);
      failure.code = error?.code;
      failure.cause = error;
      throw failure;
    }
  };

  const primary = await testModel("Ana metin modeli", config.model);
  const fallbackModel = configuredFallbackModel(config);
  const fallback = fallbackModel ? await testModel("Yedek metin modeli", fallbackModel) : null;
  return {
    ok: true,
    reply: primary.content.trim().slice(0, 80),
    fallback: fallback ? { model: fallback.model, reply: fallback.content.trim().slice(0, 80) } : null,
    config: getConfig(userDataPath),
  };
}

module.exports = {
  authHeaders,
  chat,
  fetchWithTransientRetry,
  geminiApiBase,
  geminiHeaders,
  isGeminiApiEndpoint,
  isTransientFetchError,
  listModels,
  modelId,
  modelSignalsImage,
  modelListConfig,
  normalizeListedModels,
  parseAssistantJson,
  requestModelCompletion,
  requestGeminiContent,
  requestTextCompletion,
  testConnection,
};
