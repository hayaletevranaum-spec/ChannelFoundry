const crypto = require("node:crypto");
const { supportRecords } = require("./ai-support-records.cjs");

function stableId(kind, videoId, name) {
  return crypto.createHash("sha1").update(`${kind}:${videoId}:${name}`.toLocaleLowerCase("tr-TR")).digest("hex").slice(0, 16);
}

function videoMap(db) {
  const exists = Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='youtube_videos'").get());
  if (!exists) return new Map();
  return new Map(db.prepare(`
    SELECT video_id AS videoId, title, published_at AS publishedAt, canonical_url AS url
    FROM youtube_videos
  `).all().map((row) => [String(row.videoId), row]));
}

function publicSupport(db) {
  const videos = videoMap(db);
  const notebook = [];
  const contributors = [];
  for (const record of supportRecords(db)) {
    const videoId = String(record.videoId || "");
    const name = String(record.name || "").trim();
    if (!videoId || !name) continue;
    const video = videos.get(videoId);
    const publicRecord = {
      id: stableId(record.kind, videoId, name),
      name,
      videoId,
      videoTitle: String(video?.title || "Kaynak video"),
      videoPublishedAt: String(video?.publishedAt || ""),
      videoUrl: String(video?.url || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`),
    };
    if (record.kind === "sponsor") notebook.push(publicRecord);
    else if (record.kind === "contributor") contributors.push(publicRecord);
  }
  return {
    notebook,
    contributors,
    counts: { notebook: notebook.length, contributors: contributors.length },
  };
}

function publicationEntry(record) {
  return {
    id: String(record?.id || ""),
    name: String(record?.name || ""),
    date: String(record?.videoPublishedAt || ""),
    note: "",
    video: {
      id: String(record?.videoId || ""),
      title: String(record?.videoTitle || ""),
      url: String(record?.videoUrl || ""),
    },
  };
}

function publicationSupport(db) {
  const support = publicSupport(db);
  return {
    sponsors: support.notebook.map(publicationEntry),
    contributors: support.contributors.map(publicationEntry),
  };
}

function attachPublicSupport(db, snapshot) {
  if (!snapshot?.universe || typeof snapshot.universe !== "object") throw new Error("Public snapshot evren verisi geçersiz.");
  snapshot.universe.support = publicSupport(db);
  return snapshot;
}

module.exports = { attachPublicSupport, publicationSupport, publicSupport };
