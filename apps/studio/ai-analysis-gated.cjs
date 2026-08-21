const legacy = require("./ai-analysis.cjs");
const editorial = require("./ai-analysis-editorial.cjs");

function ensureSchema(db) {
  legacy.ensureSchema(db);
  editorial.ensureSchema(db);
}

function complete(db, videoId, model, analysis) {
  ensureSchema(db);
  legacy.complete(db, videoId, model, analysis);
  const id = String(videoId ?? "").trim();
  db.prepare(`
    UPDATE source_ai_analyses
    SET sponsors_json=?, contributors_json=?, updated_at=CURRENT_TIMESTAMP
    WHERE provider='youtube' AND external_id=?
  `).run(
    JSON.stringify(Array.isArray(analysis?.sponsors) ? analysis.sponsors : []),
    JSON.stringify(Array.isArray(analysis?.contributors) ? analysis.contributors : []),
    id,
  );
  editorial.resetReview(db, id);
  return getResult(db, id);
}

function getResult(db, videoId) {
  ensureSchema(db);
  const result = legacy.getResult(db, videoId);
  if (!result) return null;
  const row = db.prepare(`
    SELECT sponsors_json AS sponsorsJson, contributors_json AS contributorsJson
    FROM source_ai_analyses
    WHERE provider='youtube' AND external_id=?
  `).get(String(videoId ?? "").trim());
  const parse = (value) => {
    try {
      const parsed = JSON.parse(String(value ?? "[]"));
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
    } catch { return []; }
  };
  return {
    ...result,
    sponsors: parse(row?.sponsorsJson),
    contributors: parse(row?.contributorsJson),
  };
}

function list(db) {
  ensureSchema(db);
  const reviews = new Map(db.prepare(`
    SELECT external_id AS videoId, state
    FROM ai_analysis_editorial_reviews
    WHERE provider='youtube'
  `).all().map((row) => [String(row.videoId), String(row.state)]));
  return legacy.list(db).map((video) => ({
    ...video,
    editorialState: video.hasAnalysis ? (reviews.get(String(video.videoId)) || "pending") : "",
  }));
}

function stats(db) {
  ensureSchema(db);
  const base = legacy.stats(db);
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN er.state='curated' THEN 1 ELSE 0 END) AS curated,
      SUM(CASE WHEN er.state='excluded' THEN 1 ELSE 0 END) AS excluded,
      SUM(CASE WHEN sa.external_id IS NOT NULL AND COALESCE(er.state,'pending')='pending' THEN 1 ELSE 0 END) AS editorialPending
    FROM source_ai_analyses sa
    LEFT JOIN ai_analysis_editorial_reviews er
      ON er.provider=sa.provider AND er.external_id=sa.external_id
    WHERE sa.provider='youtube'
  `).get();
  return {
    ...base,
    editorialPending: Number(row?.editorialPending ?? 0),
    curated: Number(row?.curated ?? 0),
    excluded: Number(row?.excluded ?? 0),
  };
}

module.exports = {
  ...legacy,
  ensureSchema,
  complete,
  getResult,
  list,
  stats,
  editorialPackage: editorial.editorialPackage,
  editorialSave: editorial.saveReview,
  curatedResult: editorial.curatedResult,
  curatedSources: editorial.curatedSources,
  supportRecords: editorial.supportRecords,
};
