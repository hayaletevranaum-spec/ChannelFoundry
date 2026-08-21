const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const ytDlp = require("./ytdlp-manager.cjs");

const execFileAsync = promisify(execFile);

function normalizeChannelUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("YouTube kanal bağlantısı gerekli.");
  let url;
  try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch {
    throw new Error("Geçerli bir YouTube kanal bağlantısı gir.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") throw new Error("Yalnız YouTube kanal bağlantıları destekleniyor.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) throw new Error("YouTube kanal yolu eksik.");
  const first = parts[0] ?? "";
  const valid = first.startsWith("@") || ["channel", "user", "c"].includes(first);
  if (!valid) throw new Error("Kanal bağlantısı @handle, /channel/, /user/ veya /c/ biçiminde olmalı.");
  const baseParts = first.startsWith("@") ? [first] : parts.slice(0, 2);
  url.pathname = `/${baseParts.join("/")}`;
  url.search = "";
  url.hash = "";
  url.hostname = "www.youtube.com";
  return url.toString().replace(/\/$/, "");
}

function fallbackChannelId(url) {
  return `channel-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

function cleanDate(entry) {
  const raw = String(entry?.upload_date ?? "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const timestamp = Number(entry?.timestamp ?? entry?.release_timestamp ?? 0);
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString().slice(0, 10);
  return "";
}

function thumbnailUrls(videoId, size = "standard") {
  const base = `https://i.ytimg.com/vi/${videoId}`;
  if (size === "small") return [`${base}/mqdefault.jpg`, `${base}/hqdefault.jpg`];
  if (size === "large") return [`${base}/maxresdefault.jpg`, `${base}/sddefault.jpg`, `${base}/hqdefault.jpg`];
  return [`${base}/hqdefault.jpg`, `${base}/mqdefault.jpg`];
}

function detailSignature(options = ytDlp.mediaOptions()) {
  return JSON.stringify({
    metadataLanguage: String(options.metadataLanguage || "original"),
    subtitleLanguages: Array.isArray(options.subtitleLanguages) ? options.subtitleLanguages.map(String) : [],
  });
}

function currentDetailSignature() {
  return detailSignature(ytDlp.mediaOptions());
}

function normalizeEntry(entry, channelId, options = ytDlp.mediaOptions()) {
  const videoId = String(entry?.id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const duration = Number(entry?.duration);
  const thumbnails = thumbnailUrls(videoId, options.thumbnailSize);
  return {
    videoId,
    channelId,
    title: String(entry?.title ?? `YouTube ${videoId}`).trim() || `YouTube ${videoId}`,
    publishedAt: cleanDate(entry),
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: thumbnails[0],
    thumbnailUrls: thumbnails,
    thumbnailSize: options.thumbnailSize,
    availability: String(entry?.availability ?? ""),
    liveStatus: String(entry?.live_status ?? ""),
    subtitleStatus: String(entry?.subtitle_status ?? "unknown"),
    subtitleLanguages: Array.isArray(entry?.subtitle_languages) ? entry.subtitle_languages : [],
    automaticCaptionLanguages: Array.isArray(entry?.automatic_caption_languages) ? entry.automatic_caption_languages : [],
    detailSignature: ["manual", "automatic", "none"].includes(String(entry?.subtitle_status)) ? detailSignature(options) : "",
  };
}

async function ytDlpStatus() {
  return ytDlp.status();
}

function catalogArgs(url, mode = "full", identityOnly = false, options = ytDlp.mediaOptions()) {
  const args = [
    "--skip-download", "--flat-playlist", "--dump-single-json", "--ignore-errors", "--no-warnings",
    "--extractor-args", "youtubetab:approximate_date",
  ];
  if (options.metadataLanguage !== "original") args.push("--extractor-args", `youtube:lang=${options.metadataLanguage}`);
  if (identityOnly) args.push("--playlist-end", "1");
  else if (mode === "recent") args.push("--playlist-end", "60");
  args.push(url);
  return args;
}

function cancellationError() {
  const error = new Error("Senkronizasyon kullanıcı tarafından iptal edildi.");
  error.code = "BIRDESENGOR_SYNC_CANCELLED";
  return error;
}

async function fetchJson(url, mode = "full", identityOnly = false, options = ytDlp.mediaOptions(), control = {}) {
  const args = catalogArgs(url, mode, identityOnly, options);
  let result;
  try {
    result = await execFileAsync(ytDlp.executablePath(), args, {
      timeout: identityOnly || mode === "recent" ? 180000 : 900000,
      maxBuffer: 96 * 1024 * 1024,
      signal: control.signal,
      windowsHide: true,
    });
  } catch (error) {
    if (control.signal?.aborted || error?.name === "AbortError") throw cancellationError();
    throw error;
  }
  try { return JSON.parse(String(result.stdout ?? "{}")); } catch {
    throw new Error("yt-dlp kanal kataloğunu geçerli JSON olarak döndürmedi.");
  }
}

function detailOutputTemplate(options = ytDlp.mediaOptions()) {
  const languages = Array.isArray(options.subtitleLanguages) ? options.subtitleLanguages : [];
  const fields = [
    "%(id)s", "%(title)j", "%(upload_date|)s", "%(timestamp|)s", "%(release_timestamp|)s",
    "%(duration|)s", "%(availability|)s", "%(live_status|)s", "%(playlist_index|0)s", "%(n_entries|0)s",
  ];
  for (const language of languages) {
    fields.push(`%(subtitles.${language}&1|0)s`, `%(automatic_captions.${language}&1|0)s`);
  }
  return fields.join("\t");
}

function detailArgs(url, mode = "full", options = ytDlp.mediaOptions(), playlistItems = []) {
  const args = [
    "--skip-download", "--ignore-errors", "--no-warnings", "--no-progress",
    "--extractor-args", "youtubetab:approximate_date",
  ];
  if (options.metadataLanguage !== "original") args.push("--extractor-args", `youtube:lang=${options.metadataLanguage}`);
  if (playlistItems.length) args.push("--playlist-items", playlistItems.join(","));
  else if (mode === "recent") args.push("--playlist-end", "60");
  args.push("--print", detailOutputTemplate(options), url);
  return args;
}

function parseDetailOutput(stdout, options = ytDlp.mediaOptions()) {
  const languages = Array.isArray(options.subtitleLanguages) ? options.subtitleLanguages : [];
  const entries = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    if (!/^[A-Za-z0-9_-]{11}$/.test(fields[0] ?? "")) continue;
    let title = fields[1] ?? "";
    try { title = JSON.parse(title); } catch {}
    const subtitles = [];
    const automaticCaptions = [];
    for (let index = 0; index < languages.length; index += 1) {
      if (fields[10 + index * 2] === "1") subtitles.push(languages[index]);
      if (fields[11 + index * 2] === "1") automaticCaptions.push(languages[index]);
    }
    entries.push({
      id: fields[0], title, upload_date: fields[2], timestamp: fields[3], release_timestamp: fields[4],
      duration: fields[5], availability: fields[6], live_status: fields[7],
      playlist_index: Number(fields[8]) || 0, playlist_count: Number(fields[9]) || 0,
      subtitle_status: subtitles.length ? "manual" : automaticCaptions.length ? "automatic" : "none",
      subtitle_languages: subtitles,
      automatic_caption_languages: automaticCaptions,
    });
  }
  return entries;
}

function fetchDetailedEntries(url, mode, options = ytDlp.mediaOptions(), control = {}) {
  return new Promise((resolve, reject) => {
    if (control.signal?.aborted) return reject(cancellationError());
    const child = spawn(ytDlp.executablePath(), detailArgs(url, mode, options, control.playlistItems), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const entries = [];
    let stdout = "";
    let stderr = "";
    let stderrLines = "";
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;
    const attempted = new Set();

    const report = (entry = null) => {
      control.onProgress?.({
        processed: attempted.size,
        total: Number(control.total) || Number(entry?.playlist_count) || 0,
        currentTitle: entry?.title || "",
      });
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      control.signal?.removeEventListener("abort", abort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const terminate = () => {
      if (child.exitCode != null || child.killed) return;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode == null) child.kill("SIGKILL");
      }, 1500);
      forceKillTimer.unref?.();
    };
    const abort = () => terminate();
    const consume = (line) => {
      if (control.signal?.aborted) return;
      const parsed = parseDetailOutput(line, options);
      if (!parsed.length) return;
      const entry = parsed[0];
      entries.push(entry);
      attempted.add(entry.id);
      report(entry);
    };
    const consumeErrorLines = (flush = false) => {
      const lines = stderrLines.split(/\r?\n/);
      stderrLines = flush ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/\[youtube\]\s+([A-Za-z0-9_-]{11}):/);
        if (!match || attempted.has(match[1])) continue;
        attempted.add(match[1]);
        report({ title: control.titlesById?.get(match[1]) || "" });
      }
    };
    const consumeBufferedLines = (flush = false) => {
      const lines = stdout.split(/\r?\n/);
      stdout = flush ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (control.signal?.aborted) break;
        consume(line);
      }
      if (flush && stdout.trim()) consume(stdout);
    };

    control.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, mode === "recent" ? 12 * 60 * 1000 : 60 * 60 * 1000);
    timeout.unref?.();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      consumeBufferedLines(false);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
      stderrLines += chunk;
      consumeErrorLines(false);
    });
    child.once("error", (error) => finish(() => reject(control.signal?.aborted ? cancellationError() : error)));
    child.once("close", (code) => {
      consumeBufferedLines(true);
      consumeErrorLines(true);
      if (control.signal?.aborted) return finish(() => reject(cancellationError()));
      if (timedOut) return finish(() => reject(new Error("yt-dlp ayrıntılı kanal taraması zaman aşımına uğradı.")));
      if (code !== 0 && !entries.length && !control.allowEmpty) return finish(() => reject(new Error(stderr.trim() || `yt-dlp ${code} koduyla durdu.`)));
      if (Number(control.total) > attempted.size) control.onProgress?.({ processed: Number(control.total), total: Number(control.total), currentTitle: "" });
      return finish(() => resolve(entries));
    });
  });
}

