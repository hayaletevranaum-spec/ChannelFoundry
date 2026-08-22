const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_LANGUAGE = "tr";
const DEFAULT_SUBTITLE_LANGUAGES = ["tr", "en"];
const THUMBNAIL_SIZES = new Set(["small", "standard", "large"]);

let dataRoot = "";
let notify = () => undefined;
let operation = null;
let operationTimer = null;
let automaticTimer = null;

function resolveFetch() {
  try {
    const { net } = require("electron");
    if (net && typeof net.fetch === "function") return net.fetch.bind(net);
  } catch {}
  return globalThis.fetch.bind(globalThis);
}

function configure(userDataPath, onChange) {
  dataRoot = path.join(String(userDataPath), "tools", "yt-dlp");
  notify = typeof onChange === "function" ? onChange : () => undefined;
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
}

function ensureConfigured() {
  if (!dataRoot) throw new Error("yt-dlp yönetim alanı henüz hazırlanmadı.");
}

function settingsFile() {
  ensureConfigured();
  return path.join(dataRoot, "settings.json");
}

function managedExecutable() {
  ensureConfigured();
  return path.join(dataRoot, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function executablePath() {
  if (dataRoot) {
    const managed = managedExecutable();
    if (fs.existsSync(managed)) return managed;
  }
  return "yt-dlp";
}

function defaultSettings() {
  return {
    autoCheck: false,
    autoUpdate: false,
    lastCheckedAt: "",
    lastUpdatedAt: "",
    latestVersion: "",
    lastError: "",
    metadataLanguage: DEFAULT_METADATA_LANGUAGE,
    subtitleLanguages: [...DEFAULT_SUBTITLE_LANGUAGES],
    thumbnailSize: "standard",
  };
}

function normalizeMetadataLanguage(value) {
  const language = String(value ?? DEFAULT_METADATA_LANGUAGE).trim();
  if (language === "original") return language;
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language) ? language : DEFAULT_METADATA_LANGUAGE;
}

function normalizeSubtitleLanguages(value) {
  const requested = Array.isArray(value) ? value : String(value ?? "").split(",");
  const languages = [];
  for (const item of requested) {
    const language = String(item ?? "").trim();
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language) || languages.includes(language)) continue;
    languages.push(language);
    if (languages.length === 4) break;
  }
  return languages.length ? languages : [...DEFAULT_SUBTITLE_LANGUAGES];
}

function normalizeThumbnailSize(value) {
  const size = String(value ?? "standard");
  return THUMBNAIL_SIZES.has(size) ? size : "standard";
}

function readSettings() {
  const fallback = defaultSettings();
  if (!dataRoot || !fs.existsSync(settingsFile())) return fallback;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    const autoUpdate = Boolean(raw?.autoUpdate);
    return {
      autoCheck: Boolean(raw?.autoCheck) || autoUpdate,
      autoUpdate,
      lastCheckedAt: String(raw?.lastCheckedAt || ""),
      lastUpdatedAt: String(raw?.lastUpdatedAt || ""),
      latestVersion: String(raw?.latestVersion || ""),
      lastError: String(raw?.lastError || ""),
      metadataLanguage: normalizeMetadataLanguage(raw?.metadataLanguage),
      subtitleLanguages: normalizeSubtitleLanguages(raw?.subtitleLanguages),
      thumbnailSize: normalizeThumbnailSize(raw?.thumbnailSize),
    };
  } catch {
    return fallback;
  }
}

function mediaOptions() {
  const settings = readSettings();
  return {
    metadataLanguage: settings.metadataLanguage,
    subtitleLanguages: [...settings.subtitleLanguages],
    thumbnailSize: settings.thumbnailSize,
  };
}

function writeSettings(settings) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return settings;
}

function versionParts(value) {
  return String(value || "").replace(/^v/i, "").split(/[^0-9]+/).filter(Boolean).map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function inspectExecutable(file, source) {
  try {
    const result = await execFileAsync(file, ["--version"], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
    const version = String(result.stdout || "").trim();
    if (!version) throw new Error("Sürüm bilgisi alınamadı.");
    return { available: true, version, source, path: file, error: "" };
  } catch (error) {
    return { available: false, version: "", source: "none", path: "", error: error?.code === "ENOENT" ? "" : String(error?.message || error) };
  }
}

async function localStatus() {
  if (dataRoot) {
    const managed = managedExecutable();
    if (fs.existsSync(managed)) {
      const result = await inspectExecutable(managed, "managed");
      if (result.available) return result;
    }
  }
  return inspectExecutable("yt-dlp", "system");
}

function platformAsset() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux" && process.arch === "x64") return "yt-dlp_linux";
  if (process.platform === "linux" && process.arch === "arm64") return "yt-dlp_linux_aarch64";
  throw new Error(`Bu platform için yönetilen yt-dlp kurulumu desteklenmiyor: ${process.platform}/${process.arch}`);
}

function platformLabel() {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "linux") return `Linux ${process.arch}`;
  return `${process.platform} ${process.arch}`;
}

