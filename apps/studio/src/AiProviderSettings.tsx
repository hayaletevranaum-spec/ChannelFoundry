import { useEffect, useMemo, useState } from "react";
import "./ai-provider-settings.css";

type ProviderChoice = "google-ai-studio" | "ollama" | "openai-compatible" | "codex-cli";
type ImageProviderChoice = "main" | "cloudflare-workers-ai" | "openai-compatible" | "codex-cli" | "disabled";
type ExtendedConfig = StudioAiConfig & { timeoutSeconds?: number };
type ModelCatalog = {
  models: StudioAiModelCatalogEntry[];
  textModels: string[];
  imageModels: string[];
  defaultModel?: string;
  config: ExtendedConfig;
};
type ImageModelCatalog = {
  provider: StudioAiImageProvider;
  models: Array<{ id: string; label: string }>;
  imageModels: string[];
  defaultModel?: string;
  config: ExtendedConfig;
};
type TextModelCatalogRequest = {
  provider: StudioAiProvider;
  endpoint: string;
  apiKey?: string;
  timeoutSeconds?: number;
};
type ImageModelCatalogRequest = TextModelCatalogRequest & {
  imageProvider: StudioAiImageProvider;
  imageEndpoint: string;
  imageApiKey?: string;
};
type ExtendedBridge = NonNullable<typeof window.channelFoundryStudio> & {
  aiModels(input?: TextModelCatalogRequest): Promise<ModelCatalog>;
  aiImageModels(input?: ImageModelCatalogRequest): Promise<ImageModelCatalog>;
  aiCliStatus(): Promise<StudioAiCliStatus>;
};

const GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_API_HOST = "generativelanguage.googleapis.com";
const OLLAMA_ENDPOINT = "http://127.0.0.1:11434/v1";
const CLOUDFLARE_ENDPOINT_PLACEHOLDER = "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai";
const FALLBACK_CODEX_REASONING_EFFORTS: StudioCodexReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const CODEX_REASONING_LABELS: Record<string, string> = {
  none: "Yok",
  minimal: "Minimal",
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  xhigh: "Çok yüksek",
  max: "Maksimum",
  ultra: "Ultra",
};
const CODEX_REASONING_DESCRIPTIONS: Record<string, string> = {
  none: "Ek reasoning kullanılmaz; en hızlı yanıta öncelik verir.",
  minimal: "Çok hafif reasoning ile hız odaklı çalışır.",
  low: "Daha hızlı yanıt için hafif reasoning kullanır.",
  medium: "Hız ve reasoning derinliğini dengeler.",
  high: "Karmaşık işler için daha derin reasoning kullanır.",
  xhigh: "Zor işler için çok yüksek reasoning derinliği kullanır.",
  max: "En zor işler için maksimum reasoning derinliği kullanır.",
  ultra: "Maksimum reasoning ve modelin desteklediği gelişmiş yürütme davranışını kullanır.",
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isGoogleAiStudioEndpoint(value: string) {
  try {
    const endpoint = new URL(String(value || ""));
    return endpoint.protocol === "https:"
      && endpoint.hostname.toLowerCase() === GOOGLE_API_HOST
      && /^\/v1(?:beta|alpha)?(?:\/openai)?\/?$/i.test(endpoint.pathname);
  } catch {
    return false;
  }
}

function inferChoice(config: StudioAiConfig): ProviderChoice {
  if (config.provider === "codex-cli") return "codex-cli";
  if (config.provider === "ollama") return "ollama";
  if (isGoogleAiStudioEndpoint(config.endpoint)) return "google-ai-studio";
  return "openai-compatible";
}

function inferImageChoice(config: StudioAiConfig): ImageProviderChoice {
  if (config.image.mode === "disabled") return "disabled";
  if (config.image.provider === "codex-cli") return "codex-cli";
  if (config.image.provider === "cloudflare-workers-ai") return "cloudflare-workers-ai";
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const imageEndpoint = String(config.image.endpoint || "").replace(/\/+$/, "");
  if (!imageEndpoint || imageEndpoint === endpoint) return "main";
  return "openai-compatible";
}

function providerLabel(choice: ProviderChoice) {
  if (choice === "google-ai-studio") return "Google AI Studio (Gemini)";
  if (choice === "codex-cli") return "Codex CLI · ChatGPT hesabı";
  if (choice === "ollama") return "Ollama · yerel";
  return "Özel OpenAI uyumlu servis";
}

function reasoningLabel(value: string) {
  return CODEX_REASONING_LABELS[value] ? `${CODEX_REASONING_LABELS[value]} (${value})` : value;
}

function selectedCodexModel(models: StudioAiModelCatalogEntry[], model: string) {
  return models.find((entry) => entry.id === model) || (!model ? models.find((entry) => entry.isDefault) : undefined);
}

function ModelPicker(props: { value: string; options: string[]; onChange(value: string): void; placeholder: string }) {
  const options = Array.from(new Set(props.options.filter(Boolean)));
  const listed = Boolean(props.value && options.includes(props.value));
  if (!options.length) {
    return <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder}/>;
  }
  return <>
    <select value={listed ? props.value : "__custom"} onChange={(event) => props.onChange(event.target.value === "__custom" ? "" : event.target.value)}>
      <option value="__custom">Model kimliğini elle gir…</option>
      {options.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
    </select>
    {!listed && <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder}/>}
  </>;
}