function channelIdentity(payload, url) {
  const channelId = String(payload?.channel_id ?? payload?.uploader_id ?? payload?.playlist_channel_id ?? payload?.id ?? "").trim() || fallbackChannelId(url);
  const title = String(payload?.channel ?? payload?.uploader ?? payload?.playlist_uploader ?? payload?.playlist_channel ?? payload?.title ?? "YouTube Kanalı").trim();
  const match = url.match(/youtube\.com\/(?:@([^/]+)|(?:channel|user|c)\/([^/]+))/i);
  const handle = match?.[1] ? `@${match[1]}` : (match?.[2] ?? "");
  return { channelId, title, handle };
}

function uploadsPlaylistUrl(channelId) {
  const id = String(channelId ?? "").trim();
  if (!/^UC[A-Za-z0-9_-]+$/.test(id)) return "";
  return `https://www.youtube.com/playlist?list=UU${id.slice(2)}`;
}

function scanFilters(input = {}) {
  return {
    excludeShorts: input?.excludeShorts !== false,
    excludeLive: input?.excludeLive !== false,
    excludeMembersOnly: input?.excludeMembersOnly !== false,
  };
}

function channelTabUrl(channelUrl, tab) {
  return `${normalizeChannelUrl(channelUrl)}/${tab}`;
}