async function status() {
  const settings = readSettings();
  const local = await localStatus();
  const updateAvailable = Boolean(settings.latestVersion && (!local.available || compareVersions(settings.latestVersion, local.version) > 0));
  return {
    ...local,
    platform: platformLabel(),
    supported: process.platform === "win32" || process.platform === "linux" && ["x64", "arm64"].includes(process.arch),
    latestVersion: settings.latestVersion,
    updateAvailable,
    autoCheck: settings.autoCheck,
    autoUpdate: settings.autoUpdate,
    lastCheckedAt: settings.lastCheckedAt,
    lastUpdatedAt: settings.lastUpdatedAt,
    lastError: settings.lastError,
    metadataLanguage: settings.metadataLanguage,
    subtitleLanguages: [...settings.subtitleLanguages],
    thumbnailSize: settings.thumbnailSize,
    phase: operation?.phase || (settings.lastError ? "error" : "idle"),
    message: operation?.message || (updateAvailable ? `yt-dlp ${settings.latestVersion} güncellemesi hazır.` : ""),
  };
}

function emit() {
  try { notify(); } catch {}
}

function setOperation(phase, message) {
  if (operationTimer) clearTimeout(operationTimer);
  operationTimer = null;
  operation = { phase, message };
  emit();
}

function clearOperationLater() {
  const completedOperation = operation;
  if (operationTimer) clearTimeout(operationTimer);
  operationTimer = setTimeout(() => {
    if (operation === completedOperation) operation = null;
    operationTimer = null;
    emit();
  }, 1200);
  operationTimer.unref?.();
}

async function fetchLatestRelease() {
  const response = await resolveFetch()(RELEASE_API, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ChannelFoundry-Studio" },
  });
  if (!response.ok) throw new Error(`GitHub sürüm denetimi ${response.status} yanıtı verdi.`);
  const payload = await response.json();
  const assetName = platformAsset();
  const asset = Array.isArray(payload?.assets) ? payload.assets.find((entry) => entry?.name === assetName) : null;
  const checksums = Array.isArray(payload?.assets) ? payload.assets.find((entry) => entry?.name === "SHA2-256SUMS") : null;
  if (!asset?.browser_download_url) throw new Error(`${assetName} resmî sürüm dosyası bulunamadı.`);
  if (!checksums?.browser_download_url) throw new Error("Resmî yt-dlp SHA-256 doğrulama dosyası bulunamadı.");
  return {
    version: String(payload?.tag_name || "").replace(/^v/i, ""),
    url: asset.browser_download_url,
    assetName,
    checksumUrl: checksums.browser_download_url,
  };
}

async function expectedChecksum(release) {
  const response = await resolveFetch()(release.checksumUrl, {
    cache: "no-store",
    headers: { "User-Agent": "ChannelFoundry-Studio" },
  });
  if (!response.ok) throw new Error(`yt-dlp doğrulama dosyası ${response.status} yanıtı verdi.`);
  const lines = String(await response.text()).split(/\r?\n/);
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    const filename = String(fields.at(-1) || "").replace(/^\*/, "");
    if (filename === release.assetName && /^[a-f0-9]{64}$/i.test(fields[0] || "")) return fields[0].toLowerCase();
  }
  throw new Error(`${release.assetName} için resmî SHA-256 özeti bulunamadı.`);
}

