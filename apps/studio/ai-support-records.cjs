const crypto = require("node:crypto");
const editorial = require("./ai-analysis-editorial.cjs");

const SUPPORT_KINDS = new Set(["sponsor", "contributor"]);

function clean(value, max = 260) {
  return String(value ?? "").trim().slice(0, max);
}

function normalized(value) {
  return clean(value, 1000).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function unique(values) {
  const result = [];
  for (const value of values) {
    const text = clean(value);
    if (text && !result.some((entry) => normalized(entry) === normalized(text))) result.push(text);
  }
  return result;
}

function stableId(kind, videoId, name) {
  return crypto.createHash("sha1").update(`${kind}:${videoId}:${name}`.toLocaleLowerCase("tr-TR")).digest("hex").slice(0, 16);
}

function reviewedRows(db) {
  editorial.ensureSchema(db);
  return db.prepare(`
    SELECT external_id AS videoId, state
    FROM ai_analysis_editorial_reviews
    WHERE provider='youtube' AND state IN ('curated','excluded')
    ORDER BY updated_at ASC, external_id ASC
  `).all();
}

function videoMap(db) {
  const exists = Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='youtube_videos'").get());
  if (!exists) return new Map();
  return new Map(db.prepare(`
    SELECT video_id AS videoId, title, published_at AS publishedAt, canonical_url AS url
    FROM youtube_videos
  `).all().map((row) => [String(row.videoId), row]));
}

function packState(pack) {
  return {
    state: pack.state,
    decisions: Object.fromEntries((pack.items ?? []).map((item) => [item.key, item.decision])),
    nameOverrides: Object.fromEntries((pack.items ?? []).filter((item) => item.nameOverride).map((item) => [item.key, item.nameOverride])),
    manualSponsors: [...(pack.manualSponsors ?? [])],
    manualContributors: [...(pack.manualContributors ?? [])],
  };
}

function effectiveRecords(pack, videoId) {
  const result = new Map();
  const add = (kind, name, origin) => {
    const value = clean(name);
    if (!value) return;
    const key = `${kind}:${normalized(value)}`;
    const current = result.get(key);
    if (!current) {
      result.set(key, { videoId, kind, name: value, source: origin });
      return;
    }
    if (current.source !== origin) current.source = "analysis+manual";
  };

  for (const item of pack.items ?? []) {
    if (!SUPPORT_KINDS.has(item.category) || item.decision !== "confirm") continue;
    add(item.category, item.label, "analysis");
  }
  for (const name of pack.manualSponsors ?? []) add("sponsor", name, "manual");
  for (const name of pack.manualContributors ?? []) add("contributor", name, "manual");
  return [...result.values()];
}

function supportRecords(db) {
  const records = [];
  for (const row of reviewedRows(db)) {
    const videoId = String(row.videoId || "");
    const pack = editorial.editorialPackage(db, videoId);
    if (!pack) continue;
    for (const record of effectiveRecords(pack, videoId)) {
      records.push({ ...record, id: stableId(record.kind, videoId, record.name) });
    }
  }
  return records;
}

function supportSources(db) {
  const videos = videoMap(db);
  return reviewedRows(db).map((row) => {
    const videoId = String(row.videoId || "");
    const video = videos.get(videoId);
    return {
      videoId,
      state: String(row.state || "curated"),
      title: String(video?.title || videoId || "Kaynak video"),
      publishedAt: String(video?.publishedAt || ""),
      url: String(video?.url || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`),
    };
  }).filter((entry) => entry.videoId);
}

function removeName(values, name) {
  const target = normalized(name);
  return unique(values).filter((entry) => normalized(entry) !== target);
}

function addName(values, name) {
  return unique([...values, name]);
}

function mutateSupport(db, videoId, kind, originalName, nextName) {
  const pack = editorial.editorialPackage(db, videoId);
  if (!pack || !["curated", "excluded"].includes(pack.state)) {
    throw new Error("Sponsor/katkı kaydı için ayıklanmış bir kaynak video gerekli.");
  }
  const next = packState(pack);
  const manualKey = kind === "sponsor" ? "manualSponsors" : "manualContributors";
  const original = normalized(originalName);
  const replacement = clean(nextName);

  if (original) {
    for (const item of pack.items ?? []) {
      if (item.category === kind && normalized(item.label) === original) next.decisions[item.key] = "exclude";
    }
    next[manualKey] = removeName(next[manualKey], originalName);
  }

  if (replacement) {
    const detected = (pack.items ?? []).find((item) => item.category === kind && normalized(item.label) === normalized(replacement));
    if (detected) next.decisions[detected.key] = "confirm";
    else next[manualKey] = addName(next[manualKey], replacement);
  }

  return editorial.saveReview(db, {
    videoId,
    state: next.state,
    decisions: next.decisions,
    nameOverrides: next.nameOverrides,
    manualSponsors: next.manualSponsors,
    manualContributors: next.manualContributors,
  });
}

function saveSupportRecord(db, input) {
  const videoId = clean(input?.videoId, 100);
  const kind = clean(input?.kind, 30);
  const originalName = clean(input?.originalName);
  const name = clean(input?.name);
  const targetVideoId = clean(input?.targetVideoId || videoId, 100);
  const targetKind = clean(input?.targetKind || kind, 30);
  const remove = Boolean(input?.delete);

  if (!videoId || !SUPPORT_KINDS.has(kind)) throw new Error("Geçerli sponsor/katkı kaydı gerekli.");
  if (!remove && (!name || !targetVideoId || !SUPPORT_KINDS.has(targetKind))) throw new Error("Ad, tür ve kaynak video gerekli.");

  const moving = !remove && (targetVideoId !== videoId || targetKind !== kind);
  if (moving) {
    if (originalName) mutateSupport(db, videoId, kind, originalName, "");
    mutateSupport(db, targetVideoId, targetKind, "", name);
  } else {
    mutateSupport(db, videoId, kind, originalName, remove ? "" : name);
  }

  return { ok: true, records: supportRecords(db), sources: supportSources(db) };
}

module.exports = { saveSupportRecord, supportRecords, supportSources };
