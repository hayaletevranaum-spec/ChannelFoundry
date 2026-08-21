const current = require("./ai-analysis-current.cjs");
const legacy = require("./ai-analysis-legacy.cjs");
const support = require("./ai-support-records.cjs");

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function stats(db) {
  const base = tableExists(db, "source_transcripts")
    ? legacy.stats(db)
    : { transcripts: 0, analyzed: 0, waiting: 0, running: 0, errors: 0 };
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN er.state='curated' THEN 1 ELSE 0 END) AS curated,
      SUM(CASE WHEN er.state='excluded' THEN 1 ELSE 0 END) AS excluded,
      SUM(CASE WHEN COALESCE(er.state,'pending')='pending' THEN 1 ELSE 0 END) AS editorialPending
    FROM source_ai_analyses sa
    LEFT JOIN ai_analysis_editorial_reviews er
      ON er.provider=sa.provider AND er.external_id=sa.external_id
    WHERE sa.provider='youtube'
  `).get();
  Object.defineProperties(base, {
    curated: { value: Number(row?.curated ?? 0), enumerable: false },
    excluded: { value: Number(row?.excluded ?? 0), enumerable: false },
    editorialPending: { value: Number(row?.editorialPending ?? 0), enumerable: false },
  });
  return base;
}

function publicVideoSummaries(db) {
  if (!tableExists(db, "source_ai_analyses")) return [];
  return db.prepare(`
    SELECT external_id AS videoId, summary
    FROM source_ai_analyses
    WHERE provider='youtube' AND TRIM(summary) <> ''
    ORDER BY external_id ASC
  `).all().map((row) => ({
    videoId: String(row.videoId ?? "").trim(),
    summary: String(row.summary ?? "").trim().replace(/\s+/g, " ").slice(0, 1800),
  })).filter((entry) => entry.videoId && entry.summary);
}

module.exports = {
  ...current,
  stats,
  supportRecords: support.supportRecords,
  supportSources: support.supportSources,
  saveSupportRecord: support.saveSupportRecord,
  publicVideoSummaries,
};