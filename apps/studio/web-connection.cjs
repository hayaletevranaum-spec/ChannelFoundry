const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WEB_URL = "http://localhost:5173";
const DEFAULT_YOUTUBE_CHANNEL_URL = "";
let configFile = "";

function resolveFetch() {
  try {
    const { net } = require("electron");
    if (net && typeof net.fetch === "function") return net.fetch.bind(net);
  } catch {}
  return globalThis.fetch.bind(globalThis);
}

function configure(userDataPath) {
  configFile = path.join(String(userDataPath), "web-connection.json");
}

function normalizeWebUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Web sayfası adresi gerekli.");
  let url;
  try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch {
    throw new Error("Geçerli bir web sayfası adresi gir.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Web adresi HTTP veya HTTPS olmalıdır.");
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol === "http:" && !localHost) throw new Error("Uzak web sunucusu HTTPS kullanmalıdır.");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function normalizeYoutubeChannelUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("YouTube kanal adresi gerekli.");
  let url;
  try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch {
    throw new Error("Geçerli bir YouTube kanal adresi gir.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") throw new Error("Yalnız YouTube kanal adresleri destekleniyor.");
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] || "";
  if (!(first.startsWith("@") || ["channel", "user", "c"].includes(first))) {
    throw new Error("Kanal adresi @kanal, /channel/, /user/ veya /c/ biçiminde olmalıdır.");
  }
  const baseParts = first.startsWith("@") ? [first] : parts.slice(0, 2);
  if (!baseParts.join("").trim()) throw new Error("YouTube kanal yolu eksik.");
  url.protocol = "https:";
  url.hostname = "www.youtube.com";
  url.pathname = `/${baseParts.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function readStoredConfig() {
  if (!configFile || !fs.existsSync(configFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(configFile, "utf8"));
    return {
      url: raw?.url ? normalizeWebUrl(raw.url) : "",
      youtubeChannelUrl: raw?.youtubeChannelUrl ? normalizeYoutubeChannelUrl(raw.youtubeChannelUrl) : "",
    };
  } catch {
    return {};
  }
}

function webUrl() {
  return normalizeWebUrl(process.env.CHANNEL_FOUNDRY_WEB_URL || readStoredConfig().url || DEFAULT_WEB_URL);
}

function youtubeChannelUrl() {
  const configured = readStoredConfig().youtubeChannelUrl || DEFAULT_YOUTUBE_CHANNEL_URL;
  if (!configured) return "";
  return normalizeYoutubeChannelUrl(configured);
}

function childUrl(relativePath, base = webUrl()) {
  return new URL(String(relativePath).replace(/^\/+/, ""), `${normalizeWebUrl(base)}/`).toString();
}

function endpoints(base = webUrl()) {
  return {
    community: childUrl("api/community/", base),
    studio: childUrl("api/studio/", base),
    publicationAsset: childUrl("api/studio/asset.php", base),
    publication: childUrl("content/publication.json", base),
  };
}

function getConfig() {
  const url = webUrl();
  return {
    url,
    defaultUrl: DEFAULT_WEB_URL,
    customized: url !== DEFAULT_WEB_URL,
    environmentOverride: Boolean(process.env.CHANNEL_FOUNDRY_WEB_URL),
    youtubeChannelUrl: youtubeChannelUrl(),
    endpoints: endpoints(url),
  };
}

function saveConfig(input) {
  if (!configFile) throw new Error("Web bağlantısı depolama alanı henüz hazırlanmadı.");
  const stored = readStoredConfig();
  const url = process.env.CHANNEL_FOUNDRY_WEB_URL
    ? normalizeWebUrl(stored.url || DEFAULT_WEB_URL)
    : normalizeWebUrl(input?.url);
  const candidateYoutubeChannelUrl = input?.youtubeChannelUrl || stored.youtubeChannelUrl || DEFAULT_YOUTUBE_CHANNEL_URL;
  const nextYoutubeChannelUrl = candidateYoutubeChannelUrl ? normalizeYoutubeChannelUrl(candidateYoutubeChannelUrl) : "";
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile, `${JSON.stringify({ version: 2, url, youtubeChannelUrl: nextYoutubeChannelUrl }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(configFile, 0o600); } catch {}
  return getConfig();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await resolveFetch()(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json, text/html;q=0.9, */*;q=0.8" },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Web sunucusu 15 saniye içinde yanıt vermedi.");
    throw new Error(`Web sunucusuna bağlanılamadı: ${error?.cause?.message || error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function healthPayload(url, expectedService) {
  const target = new URL(url);
  target.searchParams.set("action", "health");
  const response = await fetchWithTimeout(target);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${target.pathname} ${response.status} yanıtı verdi.`);
  if (!payload?.ok || payload?.service !== expectedService) {
    throw new Error(`${target.pathname} uyumlu bir Channel Foundry servisi değil.`);
  }
  return { ok: true, service: String(payload.service), status: response.status };
}

async function testConnection(input) {
  const url = normalizeWebUrl(input?.url || webUrl());
  const startedAt = Date.now();
  const page = await fetchWithTimeout(url);
  if (!page.ok) throw new Error(`Web sayfası ${page.status} yanıtı verdi.`);
  if (page.body) await page.body.cancel().catch(() => undefined);
  const derived = endpoints(url);
  const [studio, community] = await Promise.all([
    healthPayload(derived.studio, "channel-foundry-studio-publish-v2"),
    healthPayload(derived.community, "channel-foundry-community"),
  ]);
  return {
    ok: true,
    url,
    pageStatus: page.status,
    studio,
    community,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_WEB_URL,
  DEFAULT_YOUTUBE_CHANNEL_URL,
  childUrl,
  configure,
  endpoints,
  getConfig,
  normalizeWebUrl,
  normalizeYoutubeChannelUrl,
  saveConfig,
  testConnection,
  webUrl,
  youtubeChannelUrl,
};
