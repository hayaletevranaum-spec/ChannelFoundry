const analysis = require("./ai-analysis-public.cjs");

function stats(db) {
  const base = analysis.stats(db);
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

module.exports = { ...analysis, stats };
