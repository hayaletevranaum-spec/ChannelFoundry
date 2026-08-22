const fs = require("node:fs");
const path = require("node:path");

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
}

function thumbnailCacheFile(userDataPath, video) {
  const directory = path.join(userDataPath, "youtube-thumbnails", safeSegment(video.channelId));
  const size = ["small", "standard", "large"].includes(video.thumbnailSize) ? video.thumbnailSize : "standard";
  return path.join(directory, `${safeSegment(video.videoId)}-${size}.jpg`);
}

function cancellationError() {
  const error = new Error("Senkronizasyon kullanıcı tarafından iptal edildi.");
  error.code = "CHANNEL_FOUNDRY_SYNC_CANCELLED";
  return error;
}

async function cacheThumbnail(userDataPath, video, signal) {
  const file = thumbnailCacheFile(userDataPath, video);
  const directory = path.dirname(file);
  if (fs.existsSync(file) && fs.statSync(file).size > 100) return file;
  fs.mkdirSync(directory, { recursive: true });
  const candidates = Array.isArray(video.thumbnailUrls) && video.thumbnailUrls.length ? video.thumbnailUrls : [video.thumbnailUrl];
  for (const url of candidates) {
    if (signal?.aborted) throw cancellationError();
    try {
      const timeoutSignal = AbortSignal.timeout(12000);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(url, { signal: requestSignal });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100) continue;
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, file);
      video.thumbnailUrl = url;
      return file;
    } catch (error) {
      if (signal?.aborted) throw cancellationError();
    }
  }
  return "";
}

async function cacheThumbnails(userDataPath, videos, control = {}) {
  let cached = 0;
  let processed = 0;
  const queue = [...videos];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      if (control.signal?.aborted) throw cancellationError();
      const video = queue.shift();
      if (!video) break;
      const file = await cacheThumbnail(userDataPath, video, control.signal);
      if (file) {
        video.thumbnailFile = file;
        cached += 1;
      }
      processed += 1;
      control.onProgress?.({ processed, total: videos.length, currentTitle: video.title });
    }
  });
  await Promise.all(workers);
  return cached;
}

module.exports = { cacheThumbnails, thumbnailCacheFile };