export default function AiProviderSettings() {
  const bridge = window.channelFoundryStudio as ExtendedBridge | undefined;
  const [config, setConfig] = useState<ExtendedConfig | null>(null);
  const [cliStatus, setCliStatus] = useState<StudioAiCliStatus | null>(null);
  const [choice, setChoice] = useState<ProviderChoice>("ollama");
  const [endpoint, setEndpoint] = useState(OLLAMA_ENDPOINT);
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<StudioCodexReasoningEffort | "">("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [googleQuickstart, setGoogleQuickstart] = useState("");
  const [parsedGoogleQuickstart, setParsedGoogleQuickstart] = useState("");
  const [quickstartDetails, setQuickstartDetails] = useState<{ endpoint: string; model: string } | null>(null);
  const [quickstartError, setQuickstartError] = useState<string | null>(null);
  const [timeoutSeconds, setTimeoutSeconds] = useState(420);
  const [imageChoice, setImageChoice] = useState<ImageProviderChoice>("main");
  const [imageMode, setImageMode] = useState<StudioAiImageMode>("auto");
  const [imageEndpoint, setImageEndpoint] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [showImageApiKey, setShowImageApiKey] = useState(false);
  const [textModels, setTextModels] = useState<string[]>([]);
  const [codexModels, setCodexModels] = useState<StudioAiModelCatalogEntry[]>([]);
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [textModelCount, setTextModelCount] = useState(0);
  const [imageModelCount, setImageModelCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [modelDiscoveryBusy, setModelDiscoveryBusy] = useState<"text" | "image" | null>(null);
  const [secretBusy, setSecretBusy] = useState<"text" | "image" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyConfig = (next: ExtendedConfig) => {
    const nextChoice = inferChoice(next);
    setConfig(next);
    setChoice(nextChoice);
    setEndpoint(next.endpoint || (nextChoice === "ollama" ? OLLAMA_ENDPOINT : ""));
    setModel(next.model || "");
    setReasoningEffort(next.reasoningEffort || "");
    setFallbackModel(next.fallbackModel || "");
    setQuickstartDetails(null);
    setQuickstartError(null);
    setTimeoutSeconds(Math.max(30, Math.min(1800, Number(next.timeoutSeconds ?? 420))));
    setImageChoice(inferImageChoice(next));
    setImageMode(next.image?.mode ?? "auto");
    setImageEndpoint(next.image?.endpoint ?? "");
    setImageModel(next.image?.model ?? "");
  };

  useEffect(() => {
    if (!bridge) return;
    void bridge.aiConfig().then((next) => applyConfig(next as ExtendedConfig)).catch((reason) => setError(errorText(reason)));
    void bridge.aiCliStatus().then(setCliStatus).catch(() => setCliStatus(null));
  }, []);

  const changeChoice = (next: ProviderChoice) => {
    setChoice(next);
    setError(null);
    setMessage(null);
    setTextModels([]);
    setCodexModels([]);
    setTextModelCount(0);
    setModel("");
    setFallbackModel("");
    setGoogleQuickstart("");
    setParsedGoogleQuickstart("");
    setQuickstartDetails(null);
    setQuickstartError(null);
    if (next === "codex-cli") {
      setEndpoint("");
      setFallbackModel("");
      setApiKey("");
      setTimeoutSeconds((current) => Math.max(420, current));
      if (imageChoice === "main") {
        setImageChoice("codex-cli");
        setImageMode("enabled");
        setImageEndpoint("");
        setImageModel("");
        setImageApiKey("");
      }
      return;
    }
    if (next === "google-ai-studio") {
      setEndpoint(GOOGLE_ENDPOINT);
      if (imageChoice === "main") {
        setImageEndpoint(GOOGLE_ENDPOINT);
        setImageMode("enabled");
        setImageModel("");
        setImageModels([]);
        setImageModelCount(0);
      }
      setTimeoutSeconds((current) => Math.max(120, current));
      return;
    }
    if (next === "ollama") {
      setEndpoint(OLLAMA_ENDPOINT);
      if (imageChoice === "main") {
        setImageEndpoint(OLLAMA_ENDPOINT);
        setImageModel("");
        setImageModels([]);
        setImageModelCount(0);
      }
      setTimeoutSeconds((current) => Math.max(420, current));
      return;
    }
    if (endpoint === GOOGLE_ENDPOINT || endpoint === OLLAMA_ENDPOINT) setEndpoint("");
    if (imageChoice === "main") {
      setImageEndpoint("");
      setImageModel("");
      setImageModels([]);
      setImageModelCount(0);
    }
  };

  const changeImageChoice = (next: ImageProviderChoice) => {
    if (next === "main" && choice === "codex-cli") {
      setImageChoice("codex-cli");
      setImageMode("enabled");
      setError("Codex metin bağlantısında görsel üretimi için ayrı Codex CLI görsel sağlayıcısı kullanılır.");
      setMessage(null);
      return;
    }
    setImageChoice(next);
    setError(null);
    setMessage(null);
    setImageModels([]);
    setImageModelCount(0);
    if (next === "codex-cli") {
      setImageMode("enabled");
      setImageEndpoint("");
      setImageModel(choice === "codex-cli" ? model : "");
      setImageApiKey("");
      return;
    }
    if (next === "cloudflare-workers-ai") {
      setImageMode("enabled");
      if (!imageEndpoint.includes("api.cloudflare.com/client/v4/accounts/")) setImageEndpoint("");
      if (!imageModel.startsWith("@cf/")) setImageModel("");
      return;
    }
    if (next === "main") {
      const mainEndpoint = choice === "google-ai-studio" ? endpoint.trim() || GOOGLE_ENDPOINT : endpoint.trim();
      setImageEndpoint(mainEndpoint);
      setImageMode(choice === "google-ai-studio" ? "enabled" : "auto");
      setImageApiKey("");
      setImageModel("");
      return;
    }
    if (next === "disabled") {
      setImageMode("disabled");
      return;
    }
    setImageMode("auto");
    setImageModel("");
    if (imageEndpoint === GOOGLE_ENDPOINT || imageEndpoint.includes("api.cloudflare.com/client/v4/accounts/")) setImageEndpoint("");
  };

  const request = useMemo(() => {
    const provider: StudioAiProvider = choice === "codex-cli" ? "codex-cli" : choice === "ollama" ? "ollama" : "openai-compatible";
    const resolvedEndpoint = choice === "codex-cli" ? "" : choice === "google-ai-studio" ? endpoint.trim() || GOOGLE_ENDPOINT : endpoint.trim();
    const resolvedImageEndpoint = imageChoice === "codex-cli" ? "" : imageChoice === "main" ? resolvedEndpoint : imageEndpoint.trim();
    const resolvedImageProvider: StudioAiImageProvider = imageChoice === "codex-cli"
      ? "codex-cli"
      : imageChoice === "cloudflare-workers-ai" ? "cloudflare-workers-ai" : "openai-compatible";
    const resolvedImageMode: StudioAiImageMode = imageChoice === "disabled"
      ? "disabled"
      : imageChoice === "codex-cli" || imageChoice === "cloudflare-workers-ai" || choice === "google-ai-studio" && imageChoice === "main" ? "enabled" : imageMode;
    const imageProviderChanged = Boolean(config && config.image.provider !== resolvedImageProvider);
    return {
      provider,
      endpoint: resolvedEndpoint,
      model: model.trim(),
      reasoningEffort,
      fallbackModel: fallbackModel.trim(),
      timeoutSeconds: Math.max(30, Math.min(1800, Number(timeoutSeconds) || 420)),
      apiKey: choice === "codex-cli" ? "" : apiKey.trim(),
      ...(choice === "codex-cli" ? { clearApiKey: true } : {}),
      imageMode: resolvedImageMode,
      imageProvider: resolvedImageProvider,
      imageEndpoint: resolvedImageEndpoint,
      imageModel: imageModel.trim(),
      ...(imageChoice === "main" || imageChoice === "disabled" || imageChoice === "codex-cli" || imageProviderChanged && !imageApiKey.trim()
        ? { clearImageApiKey: true }
        : imageApiKey.trim() ? { imageApiKey: imageApiKey.trim() } : {}),
    };
  }, [choice, endpoint, model, reasoningEffort, fallbackModel, apiKey, timeoutSeconds, imageChoice, imageMode, imageEndpoint, imageModel, imageApiKey, config]);

  const validateTextCredentials = (candidate: TextModelCatalogRequest) => {
    if (candidate.provider === "codex-cli") return true;
    if (!candidate.endpoint) { setError("AI endpoint adresi gerekli."); return false; }
    if (candidate.provider !== "ollama" && !candidate.apiKey && !config?.apiKeyConfigured) {
      setError("Metin servisi için API anahtarı gerekli.");
      return false;
    }
    return true;
  };

  const validate = (candidate = request, quickstartParsed = false) => {
    const currentQuickstart = googleQuickstart.trim();
    if (choice === "google-ai-studio" && currentQuickstart && !quickstartParsed && currentQuickstart !== parsedGoogleQuickstart) {
      setError("Yeni cURL Quickstart metnini önce Modelleri getir veya Bağlantıyı dene ile algılat.");
      return false;
    }
    if (!candidate.model && candidate.provider !== "codex-cli") { setError("Metin modeli gerekli."); return false; }
    if (candidate.provider === "codex-cli" && candidate.reasoningEffort) {
      const catalogModel = selectedCodexModel(codexModels, candidate.model);
      const supported = catalogModel?.supportedReasoningEfforts ?? [];
      if (supported.length && !supported.some((option) => option.reasoningEffort === candidate.reasoningEffort)) {
        setError(`${catalogModel?.label || candidate.model} modeli ${reasoningLabel(candidate.reasoningEffort)} reasoning seviyesini desteklemiyor.`);
        return false;
      }
    }
    if (candidate.fallbackModel && candidate.fallbackModel === candidate.model) { setError("Yedek metin modeli ana modelden farklı olmalı."); return false; }
    if (!validateTextCredentials(candidate)) return false;
    if (imageChoice === "cloudflare-workers-ai") {
      if (!candidate.imageEndpoint) { setError("Cloudflare Account ID içeren görsel endpoint'i gerekli."); return false; }
      if (!imageApiKey.trim() && !(config?.image.provider === "cloudflare-workers-ai" && config.image.apiKeyConfigured)) {
        setError("Cloudflare Workers AI API anahtarı gerekli.");
        return false;
      }
    }
    if (imageChoice !== "disabled" && imageChoice !== "codex-cli" && !candidate.imageModel) { setError("Görsel modeli gerekli veya görsel üretimi kapatılmalı."); return false; }
    return true;
  };

  const importGoogleQuickstart = async (value: string) => {
    if (!bridge || !value.trim()) return null;
    setQuickstartError(null);
    try {
      const parsed = await bridge.aiParseGoogleQuickstart(value);
      setChoice("google-ai-studio");
      setEndpoint(parsed.endpoint);
      setModel(parsed.model);
      setApiKey(parsed.apiKey);
      if (imageChoice === "main") setImageEndpoint(parsed.endpoint);
      setParsedGoogleQuickstart(value.trim());
      setQuickstartDetails({ endpoint: parsed.endpoint, model: parsed.model });
      return parsed;
    } catch (reason) {
      setQuickstartDetails(null);
      setQuickstartError(errorText(reason));
      return null;
    }
  };

  const currentQuickstart = async () => {
    const value = googleQuickstart.trim();
    if (choice !== "google-ai-studio" || !value || value === parsedGoogleQuickstart) return null;
    return importGoogleQuickstart(value);
  };

  const requestWithQuickstart = (quickstart: StudioGoogleQuickstart | null) => quickstart ? {
    ...request,
    endpoint: quickstart.endpoint,
    model: quickstart.model,
    apiKey: quickstart.apiKey,
    ...(imageChoice === "main" ? { imageEndpoint: quickstart.endpoint } : {}),
  } : request;

  const persist = async (quickstart: StudioGoogleQuickstart | null = null) => {
    const candidate = requestWithQuickstart(quickstart);
    if (!bridge || !validate(candidate, Boolean(quickstart))) return null;
    const saved = await bridge.aiSaveConfig(candidate) as ExtendedConfig;
    applyConfig(saved);
    setApiKey("");
    setImageApiKey("");
    setShowApiKey(false);
    setShowImageApiKey(false);
    return saved;
  };

  const toggleSecret = async (kind: "text" | "image") => {
    if (!bridge) return;
    const shown = kind === "text" ? showApiKey : showImageApiKey;
    const value = kind === "text" ? apiKey : imageApiKey;
    const configured = kind === "text" ? config?.apiKeyConfigured : config?.image?.apiKeyConfigured;
    const setShown = kind === "text" ? setShowApiKey : setShowImageApiKey;
    const setValue = kind === "text" ? setApiKey : setImageApiKey;
    if (shown) {
      setShown(false);
      return;
    }
    if (value) {
      setShown(true);
      return;
    }
    if (!configured) return;
    setSecretBusy(kind);
    setError(null);
    try {
      setValue(await bridge.aiRevealKey(kind));
      setShown(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSecretBusy(null);
    }
  };

  const loadTextModels = async () => {
    if (!bridge) return;
    setModelDiscoveryBusy("text"); setError(null); setMessage(null);
    try {
      const rawQuickstart = googleQuickstart.trim();
      const needsQuickstartImport = choice === "google-ai-studio" && Boolean(rawQuickstart) && rawQuickstart !== parsedGoogleQuickstart;
      const quickstart = await currentQuickstart();
      if (needsQuickstartImport && !quickstart) return;
      const candidate = requestWithQuickstart(quickstart);
      const catalogRequest: TextModelCatalogRequest = {
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        timeoutSeconds: candidate.timeoutSeconds,
        ...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}),
      };
      if (!validateTextCredentials(catalogRequest)) return;
      const catalog = await bridge.aiModels(catalogRequest);
      setTextModels(catalog.textModels);
      setCodexModels(choice === "codex-cli" ? catalog.models : []);
      setTextModelCount(catalog.textModels.length);
      if (choice === "codex-cli" && !model.trim()) setModel(catalog.defaultModel || catalog.textModels[0] || "");
      if (imageChoice === "main") {
        setImageModels(catalog.imageModels);
        setImageModelCount(catalog.imageModels.length);
      }
      setMessage(choice === "codex-cli"
        ? `${catalog.textModels.length} Codex modeli listelendi.`
        : `${catalog.textModels.length} metin modeli listelendi${imageChoice === "main" ? ` · ${catalog.imageModels.length} görsel modeli algılandı` : ""}.`);
    } catch (reason) {
      setError(`Model listesi alınamadı: ${errorText(reason)}`);
    } finally {
      setModelDiscoveryBusy(null);
    }
  };

  const loadImageModels = async () => {
    if (!bridge || imageChoice === "main" || imageChoice === "disabled") return;
    setModelDiscoveryBusy("image"); setError(null); setMessage(null);
    try {
      const catalogRequest: ImageModelCatalogRequest = {
        provider: request.provider,
        endpoint: request.endpoint,
        timeoutSeconds: request.timeoutSeconds,
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        imageProvider: request.imageProvider,
        imageEndpoint: request.imageEndpoint,
        ...(imageApiKey.trim() ? { imageApiKey: imageApiKey.trim() } : {}),
      };
      if (imageChoice !== "codex-cli" && !catalogRequest.imageEndpoint) { setError("Görsel model listesi için endpoint gerekli."); return; }
      const hasSavedImageKey = config?.image?.provider === catalogRequest.imageProvider && config.image.apiKeyConfigured;
      if (catalogRequest.imageProvider === "cloudflare-workers-ai" && !catalogRequest.imageApiKey && !hasSavedImageKey) {
        setError("Cloudflare görsel modellerini getirmek için API anahtarı gerekli.");
        return;
      }
      const catalog = await bridge.aiImageModels(catalogRequest);
      setImageModels(catalog.imageModels);
      setImageModelCount(catalog.imageModels.length);
      if (imageChoice === "codex-cli" && !imageModel.trim()) setImageModel(catalog.defaultModel || catalog.imageModels[0] || "");
      setMessage(imageChoice === "codex-cli"
        ? `${catalog.imageModels.length} Codex yönetici modeli listelendi.`
        : `${catalog.imageModels.length} görsel modeli listelendi.`);
    } catch (reason) {
      setError(`Görsel model listesi alınamadı: ${errorText(reason)}`);
    } finally {
      setModelDiscoveryBusy(null);
    }
  };

  const save = async (test: boolean) => {
    if (!bridge) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const rawQuickstart = googleQuickstart.trim();
      const needsQuickstartImport = choice === "google-ai-studio" && Boolean(rawQuickstart) && rawQuickstart !== parsedGoogleQuickstart;
      const quickstart = await currentQuickstart();
      if (needsQuickstartImport && !quickstart) return;
      const saved = await persist(quickstart);
      if (!saved) return;
      if (test) {
        const tested = await bridge.aiTest();
        applyConfig(tested.config as ExtendedConfig);
        const fallbackReply = tested.fallback ? ` · Yedek bağlantısı başarılı: ${tested.fallback.model} · ${tested.fallback.reply || "OK"}` : "";
        const testedModel = tested.config.model || (tested.config.provider === "codex-cli" ? "CLI varsayılanı" : "model");
        setMessage(`Bağlantı başarılı · ${providerLabel(choice)} · ${testedModel} · ${tested.reply || "OK"}${fallbackReply}`);
      } else {
        setMessage(`${providerLabel(choice)} ve görsel üretim ayarları kaydedildi.`);
      }
      await bridge.refreshMain();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!bridge) return null;

  const configuredChoice = config ? inferChoice(config) : null;
  const textOptions = Array.from(new Set([model, fallbackModel, ...textModels].filter(Boolean)));
  const fallbackTextOptions = textOptions.filter((entry) => entry !== model);
  const imageOptions = Array.from(new Set([imageModel, ...imageModels].filter(Boolean)));
  const configuredReady = Boolean(config?.configured && (configuredChoice !== "codex-cli" || cliStatus?.ready));
  const codexModel = selectedCodexModel(codexModels, model);
  const catalogReasoningEfforts = (codexModel?.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);
  const reasoningOptions = Array.from(new Set<StudioCodexReasoningEffort>([
    ...(catalogReasoningEfforts.length ? catalogReasoningEfforts : FALLBACK_CODEX_REASONING_EFFORTS),
    ...(reasoningEffort ? [reasoningEffort] : []),
  ]));
  const defaultReasoningEffort = codexModel?.defaultReasoningEffort || "";
  const reasoningDescription = reasoningEffort
    ? CODEX_REASONING_DESCRIPTIONS[reasoningEffort] || "Seçilen reasoning seviyesi Codex çağrılarına uygulanır."
    : defaultReasoningEffort
      ? `Model varsayılanı kullanılır: ${reasoningLabel(defaultReasoningEffort)}.`
      : "Boş bırakıldığında seçilen Codex modelinin varsayılan reasoning seviyesi kullanılır.";

  return <section className="ai-provider-panel panel">
    <div className="ai-provider-summary">
      <div>
        <small>AYARLAR / AI</small>
        <strong>AI bağlantısı ve model seçenekleri</strong>
        <span>Metin, anlatı ve görsel üretim servislerini tek panelden yönet.</span>
      </div>
    </div>

    {message && <div className="ai-provider-feedback success">{message}</div>}
    {error && <div className="ai-provider-feedback error">{error}</div>}

    <div className="ai-provider-editor">
      <section className="ai-provider-group ai-provider-status-group">
        <div className="ai-provider-group-head">
          <div><small>AI DURUMU</small><strong>{config?.configured ? configuredChoice ? providerLabel(configuredChoice) : "AI servisi" : "AI yapılandırılmadı"}</strong></div>
          <span>{configuredChoice === "codex-cli"
            ? cliStatus?.ready ? `${cliStatus.version || "Codex CLI"} · oturum açık` : cliStatus?.detail || "Codex CLI durumu denetleniyor"
            : configuredChoice === "google-ai-studio" ? `Gemini API · ${config?.timeoutSeconds ?? 420} sn` : config?.endpoint ? `${config.endpoint} · ${config?.timeoutSeconds ?? 420} sn` : "Servis bağlantısı bekleniyor"}</span>
        </div>
        <div className="ai-provider-facts">
          <div><span>Metin modeli</span><strong>{config?.model || (configuredChoice === "codex-cli" ? "CLI varsayılanı" : "Yapılandırılmadı")}</strong></div>
          {configuredChoice === "codex-cli" && <div><span>Reasoning</span><strong>{config?.reasoningEffort ? reasoningLabel(config.reasoningEffort) : "Model varsayılanı"}</strong></div>}
          <div><span>Yedek model</span><strong>{config?.fallbackModel || "Kapalı"}</strong></div>
          <div><span>Endpoint</span><strong title={config?.endpoint || undefined}>{configuredChoice === "codex-cli" ? "Yerel Codex süreci" : config?.endpoint || "—"}</strong></div>
          <div><span>Görsel modeli</span><strong>{config?.image?.mode === "disabled"
            ? "Kapalı"
            : config?.image?.provider === "codex-cli" ? `Codex yerleşik üretim · ${config.image.model || "CLI varsayılanı"} yönetici` : config?.image?.model || "Prompt / manuel"}</strong></div>
          <div><span>Durum</span><strong className={configuredReady ? "ready" : "warning"}>{configuredReady ? "Hazır" : "Ayar gerekli"}</strong></div>
        </div>
        <p className="ai-provider-local-note"><span className="local-dot"/>AI ayarları, görsel promptları ve yerel varlıklar bu bilgisayarda tutulur; kullanıcı yayınlamadan web'e gönderilmez.</p>
      </section>

      <section className="ai-provider-group">
        <div className="ai-provider-group-head">
          <div><small>METİN / ANLATI</small><strong>Ana AI bağlantısı</strong></div>
          <span>{textModelCount ? `${textModelCount} metin modeli getirildi` : choice === "codex-cli" ? "Kurulu CLI ve mevcut ChatGPT oturumunu kullanır" : "Model kimliği elle girilebilir"}</span>
        </div>
        <div className="ai-provider-grid">
          <label><span>Servis sağlayıcı</span><select value={choice} onChange={(event) => changeChoice(event.target.value as ProviderChoice)}>
            <option value="codex-cli">Codex CLI · ChatGPT hesabı</option>
            <option value="google-ai-studio">Google AI Studio (Gemini)</option>
            <option value="ollama">Ollama · yerel</option>
            <option value="openai-compatible">Özel OpenAI uyumlu servis</option>
          </select></label>
          {choice !== "codex-cli" && <label><span>Endpoint</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} readOnly={choice === "google-ai-studio"} placeholder="https://.../v1"/></label>}
          {choice !== "codex-cli" && <label>
            <span>{choice === "google-ai-studio" ? "Google AI Studio API anahtarı" : "API anahtarı"}</span>
            <div className="ai-secret-field">
              <input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder={config?.apiKeyConfigured ? "••••••••••••" : choice === "ollama" ? "Yerel Ollama için boş bırak" : "API anahtarı"}/>
              <div className="ai-secret-actions">
                <button type="button" className="secondary-button" disabled={busy || modelDiscoveryBusy !== null || secretBusy === "text" || (!apiKey && !config?.apiKeyConfigured)} onClick={() => void toggleSecret("text")}>{secretBusy === "text" ? "Açılıyor…" : showApiKey ? "Gizle" : "Göster"}</button>
                <button type="button" className="secondary-button ai-fetch-models-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void loadTextModels()}>{modelDiscoveryBusy === "text" ? "Getiriliyor…" : "Modelleri getir"}</button>
              </div>
            </div>
            <small className="field-note">{choice === "ollama" ? "Yerel model listesini Ollama endpoint'inden alır." : "Anahtar kaydedilmeden, bu sağlayıcıdan erişilebilir modelleri getirir."}</small>
          </label>}
          <label><span>Yanıt bekleme süresi · saniye</span><input type="number" min={30} max={1800} step={30} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))}/><small className="field-note">Uzun video ve Evren Birleştirme işlemleri için 30–1800 sn.</small></label>
          {choice === "google-ai-studio" && <label className="full">
            <span>Google AI Studio cURL Quickstart</span>
            <textarea value={googleQuickstart} onChange={(event) => { setGoogleQuickstart(event.target.value); setParsedGoogleQuickstart(""); setQuickstartDetails(null); setQuickstartError(null); }} autoComplete="off" spellCheck={false} rows={4} placeholder={'Google AI Studio\'daki cURL Quickstart komutunu buraya yapıştır…'}/>
            <small className="field-note">Modelleri getir veya Bağlantıyı dene; komuttaki endpoint, model ve X-goog-api-key algılanır. cURL metni kaydedilmez.</small>
            {quickstartDetails && <small className="ai-quickstart-result">Algılandı · {quickstartDetails.model} · {quickstartDetails.endpoint}</small>}
            {quickstartError && <small className="ai-quickstart-error">{quickstartError}</small>}
          </label>}
          {choice === "codex-cli" ? <label>
            <span>Codex modeli · isteğe bağlı</span>
            <div className="ai-secret-field">
              <div className="ai-model-picker-field"><ModelPicker value={model} options={textOptions} onChange={setModel} placeholder="Boş bırak: Codex CLI varsayılan modeli"/></div>
              <div className="ai-secret-actions"><button type="button" className="secondary-button ai-fetch-models-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void loadTextModels()}>{modelDiscoveryBusy === "text" ? "Getiriliyor…" : "Modelleri getir"}</button></div>
            </div>
            <small className="field-note">{textModelCount ? `${textModelCount} erişilebilir Codex modeli listelendi.` : "Kurulu Codex CLI ve açık ChatGPT oturumundaki modelleri getirir; alan boşsa CLI varsayılanı kullanılır."}</small>
          </label> : <label><span>Metin / anlatı modeli</span><ModelPicker value={model} options={textOptions} onChange={setModel} placeholder={choice === "ollama" ? "Yerel model kimliği" : "Model kimliği"}/><small className="field-note">{textModelCount ? `${textModelCount} erişilebilir model listelendi.` : "Önce Modelleri getir veya model kimliğini elle gir."}</small></label>}
          {choice === "codex-cli" && <label>
            <span>Reasoning seviyesi</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as StudioCodexReasoningEffort | "")}>
              <option value="">Model varsayılanı{defaultReasoningEffort ? ` · ${reasoningLabel(defaultReasoningEffort)}` : ""}</option>
              {reasoningOptions.map((effort) => <option key={effort} value={effort}>{reasoningLabel(effort)}</option>)}
            </select>
            <small className="field-note">{reasoningDescription}</small>
          </label>}
          {choice !== "codex-cli" && <label>
            <span>Yedek metin modeli · isteğe bağlı</span>
            <ModelPicker value={fallbackModel} options={fallbackTextOptions} onChange={setFallbackModel} placeholder="Boş bırak: yedek model kapalı"/>
            <small className="field-note">Ana model token sınırına takılır veya Gemini MAX_TOKENS ile metin döndürmezse, istek aynı bağlantıda bu modelle bir kez yeniden denenir.</small>
          </label>}
        </div>

        {choice === "google-ai-studio" ? <div className="ai-google-note warning">
          <strong>Gemini metin/video ücretsiz kotada çalışabilir; Gemini görsel üretimi ücretli kota ister</strong>
          <span>Gemini görsel modellerinin ücretsiz kotası 0 olabilir. Görsel üretimi için aşağıdan Cloudflare Workers AI seçerek metin tarafındaki Gemini bağlantısını koruyabilirsin.</span>
        </div> : null}
        {choice === "codex-cli" ? <div className={`ai-google-note ${cliStatus?.ready ? "" : "warning"}`}>
          <strong>{cliStatus?.ready ? `Codex CLI hazır · ${cliStatus.version || "oturum açık"}` : "Codex CLI kurulumu veya oturumu gerekli"}</strong>
          <span>{cliStatus?.ready
            ? "Google API anahtarı kullanılmaz. Çözümleme ve Evren Birleştirme salt-okunur geçici oturumda; Codex görselleri ise ayrı, araçları kısıtlanmış geçici App Server oturumunda çalışır."
            : `${cliStatus?.detail || "Codex CLI bulunamadı."} Terminalde codex login komutuyla oturum açıp bu sayfayı yeniden aç.`}</span>
        </div> : null}
      </section>

      <section className="ai-provider-group">
        <div className="ai-provider-group-head">
          <div><small>GÖRSEL ÜRETİM</small><strong>Bağımsız görsel sağlayıcısı</strong></div>
          <span>{imageModelCount ? imageChoice === "codex-cli" ? `${imageModelCount} Codex modeli getirildi` : `${imageModelCount} görsel modeli getirildi` : "Ana servisten bağımsız yapılandırılabilir"}</span>
        </div>
        <div className="ai-provider-grid">
          <label><span>Görsel sağlayıcısı</span><select value={imageChoice} onChange={(event) => changeImageChoice(event.target.value as ImageProviderChoice)}>
            <option value="main" disabled={choice === "codex-cli"}>Ana AI servisini kullan{choice === "codex-cli" ? " · aşağıdaki Codex seçeneğini kullan" : ""}</option>
            <option value="codex-cli">Codex CLI · ChatGPT hesabı</option>
            <option value="cloudflare-workers-ai">Cloudflare Workers AI · ücretsiz kota</option>
            <option value="openai-compatible">Özel OpenAI uyumlu görsel servisi</option>
            <option value="disabled">Görsel üretimi kapalı</option>
          </select></label>
          {imageChoice === "openai-compatible" && <label><span>Yetenek</span><select value={imageMode} onChange={(event) => setImageMode(event.target.value as StudioAiImageMode)}><option value="auto">Otomatik algıla</option><option value="enabled">Manuel etkin</option><option value="disabled">Kapalı</option></select></label>}
          {imageChoice !== "main" && imageChoice !== "disabled" && imageChoice !== "codex-cli" && <label className="full"><span>{imageChoice === "cloudflare-workers-ai" ? "Cloudflare endpoint · Account ID gerekli" : "Görsel endpoint · boşsa ana endpoint"}</span><input value={imageEndpoint} onChange={(event) => setImageEndpoint(event.target.value)} placeholder={imageChoice === "cloudflare-workers-ai" ? CLOUDFLARE_ENDPOINT_PLACEHOLDER : "https://.../v1"}/></label>}
          {imageChoice === "codex-cli" ? <>
            <label><span>Görsel üretim kaynağı</span><input value="Codex CLI yerleşik görsel aracı" readOnly/><small className="field-note">Alt görsel model kimliği Codex App Server olayında bildirilmez.</small></label>
            <label>
              <span>Codex yönetici modeli · isteğe bağlı</span>
              <div className="ai-secret-field">
                <div className="ai-model-picker-field"><ModelPicker value={imageModel} options={imageOptions} onChange={setImageModel} placeholder="Boş bırak: Codex CLI varsayılan modeli"/></div>
                <div className="ai-secret-actions"><button type="button" className="secondary-button ai-fetch-models-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void loadImageModels()}>{modelDiscoveryBusy === "image" ? "Getiriliyor…" : "Modelleri getir"}</button></div>
              </div>
              <small className="field-note">{imageModelCount ? `${imageModelCount} erişilebilir Codex modeli listelendi.` : "Bu model promptu yorumlar ve Codex’in yerleşik görsel aracını çağırır."}</small>
            </label>
          </> : imageChoice !== "disabled" && <label><span>Görsel modeli</span><ModelPicker value={imageModel} options={imageOptions} onChange={setImageModel} placeholder={imageChoice === "cloudflare-workers-ai" ? "@cf/yayıncı/model" : "Görsel model kimliği"}/><small className="field-note">{imageModelCount ? `${imageModelCount} görsel modeli listelendi.` : "Katalogdan seç veya model kimliğini elle gir."}</small></label>}
          {imageChoice !== "main" && imageChoice !== "disabled" && imageChoice !== "codex-cli" && <label>
            <span>{imageChoice === "cloudflare-workers-ai" ? "Cloudflare API anahtarı" : "Görsel API anahtarı · opsiyonel"}</span>
            <div className="ai-secret-field">
              <input type={showImageApiKey ? "text" : "password"} value={imageApiKey} onChange={(event) => setImageApiKey(event.target.value)} autoComplete="off" placeholder={config?.image?.apiKeyConfigured && inferImageChoice(config) === imageChoice ? "••••••••••••" : imageChoice === "cloudflare-workers-ai" ? "Workers AI yetkili API token" : "Ana anahtarı kullanabilir"}/>
              <div className="ai-secret-actions">
                <button type="button" className="secondary-button" disabled={busy || modelDiscoveryBusy !== null || secretBusy === "image" || (!imageApiKey && !config?.image?.apiKeyConfigured)} onClick={() => void toggleSecret("image")}>{secretBusy === "image" ? "Açılıyor…" : showImageApiKey ? "Gizle" : "Göster"}</button>
                <button type="button" className="secondary-button ai-fetch-models-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void loadImageModels()}>{modelDiscoveryBusy === "image" ? "Getiriliyor…" : "Modelleri getir"}</button>
              </div>
            </div>
            <small className="field-note">Görsel sağlayıcının erişilebilir modellerini getirir.</small>
          </label>}
        </div>

        {imageChoice === "cloudflare-workers-ai" && <div className="ai-google-note">
          <strong>Cloudflare Workers AI bağlantısı</strong>
          <span>Endpoint içindeki ACCOUNT_ID ve Workers AI Read yetkili API token hesabından alınır; kullanılabilir modeli katalogdan seçebilirsin.</span>
        </div>}
        {imageChoice === "codex-cli" && <div className={`ai-google-note ${cliStatus?.ready ? "" : "warning"}`}>
          <strong>Codex CLI yerleşik görsel üretimi</strong>
          <span>Seçilen Codex modeli görsel promptunu yorumlayıp yerleşik aracı çağırır. Sonuçta bildirilmeyen bir alt model adı uygulama tarafından varsayılmaz.</span>
        </div>}
      </section>

      <div className="ai-provider-actions">
        <button className="secondary-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void save(false)}>Kaydet</button>
        <button className="primary-button" disabled={busy || modelDiscoveryBusy !== null} onClick={() => void save(true)}>{busy ? "Bağlantı deneniyor…" : "Bağlantıyı dene"}</button>
      </div>
    </div>
  </section>;
}
