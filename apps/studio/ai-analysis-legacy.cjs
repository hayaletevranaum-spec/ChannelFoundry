const { ensureSchema } = require("./ai-analysis-schema.cjs");
const results = require("./ai-analysis-results.cjs");

function resetInterrupted(db) {
  ensureSchema(db);
  const result = db.prepare(`
    UPDATE ai_analysis_jobs
    SET state = 'waiting', error = '', started_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE state = 'running'
  `).run();
  return Number(result.changes);
}

function enqueue(db, input) {
  ensureSchema(db);
  const ids = [...new Set((Array.isArray(input?.videoIds) ? input.videoIds : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  if (!ids.length) throw new Error("AI kuyruğuna eklenecek video seçilmedi.");
  if (ids.length > 250) throw new Error("Tek seferde en fazla 250 video AI kuyruğuna eklenebilir.");
  const force = Boolean(input?.force);
  const exists = db.prepare(`
    SELECT 1 AS ok
    FROM youtube_videos yv
    JOIN source_transcripts st ON st.provider='youtube' AND st.external_id=yv.video_id
    WHERE yv.video_id = ?
  `);
  const statement = db.prepare(`
    INSERT INTO ai_analysis_jobs (provider, external_id, state, error, attempts, queued_at, started_at, finished_at)
    VALUES ('youtube', ?, 'waiting', '', 0, CURRENT_TIMESTAMP, NULL, NULL)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      state = CASE WHEN ? = 1 OR ai_analysis_jobs.state <> 'done' THEN 'waiting' ELSE ai_analysis_jobs.state END,
      error = CASE WHEN ? = 1 OR ai_analysis_jobs.state <> 'done' THEN '' ELSE ai_analysis_jobs.error END,
      queued_at = CASE WHEN ? = 1 OR ai_analysis_jobs.state <> 'done' THEN CURRENT_TIMESTAMP ELSE ai_analysis_jobs.queued_at END,
      started_at = CASE WHEN ? = 1 OR ai_analysis_jobs.state <> 'done' THEN NULL ELSE ai_analysis_jobs.started_at END,
      finished_at = CASE WHEN ? = 1 OR ai_analysis_jobs.state <> 'done' THEN NULL ELSE ai_analysis_jobs.finished_at END,
      updated_at = CURRENT_TIMESTAMP
  `);
  let accepted = 0;
  let skipped = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const id of ids) {
      if (!exists.get(id)) { skipped += 1; continue; }
      statement.run(id, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0);
      accepted += 1;
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { ok: true, requested: ids.length, accepted, skipped };
}

function claimNext(db) {
  ensureSchema(db);
  const row = db.prepare(`
    SELECT j.provider, j.external_id AS videoId
    FROM ai_analysis_jobs j
    JOIN source_transcripts st ON st.provider=j.provider AND st.external_id=j.external_id
    WHERE j.provider='youtube' AND j.state='waiting'
    ORDER BY j.queued_at ASC LIMIT 1
  `).get();
  if (!row) return null;
  const result = db.prepare(`
    UPDATE ai_analysis_jobs SET state='running', error='', attempts=attempts+1,
      started_at=CURRENT_TIMESTAMP, finished_at=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE provider=? AND external_id=? AND state='waiting'
  `).run(row.provider, row.videoId);
  return Number(result.changes) ? { provider: row.provider, videoId: String(row.videoId) } : null;
}

function cancelPending(db) {
  ensureSchema(db);
  const result = db.prepare(`
    DELETE FROM ai_analysis_jobs
    WHERE provider='youtube' AND state IN ('waiting', 'running')
  `).run();
  return { canceled: Number(result.changes) };
}

function sourceContext(db, videoId) {
  ensureSchema(db);
  const id = String(videoId ?? "").trim();
  const row = db.prepare(`
    SELECT yv.video_id AS videoId, yv.title, yv.published_at AS publishedAt,
           yv.duration_seconds AS durationSeconds, yv.canonical_url AS url,
           st.language, st.text, ci.key AS contentKey,
           ci.title AS editorialTitle, ci.summary AS editorialSummary
    FROM youtube_videos yv
    JOIN source_transcripts st ON st.provider = 'youtube' AND st.external_id = yv.video_id
    LEFT JOIN content_sources cs ON cs.provider = 'youtube' AND cs.external_id = yv.video_id
    LEFT JOIN content_items ci ON ci.key = cs.content_key
    WHERE yv.video_id = ?
  `).get(id);
  if (!row) throw new Error("AI analizi için yerel transkripti bulunan kaynak video bulunamadı.");
  return {
    videoId: String(row.videoId),
    title: String(row.title ?? ""),
    publishedAt: String(row.publishedAt ?? ""),
    durationSeconds: row.durationSeconds == null ? null : Number(row.durationSeconds),
    url: String(row.url ?? ""),
    language: String(row.language ?? ""),
    transcript: String(row.text ?? ""),
    contentKey: row.contentKey ? String(row.contentKey) : null,
    editorialTitle: String(row.editorialTitle ?? ""),
    editorialSummary: String(row.editorialSummary ?? ""),
  };
}

function complete(db, videoId, model, analysis) {
  ensureSchema(db);
  const id = String(videoId ?? "").trim();
  const title = String(analysis?.title ?? "").trim();
  const summary = String(analysis?.summary ?? "").trim();
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      INSERT INTO source_ai_analyses (
        provider, external_id, model, title, summary, topics_json,
        story_beats_json, story_hints_json, cover_visual_json,
        characters_json, locations_json, objects_json, scenes_json
      ) VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        model=excluded.model, title=excluded.title, summary=excluded.summary,
        topics_json=excluded.topics_json, story_beats_json=excluded.story_beats_json,
        story_hints_json=excluded.story_hints_json, cover_visual_json=excluded.cover_visual_json,
        characters_json=excluded.characters_json, locations_json=excluded.locations_json,
        objects_json=excluded.objects_json, scenes_json=excluded.scenes_json, updated_at=CURRENT_TIMESTAMP
    `).run(
      id,
      String(model ?? ""),
      title,
      summary,
      JSON.stringify(Array.isArray(analysis?.topics) ? analysis.topics : []),
      JSON.stringify(Array.isArray(analysis?.storyBeats) ? analysis.storyBeats : []),
      JSON.stringify(Array.isArray(analysis?.storyHints) ? analysis.storyHints : []),
      JSON.stringify(analysis?.coverVisual && typeof analysis.coverVisual === "object" ? analysis.coverVisual : {}),
      JSON.stringify(Array.isArray(analysis?.characters) ? analysis.characters : []),
      JSON.stringify(Array.isArray(analysis?.locations) ? analysis.locations : []),
      JSON.stringify(Array.isArray(analysis?.objects) ? analysis.objects : []),
      JSON.stringify(Array.isArray(analysis?.scenes) ? analysis.scenes : []),
    );
    db.prepare(`
      UPDATE content_items
      SET title = CASE WHEN ? <> '' THEN ? ELSE title END,
          summary = CASE WHEN ? <> '' THEN ? ELSE summary END,
          updated_at = CURRENT_TIMESTAMP
      WHERE key = (
        SELECT content_key
        FROM content_sources
        WHERE provider = 'youtube' AND external_id = ?
        LIMIT 1
      )
    `).run(title, title, summary, summary, id);
    db.prepare(`
      UPDATE ai_analysis_jobs SET state='done', error='', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE provider='youtube' AND external_id=?
    `).run(id);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return results.getResult(db, id);
}

function fail(db, videoId, error) {
  ensureSchema(db);
  const id = String(videoId ?? "").trim();
  const message = error instanceof Error ? error.message : String(error ?? "Bilinmeyen AI hatası");
  db.prepare(`
    UPDATE ai_analysis_jobs SET state='error', error=?, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE provider='youtube' AND external_id=?
  `).run(message.slice(0, 2000), id);
  return { videoId: id, error: message.slice(0, 2000) };
}

module.exports = {
  ensureSchema,
  resetInterrupted,
  enqueue,
  cancelPending,
  claimNext,
  sourceContext,
  complete,
  fail,
  getResult: results.getResult,
  list: results.list,
  stats: results.stats,
};