function atomicReplace(temporary, target) {
  const backup = `${target}.previous`;
  fs.rmSync(backup, { force: true });
  const hadTarget = fs.existsSync(target);
  if (hadTarget) fs.renameSync(target, backup);
  try {
    fs.renameSync(temporary, target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(target, { force: true });
    if (hadTarget && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

async function installRelease(release) {
  ensureConfigured();
  const target = managedExecutable();
  const temporary = process.platform === "win32" ? `${target}.download.exe` : `${target}.download`;
  fs.rmSync(temporary, { force: true });
  setOperation("downloading", `yt-dlp ${release.version} indiriliyor…`);
  try {
    const checksum = await expectedChecksum(release);
    const response = await resolveFetch()(release.url, { cache: "no-store", headers: { "User-Agent": "ChannelFoundry-Studio" } });
    if (!response.ok) throw new Error(`yt-dlp indirmesi ${response.status} yanıtı verdi.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024 * 1024 || bytes.length > 200 * 1024 * 1024) throw new Error("İndirilen yt-dlp dosyasının boyutu beklenen aralıkta değil.");
    const actualChecksum = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualChecksum !== checksum) throw new Error("İndirilen yt-dlp dosyasının SHA-256 doğrulaması başarısız oldu.");
    fs.writeFileSync(temporary, bytes, { mode: process.platform === "win32" ? 0o600 : 0o755 });
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o755);

    setOperation("installing", `yt-dlp ${release.version} doğrulanıyor ve kuruluyor…`);
    const verified = await inspectExecutable(temporary, "managed");
    if (!verified.available) throw new Error(verified.error || "İndirilen yt-dlp çalıştırılamadı.");
    atomicReplace(temporary, target);
    const settings = readSettings();
    writeSettings({
      ...settings,
      latestVersion: verified.version,
      lastCheckedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      lastError: "",
    });
    setOperation("complete", `yt-dlp ${verified.version} kuruldu.`);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    const settings = readSettings();
    writeSettings({ ...settings, lastError: String(error?.message || error) });
    setOperation("error", `yt-dlp güncellenemedi: ${error?.message || error}`);
    throw error;
  } finally {
    clearOperationLater();
  }
  return status();
}

async function installOrUpdate() {
  if (operation && !["complete", "error"].includes(operation.phase)) return status();
  writeSettings({ ...readSettings(), lastError: "" });
  setOperation("checking", "Resmî yt-dlp sürümü denetleniyor…");
  try {
    return await installRelease(await fetchLatestRelease());
  } catch (error) {
    if (operation?.phase !== "error") {
      const settings = readSettings();
      writeSettings({ ...settings, lastCheckedAt: new Date().toISOString(), lastError: String(error?.message || error) });
      setOperation("error", `yt-dlp kurulamadı: ${error?.message || error}`);
      clearOperationLater();
    }
    throw error;
  }
}

async function checkForUpdates(options = {}) {
  if (operation && !["complete", "error"].includes(operation.phase)) return status();
  writeSettings({ ...readSettings(), lastError: "" });
  setOperation("checking", "yt-dlp güncellemesi denetleniyor…");
  try {
    const release = await fetchLatestRelease();
    const settings = readSettings();
    writeSettings({ ...settings, latestVersion: release.version, lastCheckedAt: new Date().toISOString(), lastError: "" });
    const local = await localStatus();
    const updateAvailable = !local.available || compareVersions(release.version, local.version) > 0;
    if (updateAvailable && settings.autoUpdate && options.allowAutoUpdate !== false) return installRelease(release);
    setOperation("complete", updateAvailable ? `yt-dlp ${release.version} güncellemesi hazır.` : `yt-dlp ${local.version} güncel.`);
    clearOperationLater();
    return status();
  } catch (error) {
    const settings = readSettings();
    writeSettings({ ...settings, lastCheckedAt: new Date().toISOString(), lastError: String(error?.message || error) });
    setOperation("error", `Güncelleme denetlenemedi: ${error?.message || error}`);
    clearOperationLater();
    throw error;
  }
}

async function saveOptions(input) {
  const current = readSettings();
  const autoUpdate = input?.autoUpdate === undefined ? current.autoUpdate : Boolean(input.autoUpdate);
  const requestedAutoCheck = input?.autoCheck === undefined ? current.autoCheck : Boolean(input.autoCheck);
  const autoCheck = requestedAutoCheck || autoUpdate;
  const metadataLanguage = normalizeMetadataLanguage(input?.metadataLanguage ?? current.metadataLanguage);
  const subtitleLanguages = normalizeSubtitleLanguages(input?.subtitleLanguages ?? current.subtitleLanguages);
  const thumbnailSize = normalizeThumbnailSize(input?.thumbnailSize ?? current.thumbnailSize);
  writeSettings({ ...current, autoCheck, autoUpdate, metadataLanguage, subtitleLanguages, thumbnailSize, lastError: "" });
  emit();
  if (autoCheck && (!current.autoCheck || autoUpdate && !current.autoUpdate)) {
    setTimeout(() => { void checkForUpdates().catch(() => undefined); }, 250);
  }
  return status();
}

function automaticCheckDue() {
  const settings = readSettings();
  if (!settings.autoCheck) return false;
  const last = Date.parse(settings.lastCheckedAt || "");
  return !Number.isFinite(last) || Date.now() - last >= CHECK_INTERVAL_MS;
}

function runAutomaticCheck() {
  if (automaticCheckDue()) void checkForUpdates().catch(() => undefined);
}

function startAutomaticTasks() {
  if (automaticTimer) return;
  setTimeout(runAutomaticCheck, 4000);
  automaticTimer = setInterval(runAutomaticCheck, 6 * 60 * 60 * 1000);
  automaticTimer.unref?.();
}

module.exports = {
  checkForUpdates,
  configure,
  executablePath,
  installOrUpdate,
  mediaOptions,
  saveOptions,
  startAutomaticTasks,
  status,
};
