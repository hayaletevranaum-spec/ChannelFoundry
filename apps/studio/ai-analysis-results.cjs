const { ensureSchema } = require("./ai-analysis-schema.cjs");

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function normalizeVisual(value) {
  const entry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    description: String(entry.description ?? ""),
    attributes: stringArray(entry.attributes),
    atmosphere: String(entry.atmosphere ?? ""),
    prompt: String(entry.prompt ?? ""),
    negativePrompt: String(entry.negativePrompt ?? ""),
  };
}

function normalizeCharacters(value) {
  return (Array.isArray(value) ? value : []).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const name = String(entry.name ?? "").trim();
    if (!name) return null;
    return {
      name,
      aliases: stringArray(entry.aliases),
      role: String(entry.role ?? ""),
      details: stringArray(entry.details),
      visual: normalizeVisual(entry.visual),
    };
  }).filter(Boolean);
}

function normalizeNamedVisuals(value) {
  return (Array.isArray(value) ? value : []).map((entry) => {
    if (typeof entry === "string") return { name: entry, details: [], visual: normalizeVisual({}) };
    if (!entry || typeof entry !== "object") return null;
    const name = String(entry.name ?? "").trim();
    if (!name) return null;
    return { name, details: stringArray(entry.details), visual: normalizeVisual(entry.visual) };
  }).filter(Boolean);
}

function normalizeScenes(value) {
  return (Array.isArray(value) ? value : []).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const name = String(entry.name ?? "").trim();
    const description = String(entry.description ?? "").trim();
    if (!name && !description) return null;
    return { name, description, visual: normalizeVisual(entry.visual) };
  }).filter(Boolean);
}

function rowToResult(row) {
  if (!row) return null;
  return {
    videoId: String(row.videoId ?? row.externalId ?? ""),
    model: String(row.model ?? ""),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    topics: stringArray(safeJson(row.topicsJson, [])),
    storyBeats: stringArray(safeJson(row.storyBeatsJson, [])),
    storyHints: stringArray(safeJson(row.storyHintsJson, [])),
    coverVisual: normalizeVisual(safeJson(row.coverVisualJson, {})),
    characters: normalizeCharacters(safeJson(row.charactersJson, [])),
    locations: normalizeNamedVisuals(safeJson(row.locationsJson, [])),
    objects: normalizeNamedVisuals(safeJson(row.objectsJson, [])),
    scenes: normalizeScenes(safeJson(row.scenesJson, [])),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function getResult(db, videoId) {
  ensureSchema(db);
  const row = db.prepare(`
    SELECT external_id AS videoId, model, title, summary,
           topics_json AS topicsJson, story_beats_json AS storyBeatsJson,
           story_hints_json AS storyHintsJson, cover_visual_json AS coverVisualJson,
           characters_json AS charactersJson, locations_json AS locationsJson,
           objects_json AS objectsJson, scenes_json AS scenesJson, updated_at AS updatedAt
    FROM source_ai_analyses WHERE provider = 'youtube' AND external_id = ?
  `).get(String(videoId ?? "").trim());
  return rowToResult(row);
}

function list(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT yv.video_id AS videoId, yv.title, yv.published_at AS publishedAt,
           yv.duration_seconds AS durationSeconds, yv.thumbnail_url AS thumbnailUrl,
           yv.thumbnail_file AS thumbnailFile, cs.content_key AS contentKey,
           CASE WHEN st.external_id IS NULL THEN 0 ELSE 1 END AS hasTranscript,
           CASE WHEN sa.external_id IS NULL THEN 0 ELSE 1 END AS hasAnalysis,
           COALESCE(j.state, '') AS jobState, COALESCE(j.error, '') AS jobError,
           COALESCE(j.attempts, 0) AS attempts, COALESCE(sa.model, '') AS analysisModel,
           COALESCE(sa.updated_at, '') AS analysisUpdatedAt
    FROM youtube_videos yv
    LEFT JOIN content_sources cs ON cs.provider = 'youtube' AND cs.external_id = yv.video_id
    LEFT JOIN source_transcripts st ON st.provider = 'youtube' AND st.external_id = yv.video_id
    LEFT JOIN source_ai_analyses sa ON sa.provider = 'youtube' AND sa.external_id = yv.video_id
    LEFT JOIN ai_analysis_jobs j ON j.provider = 'youtube' AND j.external_id = yv.video_id
    WHERE st.external_id IS NOT NULL
    ORDER BY CASE WHEN yv.published_at = '' THEN 1 ELSE 0 END, yv.published_at DESC, yv.discovered_at DESC
  `).all().map((row) => ({
    ...row,
    hasTranscript: Boolean(row.hasTranscript),
    hasAnalysis: Boolean(row.hasAnalysis),
  }));
}

function stats(db) {
  ensureSchema(db);
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT st.external_id)
         FROM source_transcripts st
        WHERE st.provider='youtube') AS transcripts,
      (SELECT COUNT(DISTINCT sa.external_id)
         FROM source_ai_analyses sa
        WHERE sa.provider='youtube') AS analyzed,
      (SELECT COUNT(*)
         FROM ai_analysis_jobs j
        WHERE j.provider='youtube' AND j.state='waiting') AS waiting,
      (SELECT COUNT(*)
         FROM ai_analysis_jobs j
        WHERE j.provider='youtube' AND j.state='running') AS running,
      (SELECT COUNT(*)
         FROM ai_analysis_jobs j
        WHERE j.provider='youtube' AND j.state='error') AS errors
  `).get();
  return {
    transcripts: Number(row.transcripts ?? 0),
    analyzed: Number(row.analyzed ?? 0),
    waiting: Number(row.waiting ?? 0),
    running: Number(row.running ?? 0),
    errors: Number(row.errors ?? 0),
  };
}

module.exports = { getResult, list, stats };
