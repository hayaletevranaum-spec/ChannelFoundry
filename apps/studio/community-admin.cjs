const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns");
const webConnection = require("./web-connection.cjs");

let credentials = null;
let credentialFile = "";
let credentialStorage = null;
let connectionPromise = null;
let lastConnectionError = "";

try { dns.setDefaultResultOrder("ipv4first"); } catch {}

function resolveFetch() {
  try {
    const { net } = require("electron");
    if (net && typeof net.fetch === "function") return net.fetch.bind(net);
  } catch {}
  return globalThis.fetch.bind(globalThis);
}
const fetchImpl = resolveFetch();

function normalizedEndpoint(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function endpoint() {
  return normalizedEndpoint(process.env.BIRDESENGOR_COMMUNITY_API || webConnection.endpoints().community);
}

function studioEndpoint() {
  return normalizedEndpoint(process.env.BIRDESENGOR_STUDIO_API || webConnection.endpoints().studio);
}

function publicationAssetEndpoint() {
  return process.env.BIRDESENGOR_STUDIO_ASSET_API || webConnection.endpoints().publicationAsset;
}

function publicationUrl() {
  return process.env.BIRDESENGOR_PUBLICATION_URL || webConnection.endpoints().publication;
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function fetchFailure(error, url) {
  const cause = error?.cause;
  const code = String(cause?.code || error?.code || "").trim();
  const detail = String(cause?.message || error?.message || error || "Bilinmeyen ağ hatası").trim();
  let host = String(url);
  try { host = new URL(url).host; } catch {}
  const suffix = code ? ` · ${code}` : "";
  const wrapped = new Error(`Sunucu bağlantısı kurulamadı: ${host}${suffix}. ${detail}`);
  wrapped.code = code || "network_error";
  wrapped.cause = error;
  return wrapped;
}

async function resilientFetch(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 650));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw fetchFailure(lastError, url);
}