function catalogTargets(channelUrl, channelId, input = {}) {
  const filters = scanFilters(input);
  if (!filters.excludeShorts && !filters.excludeLive) {
    return [uploadsPlaylistUrl(channelId) || normalizeChannelUrl(channelUrl)];
  }
  const targets = [channelTabUrl(channelUrl, "videos")];
  if (!filters.excludeShorts) targets.push(channelTabUrl(channelUrl, "shorts"));
  if (!filters.excludeLive) targets.push(channelTabUrl(channelUrl, "streams"));
  return targets;
}

function shouldIncludeEntry(entry, input = {}) {
  const filters = scanFilters(input);
  if (filters.excludeLive && ["is_live", "is_upcoming", "post_live", "was_live"].includes(String(entry?.live_status ?? "").toLowerCase())) return false;
  if (filters.excludeMembersOnly && String(entry?.availability ?? "").toLowerCase() === "subscriber_only") return false;
  return true;
}

function flattenEntries(entries) {
  const output = [];
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return;
    if (/^[A-Za-z0-9_-]{11}$/.test(String(entry.id ?? ""))) output.push(entry);
    if (Array.isArray(entry.entries)) entry.entries.forEach(visit);
  };
  (Array.isArray(entries) ? entries : []).forEach(visit);
  return output;
}

