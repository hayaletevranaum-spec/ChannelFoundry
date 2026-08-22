const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const store = require("./transcript-store.cjs");
const ytDlp = require("./ytdlp-manager.cjs");

const execFileAsync = promisify(execFile);

async function ytDlpStatus() {
  return ytDlp.status();
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function vttToPlainText(raw) {
  const lines = String(raw ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let previous = "";
  for (let line of lines) {
    line = line.trim();
    if (!line || line === "WEBVTT" || /^NOTE(?:\s|$)/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (/^\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->/.test(line) || /-->/.test(line)) continue;
    if (/^(Kind|Language):/i.test(line)) continue;
    line = decodeEntities(line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).trim();
    if (!line || line === previous) continue;
    output.push(line);
    previous = line;
  }
  return output.join("\n").trim();
}

function languageFromFilename(filename) {
  const match = String(filename).match(/\.([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.vtt$/i);
  return match?.[1] ?? "";
}

function chooseSubtitleFile(files, languages = ytDlp.mediaOptions().subtitleLanguages) {
  const vtt = files.filter((file) => file.toLowerCase().endsWith(".vtt"));
  const score = (name) => {
    const language = languageFromFilename(name).toLowerCase();
    const index = languages.map((item) => item.toLowerCase()).indexOf(language);
    return index < 0 ? languages.length : index;
  };
  return vtt.sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] ?? null;
}

function clearSubtitleFiles(directory) {
  for (const file of fs.readdirSync(directory)) {
    if (file.toLowerCase().endsWith(".vtt")) fs.rmSync(path.join(directory, file), { force: true });
  }
}

function subtitleAttemptArgs({ outputTemplate, url, automatic, languages = ytDlp.mediaOptions().subtitleLanguages }) {
  return [
    "--skip-download",
    automatic ? "--write-auto-subs" : "--write-subs",
    "--sub-langs", languages.join(","),
    "--sub-format", "vtt/best",
    "--output", outputTemplate,
    String(url),
  ];
}

async function runSubtitleAttempt(directory, outputTemplate, url, automatic, languages) {
  clearSubtitleFiles(directory);
  try {
    const result = await execFileAsync(ytDlp.executablePath(), subtitleAttemptArgs({ outputTemplate, url, automatic, languages }), {
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const selected = chooseSubtitleFile(fs.readdirSync(directory), languages);
    return { selected, automatic, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), error: null };
  } catch (error) {
    const selected = chooseSubtitleFile(fs.readdirSync(directory), languages);
    return {
      selected,
      automatic,
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? ""),
      error,
    };
  }
}

function subtitleFailureMessage(attempts) {
  const combined = attempts.map((attempt) => `${attempt.stderr}\n${attempt.stdout}\n${attempt.error?.message ?? ""}`).join("\n");
  if (/HTTP Error 429|Too Many Requests/i.test(combined)) {
    return "YouTube altyazı isteğini geçici olarak 429 (Too Many Requests) ile sınırladı. Studio otomatik çeviri altyazılarını istemiyor; buna rağmen 429 sürüyorsa biraz sonra tekrar dene. Gerekirse sonraki adımda tarayıcı oturum çerezlerini yalnız yerel yt-dlp çağrısında kullanacak bir seçenek ekleyebiliriz.";
  }
  const detail = combined.trim().slice(0, 900);
  return detail
    ? `YouTube altyazısı alınamadı. Manuel ve videonun kendi dilindeki otomatik altyazılar denendi. ${detail}`
    : "Bu video için Türkçe veya İngilizce manuel/otomatik altyazı bulunamadı.";
}

function resolveYoutubeTarget(db, input) {
  const contentKey = String(input?.contentKey ?? "").trim();
  const requestedVideoId = String(input?.videoId ?? "").trim();
  if (contentKey && store.tableExists(db, "content_sources")) {
    const source = db.prepare(`
      SELECT external_id AS videoId, canonical_url AS canonicalUrl
      FROM content_sources WHERE content_key = ? AND provider = 'youtube'
    `).get(contentKey);
    if (source) return { contentKey, videoId: source.videoId, canonicalUrl: source.canonicalUrl };
  }
  if (requestedVideoId && store.tableExists(db, "youtube_videos")) {
    const source = db.prepare(`
      SELECT video_id AS videoId, canonical_url AS canonicalUrl FROM youtube_videos WHERE video_id = ?
    `).get(requestedVideoId);
    if (source) {
      const mappedContentKey = store.tableExists(db, "content_sources")
        ? db.prepare("SELECT content_key AS contentKey FROM content_sources WHERE provider = 'youtube' AND external_id = ?").get(requestedVideoId)?.contentKey ?? ""
        : "";
      return { contentKey: mappedContentKey, videoId: source.videoId, canonicalUrl: source.canonicalUrl };
    }
  }
  throw new Error(contentKey ? "Bu kayıt bir YouTube kaynağına bağlı değil." : "Video yerel YouTube kataloğunda bulunamadı.");
}

async function fetchYoutubeTranscript(db, input) {
  store.ensureSchema(db);
  const target = resolveYoutubeTarget(db, input);
  const status = await ytDlpStatus();
  if (!status.available) {
    throw new Error("YouTube altyazısını otomatik almak için yt-dlp kurulu olmalı. İstersen transkripti elle de yapıştırabilirsin.");
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-transcript-"));
  try {
    const languages = status.subtitleLanguages || ytDlp.mediaOptions().subtitleLanguages;
    const outputTemplate = path.join(tempDirectory, "%(id)s.%(ext)s");
    const attempts = [];
    // Avoid wildcard languages: auto-translated composite keys can trigger HTTP 429.
    attempts.push(await runSubtitleAttempt(tempDirectory, outputTemplate, target.canonicalUrl, false, languages));
    let successful = attempts.find((attempt) => attempt.selected);
    if (!successful) {
      attempts.push(await runSubtitleAttempt(tempDirectory, outputTemplate, target.canonicalUrl, true, languages));
      successful = attempts.find((attempt) => attempt.selected);
    }
    if (!successful?.selected) throw new Error(subtitleFailureMessage(attempts));

    const selected = successful.selected;
    const raw = fs.readFileSync(path.join(tempDirectory, selected), "utf8");
    const text = vttToPlainText(raw);
    if (!text) throw new Error("Altyazı dosyası alındı ancak okunabilir transkript üretilemedi.");
    const language = languageFromFilename(selected);
    const transcript = store.saveSourceTranscript(db, {
      videoId: target.videoId,
      source: "youtube",
      language,
      text,
    });
    if (target.contentKey) {
      store.saveTranscript(db, { contentKey: target.contentKey, source: "youtube", language, text });
    }
    return {
      ...transcript,
      contentKey: target.contentKey || target.videoId,
      videoId: target.videoId,
      ytDlpVersion: status.version,
      filename: selected,
      captionType: successful.automatic ? "automatic" : "manual",
    };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

module.exports = { chooseSubtitleFile, fetchYoutubeTranscript, subtitleAttemptArgs, subtitleFailureMessage, vttToPlainText, ytDlpStatus };