async function authorizedRequest(baseUrl, action, options = {}, explicitCredentials = null) {
  if (!explicitCredentials && !credentials) await connectStored();
  const auth = explicitCredentials || credentials;
  if (!auth) throw new Error("Forum yönetici bağlantısı açık değil. Ayarlar'dan yönetici bağlantısını yapılandır.");

  const url = new URL(baseUrl);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }
  const headers = {
    Authorization: basicAuth(auth.username, auth.password),
    Accept: "application/json",
    ...(options.headers || {}),
  };
  let body;
  if (options.form instanceof FormData) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await resilientFetch(url, {
    method: options.method || "GET",
    cache: "no-store",
    headers,
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.message || `Studio servisi ${response.status} yanıtı verdi.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error;
    if (!explicitCredentials && response.status === 401) {
      credentials = null;
      lastConnectionError = message;
    }
    throw error;
  }
  return payload;
}

function request(action, options = {}, explicitCredentials = null) {
  return authorizedRequest(endpoint(), action, options, explicitCredentials);
}

async function authenticate(input) {
  const username = String(input?.username || "").trim();
  const password = String(input?.password || "");
  if (!username || !password) throw new Error("Yönetici kullanıcı adı ve parola gerekli.");
  const nextCredentials = { username, password };
  const result = await request("admin_me", {}, nextCredentials);
  credentials = nextCredentials;
  lastConnectionError = "";
  return result;
}

function configureCredentialStorage(userDataPath, safeStorage) {
  credentialFile = path.join(String(userDataPath), "community-admin.credentials");
  credentialStorage = safeStorage;
}

function encryptionAvailable() {
  try { return Boolean(credentialStorage?.isEncryptionAvailable()); } catch { return false; }
}

function storedCredentials() {
  if (!credentialFile || !fs.existsSync(credentialFile) || !encryptionAvailable()) return null;
  try {
    const record = JSON.parse(fs.readFileSync(credentialFile, "utf8"));
    const decrypted = credentialStorage.decryptString(Buffer.from(String(record?.payload || ""), "base64"));
    const parsed = JSON.parse(decrypted);
    const username = String(parsed?.username || "").trim();
    const password = String(parsed?.password || "");
    return username && password ? { username, password } : null;
  } catch (error) {
    lastConnectionError = `Kayıtlı yönetici bilgileri okunamadı: ${error?.message || error}`;
    return null;
  }
}

function storeCredentials(nextCredentials) {
  if (!credentialFile) throw new Error("Yönetici bağlantısı depolama alanı hazırlanmadı.");
  if (!encryptionAvailable()) throw new Error("İşletim sisteminin güvenli parola saklama servisi kullanılamıyor.");
  const encrypted = credentialStorage.encryptString(JSON.stringify(nextCredentials));
  fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(credentialFile, `${JSON.stringify({ version: 1, payload: encrypted.toString("base64") }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(credentialFile, 0o600); } catch {}
}

async function saveCredentials(input) {
  const username = String(input?.username || "").trim();
  const password = String(input?.password || "");
  const result = await authenticate({ username, password });
  try {
    storeCredentials({ username, password });
  } catch (error) {
    credentials = null;
    throw error;
  }
  return { ...result, session: sessionInfo() };
}

async function connectStored(options = {}) {
  if (credentials && !options.force) return sessionInfo();
  if (connectionPromise) return connectionPromise;
  connectionPromise = (async () => {
    if (options.force) credentials = null;
    const saved = storedCredentials();
    if (!saved) return sessionInfo();
    try {
      await authenticate(saved);
    } catch (error) {
      credentials = null;
      lastConnectionError = String(error?.message || error);
    }
    return sessionInfo();
  })().finally(() => { connectionPromise = null; });
  return connectionPromise;
}

function clearCredentials() {
  credentials = null;
  lastConnectionError = "";
  if (credentialFile && fs.existsSync(credentialFile)) fs.unlinkSync(credentialFile);
  return { ok: true, session: sessionInfo() };
}

function resetConnection() {
  credentials = null;
  lastConnectionError = "";
  return sessionInfo();
}

function sessionInfo() {
  const saved = credentials || storedCredentials();
  return {
    connected: Boolean(credentials),
    configured: Boolean(saved),
    connecting: Boolean(connectionPromise),
    endpoint: endpoint(),
    studioEndpoint: studioEndpoint(),
    publicationAssetEndpoint: publicationAssetEndpoint(),
    publicationUrl: publicationUrl(),
    username: saved?.username || null,
    lastError: lastConnectionError || null,
    secureStorageAvailable: encryptionAvailable(),
  };
}

async function users() {
  return request("admin_users");
}

async function setResearchAccess(input) {
  switch (input?.action) {
    case "createThread": return createThread(input);
    case "forumThreads": return forumThreads();
    case "forumThread": return forumThread(input);
    case "updateThread": return updateThread(input);
    case "deleteThread": return deleteThread(input);
    case "deletePost": return deletePost(input);
    default:
      return request("admin_set_special", {
        method: "POST",
        body: { userId: Number(input?.userId), enabled: Boolean(input?.enabled) },
      });
  }
}

async function setStatus(input) {
  const status = input?.status === "suspended" ? "suspended" : "active";
  return request("admin_set_status", {
    method: "POST",
    body: { userId: Number(input?.userId), status },
  });
}

async function createThread(input) {
  const title = String(input?.title || "").trim();
  const body = String(input?.body || "").trim();
  const visibility = input?.visibility === "special" ? "special" : "community";
  if (!title || !body) throw new Error("Forum başlığı ve mesajı gerekli.");

  const form = new FormData();
  form.set("title", title);
  form.set("body", body);
  form.set("visibility", visibility);

  const attachment = input?.attachment;
  if (attachment?.data) {
    const data = Buffer.from(attachment.data);
    if (data.byteLength > 12 * 1024 * 1024) throw new Error("Forum eki 12 MB sınırını aşıyor.");
    const name = path.basename(String(attachment.name || "dosya"));
    const type = String(attachment.type || "application/octet-stream");
    form.set("attachment", new Blob([data], { type }), name);
  }

  return request("admin_forum_create", { method: "POST", form });
}

async function forumThreads() {
  return request("admin_forum_threads");
}

async function forumThread(input) {
  const threadId = Number(input?.threadId);
  if (!Number.isInteger(threadId) || threadId < 1) throw new Error("Geçerli bir forum konusu gerekli.");
  return request("admin_forum_thread", { query: { id: threadId } });
}

async function updateThread(input) {
  const threadId = Number(input?.threadId);
  if (!Number.isInteger(threadId) || threadId < 1) throw new Error("Geçerli bir forum konusu gerekli.");
  return request("admin_forum_update", {
    method: "POST",
    body: {
      threadId,
      visibility: input?.visibility === "special" ? "special" : "community",
      locked: Boolean(input?.locked),
    },
  });
}

async function deleteThread(input) {
  const threadId = Number(input?.threadId);
  if (!Number.isInteger(threadId) || threadId < 1) throw new Error("Geçerli bir forum konusu gerekli.");
  return request("admin_forum_delete_thread", { method: "POST", body: { threadId } });
}

async function deletePost(input) {
  const postId = Number(input?.postId);
  if (!Number.isInteger(postId) || postId < 1) throw new Error("Geçerli bir forum mesajı gerekli.");
  return request("admin_forum_delete_post", { method: "POST", body: { postId } });
}

async function uploadPublicationAsset(input) {
  if (!credentials) await connectStored();
  if (!credentials) throw new Error("Community yönetici oturumu açık değil.");
  const file = String(input?.file || "").trim();
  const filename = String(input?.filename || "").trim();
  const sha256 = String(input?.sha256 || "").trim().toLowerCase();
  if (!file || !fs.existsSync(file)) throw new Error("Yayınlanacak publication asset dosyası bulunamadı.");
  if (!/^[A-Za-z0-9._-]+\.(png|jpg|webp)$/i.test(filename)) throw new Error("Publication asset dosya adı geçersiz.");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Publication asset SHA-256 değeri geçersiz.");
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("Yayınlanacak görsel 25 MB sınırını aşıyor.");

  const response = await resilientFetch(publicationAssetEndpoint(), {
    method: "PUT",
    cache: "no-store",
    headers: {
      Authorization: basicAuth(credentials.username, credentials.password),
      "Content-Type": "application/octet-stream",
      "X-Birdesengor-Filename": filename,
      "X-Birdesengor-Sha256": sha256,
    },
    body: fs.readFileSync(file),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.message || `Publication asset servisi ${response.status} yanıtı verdi.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }
  if (payload.sha256 !== sha256 || payload.filename !== filename) {
    throw new Error("Sunucudaki publication asset doğrulaması yerel dosyayla eşleşmedi.");
  }
  return payload;
}

async function publishPublication(publication) {
  if (!publication || publication.schemaVersion !== 2) throw new Error("Publication v2 paketi hazırlanamadı.");
  const result = await authorizedRequest(studioEndpoint(), "publish", {
    method: "POST",
    body: { publication },
  });

  const response = await resilientFetch(publicationUrl(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Canlı publication doğrulaması ${response.status} yanıtı verdi.`);
  const live = await response.json().catch(() => null);
  if (!live || live.schemaVersion !== 2
      || live.publication?.id !== result.publicationId
      || live.publication?.contentFingerprint !== result.contentFingerprint) {
    throw new Error("Sunucu publication.json dosyasını yazdı ancak canlı okuma doğrulaması eşleşmedi.");
  }
  return { ...result, verified: true, publicUrl: publicationUrl() };
}

module.exports = {
  configureCredentialStorage,
  connectStored,
  saveCredentials,
  clearCredentials,
  sessionInfo,
  users,
  setResearchAccess,
  setStatus,
  createThread,
  forumThreads,
  forumThread,
  updateThread,
  deleteThread,
  deletePost,
  uploadPublicationAsset,
  publishPublication,
  resetConnection,
};