async function fetchCatalog(channelUrl, mode, input = {}) {
  // Resolve identity once, then query only the channel tabs selected by the user.
  const options = ytDlp.mediaOptions();
  const filters = scanFilters(input);
  input.onProgress?.({ phase: "preparing", processed: 0, total: 0, currentTitle: "" });
  const identityPayload = await fetchJson(channelUrl, "recent", true, options, input);
  const identity = channelIdentity(identityPayload, channelUrl);
  const targets = catalogTargets(channelUrl, identity.channelId, filters);
  input.onProgress?.({ phase: "catalog", processed: 0, total: 0, currentTitle: "" });
  const flatPayloads = await Promise.all(targets.map((target) => fetchJson(target, mode, false, options, input)));
  const flatGroups = flatPayloads.map((payload) => flattenEntries(payload?.entries));
  const eligibleGroups = flatGroups.map((entries) => entries
    .map((entry, index) => ({ entry, playlistIndex: index + 1 }))
    .filter(({ entry }) => shouldIncludeEntry(entry, filters)));
  const completeIds = new Set(Array.isArray(input.skipVideoIds) ? input.skipVideoIds : []);
  const pendingGroups = eligibleGroups.map((items) => items
    .filter(({ entry }) => !completeIds.has(String(entry?.id ?? ""))));
  const targetProgress = pendingGroups.map((items) => ({ processed: 0, total: items.length }));
  const detailTotal = targetProgress.reduce((sum, item) => sum + item.total, 0);
  input.onProgress?.({ phase: "scanning", processed: 0, total: detailTotal, currentTitle: "" });
  const detailPayloads = await Promise.all(targets.map((target, index) => pendingGroups[index].length ? fetchDetailedEntries(target, mode, options, {
    signal: input.signal,
    playlistItems: pendingGroups[index].map((item) => item.playlistIndex),
    total: pendingGroups[index].length,
    allowEmpty: true,
    titlesById: new Map(pendingGroups[index].map(({ entry }) => [String(entry.id), String(entry.title || "")])),
    onProgress: (progress) => {
      targetProgress[index] = { processed: progress.processed, total: pendingGroups[index].length };
      input.onProgress?.({
        phase: "scanning",
        processed: targetProgress.reduce((sum, item) => sum + item.processed, 0),
        total: targetProgress.reduce((sum, item) => sum + item.total, 0),
        currentTitle: progress.currentTitle,
      });
    },
  }) : Promise.resolve([])));
  const detailedById = new Map(detailPayloads.flat().map((entry) => [String(entry.id), entry]));
  const entries = eligibleGroups.flatMap((group) => group.map(({ entry }) => {
    const detailed = detailedById.get(String(entry.id));
    if (detailed) return { ...entry, ...detailed };
    return {
      ...entry,
      subtitle_status: "unknown",
      subtitle_languages: [],
      automatic_caption_languages: [],
    };
  }));
  return {
    payload: { entries }, identity, options, filters,
    detailStats: {
      requested: detailTotal,
      completed: detailedById.size,
      unavailable: Math.max(0, detailTotal - detailedById.size),
      skipped: Math.max(0, entries.length - detailTotal),
    },
  };
}

module.exports = {
  catalogArgs, catalogTargets, currentDetailSignature, detailArgs, detailOutputTemplate, detailSignature,
  fetchCatalog, fetchDetailedEntries, flattenEntries,
  normalizeChannelUrl, normalizeEntry, parseDetailOutput, scanFilters, shouldIncludeEntry,
  thumbnailUrls, uploadsPlaylistUrl, ytDlpStatus,
};
