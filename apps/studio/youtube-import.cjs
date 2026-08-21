function parseYoutubeVideoId(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("YouTube bağlantısı gerekli.");

  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("Geçerli bir YouTube bağlantısı gir.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] ?? "")) id = parts[1] ?? "";
    }
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("Bu bağlantıdan geçerli bir YouTube video kimliği çıkarılamadı.");
  return id;
}

function canonicalYoutubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function canonicalThumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function inspectYoutube(input) {
  const videoId = parseYoutubeVideoId(input?.url ?? input);
  const canonicalUrl = canonicalYoutubeUrl(videoId);
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
  let response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
  } catch (error) {
    throw new Error(`YouTube bilgisi alınamadı: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`YouTube bu video için metadata döndürmedi (HTTP ${response.status}). Video gizli, silinmiş veya yerleştirmeye kapalı olabilir.`);
  const payload = await response.json();
  const title = String(payload?.title ?? "").trim();
  const channel = String(payload?.author_name ?? "").trim();
  if (!title) throw new Error("YouTube video başlığı alınamadı.");
  return {
    provider: "youtube",
    videoId,
    url: canonicalUrl,
    title,
    channel,
    thumbnailUrl: canonicalThumbnailUrl(videoId),
  };
}

function saveYoutubeImport(db, preview) {
  if (!preview || preview.provider !== "youtube") throw new Error("Geçersiz YouTube önizlemesi.");
  const videoId = String(preview.videoId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Geçersiz YouTube video kimliği.");
  const existing = db.prepare(`
    SELECT ci.key, ci.id, ci.kind, ci.title, ci.meta, ci.summary, ci.status
    FROM content_sources cs
    JOIN content_items ci ON ci.key = cs.content_key
    WHERE cs.provider = 'youtube' AND cs.external_id = ?
  `).get(videoId);
  if (existing) return { imported: false, item: existing, source: sourceFor(videoId, preview.channel), reason: "already_exists" };

  const id = `youtube-${videoId}`;
  const key = `video:${id}`;
  const title = String(preview.title ?? "").trim() || `YouTube ${videoId}`;
  const channel = String(preview.channel ?? "").trim();
  const meta = channel ? `YouTube · ${channel}` : "YouTube";
  const summary = "YouTube kaynağından içe aktarıldı. İçerik özetini Studio'da düzenle.";

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      INSERT INTO content_items (key, id, kind, title, meta, summary, status)
      VALUES (?, ?, 'video', ?, ?, ?, 'draft')
    `).run(key, id, title, meta, summary);
    db.prepare(`
      INSERT INTO content_sources (content_key, provider, external_id, canonical_url, author_name, thumbnail_url)
      VALUES (?, 'youtube', ?, ?, ?, ?)
    `).run(key, videoId, canonicalYoutubeUrl(videoId), channel, canonicalThumbnailUrl(videoId));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    imported: true,
    item: { key, id, kind: "video", title, meta, summary, status: "draft" },
    source: sourceFor(videoId, channel),
  };
}

function sourceFor(videoId, channel) {
  return {
    provider: "youtube",
    videoId,
    url: canonicalYoutubeUrl(videoId),
    channel: String(channel ?? ""),
    thumbnailUrl: canonicalThumbnailUrl(videoId),
  };
}

async function importYoutube(db, input) {
  const preview = await inspectYoutube(input);
  return saveYoutubeImport(db, preview);
}

module.exports = {
  parseYoutubeVideoId,
  canonicalYoutubeUrl,
  canonicalThumbnailUrl,
  inspectYoutube,
  saveYoutubeImport,
  importYoutube,
};
