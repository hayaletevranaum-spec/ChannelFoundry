const fs = require("node:fs");
const source = require("./youtube-catalog-source.cjs");
const store = require("./youtube-catalog-store.cjs");
const { cacheThumbnails, thumbnailCacheFile } = require("./youtube-thumbnail-cache.cjs");

async function syncChannel(db, userDataPath, input) {
  store.ensureSchema(db);
  const tool = await source.ytDlpStatus();
  if (!tool.available) throw new Error("Kanal senkronizasyonu için yt-dlp kurulu olmalı.");
  const url = source.normalizeChannelUrl(input?.url);
  const mode = input?.mode === "recent" ? "recent" : "full";
  const detailSignature = source.currentDetailSignature();
  const { payload, identity, options, filters, detailStats } = await source.fetchCatalog(url, mode, {
    excludeShorts: input?.excludeShorts,
    excludeLive: input?.excludeLive,
    excludeMembersOnly: input?.excludeMembersOnly,
    signal: input?.signal,
    onProgress: input?.onProgress,
    skipVideoIds: store.detailedVideoIds(db, detailSignature),
  });
  const videos = source.flattenEntries(payload?.entries)
    .filter((entry) => source.shouldIncludeEntry(entry, filters))
    .map((entry) => source.normalizeEntry(entry, identity.channelId, options))
    .filter(Boolean);
  const existingThumbnails = new Map(db.prepare(`
    SELECT video_id AS videoId, thumbnail_url AS thumbnailUrl, thumbnail_file AS thumbnailFile
    FROM youtube_videos
  `).all().map((row) => [row.videoId, row]));
  const uncached = videos.filter((video) => {
    const row = existingThumbnails.get(video.videoId);
    const expectedFile = thumbnailCacheFile(userDataPath, video);
    if (row?.thumbnailFile === expectedFile && fs.existsSync(expectedFile)) {
      video.thumbnailFile = expectedFile;
      video.thumbnailUrl = row.thumbnailUrl;
      return false;
    }
    return true;
  });
  if (input?.signal?.aborted) {
    const error = new Error("Senkronizasyon kullanıcı tarafından iptal edildi.");
    error.code = "BIRDESENGOR_SYNC_CANCELLED";
    throw error;
  }
  if (uncached.length) input?.onProgress?.({ phase: "thumbnails", processed: 0, total: uncached.length, currentTitle: "" });
  const alreadyArchived = uncached.filter((video) => {
    const file = thumbnailCacheFile(userDataPath, video);
    return fs.existsSync(file) && fs.statSync(file).size > 100;
  }).length;
  const preparedThumbnailCount = await cacheThumbnails(userDataPath, uncached, {
    signal: input?.signal,
    onProgress: (progress) => input?.onProgress?.({ phase: "thumbnails", ...progress }),
  });
  const cachedCount = Math.max(0, preparedThumbnailCount - alreadyArchived);
  const archivedThumbnailCount = videos.filter((video) => {
    const file = thumbnailCacheFile(userDataPath, video);
    return fs.existsSync(file) && fs.statSync(file).size > 100;
  }).length;
  if (input?.signal?.aborted) {
    const error = new Error("Senkronizasyon kullanıcı tarafından iptal edildi.");
    error.code = "BIRDESENGOR_SYNC_CANCELLED";
    throw error;
  }
  input?.onProgress?.({ phase: "saving", processed: videos.length, total: videos.length, currentTitle: "" });
  const result = store.upsertCatalog(db, identity, url, videos, mode);
  const channel = db.prepare(`
    SELECT id, url, title, handle, last_synced_at AS lastSyncedAt,
           last_full_synced_at AS lastFullSyncedAt, video_count AS videoCount
    FROM youtube_channels WHERE id = ?
  `).get(identity.channelId);
  return { ok: true, mode, tool, channel, ...result, cachedCount, archivedThumbnailCount, detailStats };
}

module.exports = {
  ensureSchema: store.ensureSchema,
  normalizeChannelUrl: source.normalizeChannelUrl,
  normalizeEntry: source.normalizeEntry,
  uploadsPlaylistUrl: source.uploadsPlaylistUrl,
  flattenEntries: source.flattenEntries,
  ytDlpStatus: source.ytDlpStatus,
  syncChannel,
  listChannels: store.listChannels,
  listVideos: store.listVideos,
  importCatalogVideo: store.importCatalogVideo,
  catalogStats: store.catalogStats,
};
