const { collectVideoIds, normalizeUniverse, safeJson } = require("./universe-normalizer.cjs");
const { privateConfig } = require("./universe-merge-ai.cjs");
const aiAnalysis = require("./ai-analysis.cjs");
const universeIngest = require("./universe-ingest.cjs");

const SOURCE_BATCH = 6;
const REDUCE_BATCH = 4;
const MAX_INGEST_SELECTION = 10;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function editorialBacklog(db) {
  const drafts = tableExists(db, "universe_workspace_nodes")
    ? Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_nodes WHERE state='draft'").get()?.count ?? 0)
    : 0;
  const revisions = tableExists(db, "universe_workspace_revisions")
    ? Number(db.prepare("SELECT COUNT(*) AS count FROM universe_workspace_revisions WHERE state='pending'").get()?.count ?? 0)
    : 0;
  return { drafts, revisions, total: drafts + revisions };
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS universe_merge_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL CHECK (state IN ('waiting','running','done','error')) DEFAULT 'waiting',
      model TEXT NOT NULL DEFAULT '',
      analysis_count INTEGER NOT NULL DEFAULT 0,
      source_signature TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_merge_chunks (
      run_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      batch_index INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('waiting','running','done','error')) DEFAULT 'waiting',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(run_id, level, batch_index),
      FOREIGN KEY(run_id) REFERENCES universe_merge_runs(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_universe_merge_runs_state ON universe_merge_runs(state, id DESC);
    CREATE INDEX IF NOT EXISTS idx_universe_merge_chunks_state ON universe_merge_chunks(run_id, state, level, batch_index);
  `);
  universeIngest.ensureSchema(db);
}

function pendingSourceEntries(db) {
  ensureSchema(db);
  const sourceMeta = tableExists(db, "youtube_videos") ? db.prepare(`
    SELECT title, published_at AS publishedAt
    FROM youtube_videos
    WHERE video_id=?
  `) : null;
  return universeIngest.pendingSources(db).map((entry) => {
    const analysis = entry.source;
    const metadata = sourceMeta?.get(analysis.videoId) ?? {};
    return {
      ...entry,
      mergeSource: {
        videoId: String(analysis.videoId),
        title: String(metadata.title ?? analysis.title ?? ""),
        publishedAt: String(metadata.publishedAt ?? ""),
        summary: String(analysis.summary ?? ""),
        topics: Array.isArray(analysis.topics) ? analysis.topics : [],
        storyHints: Array.isArray(analysis.storyHints) ? analysis.storyHints : [],
        storyBeats: Array.isArray(analysis.storyBeats) ? analysis.storyBeats : [],
        characters: Array.isArray(analysis.characters) ? analysis.characters : [],
        locations: Array.isArray(analysis.locations) ? analysis.locations : [],
        objects: Array.isArray(analysis.objects) ? analysis.objects : [],
        scenes: Array.isArray(analysis.scenes) ? analysis.scenes : [],
        context: analysis.context && typeof analysis.context === "object" ? analysis.context : {},
      },
    };
  }).sort((left, right) => {
    if (!left.mergeSource.publishedAt && right.mergeSource.publishedAt) return 1;
    if (left.mergeSource.publishedAt && !right.mergeSource.publishedAt) return -1;
    return left.mergeSource.publishedAt.localeCompare(right.mergeSource.publishedAt) || left.mergeSource.videoId.localeCompare(right.mergeSource.videoId);
  });
}

function pendingSourcePreview(db) {
  return pendingSourceEntries(db).slice(0, MAX_INGEST_SELECTION).map((entry) => ({
    videoId: entry.mergeSource.videoId,
    title: entry.mergeSource.title,
    publishedAt: entry.mergeSource.publishedAt,
  }));
}

function selectPendingEntries(db, input = {}) {
  const window = pendingSourceEntries(db).slice(0, MAX_INGEST_SELECTION);
  const supplied = Array.isArray(input?.videoIds);
  if (!supplied) return window;
  const requested = [...new Set(input.videoIds.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!requested.length) throw new Error("Evrene işlenecek en az bir kaynak seçilmeli.");
  if (requested.length > MAX_INGEST_SELECTION) {
    throw new Error(`Bir Evrene İşleme turunda en fazla ${MAX_INGEST_SELECTION} kaynak seçilebilir.`);
  }
  const allowed = new Set(window.map((entry) => entry.mergeSource.videoId));
  const outside = requested.filter((videoId) => !allowed.has(videoId));
  if (outside.length) {
    throw new Error(`Evrene İşleme kronolojik ilerler. Yalnız sıradaki en eski ${MAX_INGEST_SELECTION} kaynak arasından seçim yapılabilir.`);
  }
  const requestedSet = new Set(requested);
  return window.filter((entry) => requestedSet.has(entry.mergeSource.videoId));
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function start(db, userDataPath, input = {}) {
  ensureSchema(db);
  const awaitingApplyRunId = universeIngest.unappliedRun(db);
  if (awaitingApplyRunId) throw new Error(`Evrene İşleme çalışması #${awaitingApplyRunId} tamamlandı fakat henüz çalışma alanına uygulanmadı. Yeni kaynakları işlemeden önce bu sonucu çalışma alanına uygula.`);
  const backlog = editorialBacklog(db);
  if (backlog.revisions) throw new Error(`Yeni Evrene İşleme turundan önce bekleyen ${backlog.revisions} revizyon kararını tamamla. Onaylanmamış taslak kayıtlar yeni batch'i engellemez.`);
  const config = privateConfig(userDataPath);
  const pendingEntries = selectPendingEntries(db, input);
  if (!pendingEntries.length) throw new Error("Evrene işlenecek seçili çözümleme yok.");
  const active = db.prepare("SELECT id FROM universe_merge_runs WHERE state IN ('waiting','running') ORDER BY id DESC LIMIT 1").get();
  if (active) throw new Error("Devam eden bir Evrene İşleme işi zaten var.");
  const sourceItems = pendingEntries.map((entry) => entry.mergeSource);
  const signature = sourceItems.map((item) => item.videoId).sort().join("|");
  const info = db.prepare(`INSERT INTO universe_merge_runs (state, model, analysis_count, source_signature) VALUES ('waiting', ?, ?, ?)`).run(config.displayModel || config.model, sourceItems.length, signature);
  const runId = Number(info.lastInsertRowid);
  const insert = db.prepare(`INSERT INTO universe_merge_chunks (run_id, level, batch_index, state, input_json) VALUES (?, 0, ?, 'waiting', ?)`);
  db.exec("BEGIN IMMEDIATE;");
  try {
    chunk(sourceItems, SOURCE_BATCH).forEach((batch, index) => insert.run(runId, index, JSON.stringify({ videos: batch })));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  universeIngest.prepareRun(db, runId, pendingEntries);
  return status(db, runId);
}

function latestRunId(db) {
  const row = db.prepare("SELECT id FROM universe_merge_runs ORDER BY id DESC LIMIT 1").get();
  return row ? Number(row.id) : null;
}

function latestCompletedRunId(db) {
  const row = db.prepare("SELECT id FROM universe_merge_runs WHERE state = 'done' ORDER BY id DESC LIMIT 1").get();
  return row ? Number(row.id) : null;
}

function signatureIds(value) {
  return new Set(String(value ?? "").split("|").map((entry) => entry.trim()).filter(Boolean));
}

function sourceCoverage(universe, sourceSignature) {
  const expected = signatureIds(sourceSignature);
  const actual = collectVideoIds(universe);
  const missing = [...expected].filter((id) => !actual.has(id));
  return {
    expected: expected.size,
    actual: [...expected].filter((id) => actual.has(id)).length,
    missing,
    complete: expected.size > 0 && missing.length === 0,
  };
}

function status(db, requestedRunId = null) {
  ensureSchema(db);
  aiAnalysis.ensureSchema(db);
  const runId = requestedRunId == null ? latestRunId(db) : Number(requestedRunId);
  const ingest = { ...universeIngest.status(db), batchLimit: MAX_INGEST_SELECTION, nextSources: pendingSourcePreview(db), backlog: editorialBacklog(db) };
  if (!runId) return { availableAnalyses: ingest.pending, ingest, run: null };
  const run = db.prepare(`SELECT id, state, model, analysis_count AS analysisCount, error, created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt FROM universe_merge_runs WHERE id = ?`).get(runId);
  if (!run) return { availableAnalyses: ingest.pending, ingest, run: null };
  const progress = db.prepare(`SELECT COUNT(*) AS totalChunks, SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS doneChunks, SUM(CASE WHEN state='error' THEN 1 ELSE 0 END) AS errorChunks, MAX(level) AS level FROM universe_merge_chunks WHERE run_id = ?`).get(runId);
  return {
    availableAnalyses: ingest.pending,
    ingest,
    run: {
      ...run,
      id: Number(run.id),
      analysisCount: Number(run.analysisCount),
      totalChunks: Number(progress.totalChunks ?? 0),
      doneChunks: Number(progress.doneChunks ?? 0),
      errorChunks: Number(progress.errorChunks ?? 0),
      level: Number(progress.level ?? 0),
    },
  };
}

function latestResult(db, requestedRunId = null) {
  ensureSchema(db);
  const runId = requestedRunId == null ? latestCompletedRunId(db) : Number(requestedRunId);
  if (!runId) return null;
  const row = db.prepare("SELECT id, state, model, analysis_count AS analysisCount, source_signature AS sourceSignature, result_json AS resultJson, created_at AS createdAt, finished_at AS finishedAt FROM universe_merge_runs WHERE id = ?").get(runId);
  if (!row) return null;
  const raw = safeJson(row.resultJson, {});
  const expected = signatureIds(row.sourceSignature);
  const universe = normalizeUniverse(raw, expected.size ? expected : collectVideoIds(raw));
  const coverage = sourceCoverage(universe, row.sourceSignature);
  return {
    id: Number(row.id),
    state: row.state,
    model: row.model,
    analysisCount: Number(row.analysisCount),
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    universe,
    sourceCoverage: { expected: coverage.expected, actual: coverage.actual, missing: coverage.missing },
    complete: coverage.complete,
  };
}

function resetInterrupted(db) {
  ensureSchema(db);
  db.exec(`UPDATE universe_merge_chunks SET state='waiting', error='', started_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE state='running'; UPDATE universe_merge_runs SET state='waiting', error='', updated_at=CURRENT_TIMESTAMP WHERE state='running';`);
}

function cancelActive(db) {
  ensureSchema(db);
  const active = db.prepare("SELECT id FROM universe_merge_runs WHERE state IN ('waiting','running') ORDER BY id DESC LIMIT 1").get();
  if (!active) return { canceled: 0, runId: null };
  const runId = Number(active.id);
  let canceled = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    universeIngest.discardRun(db, runId);
    db.prepare("DELETE FROM universe_merge_chunks WHERE run_id=?").run(runId);
    const result = db.prepare("DELETE FROM universe_merge_runs WHERE id=? AND state IN ('waiting','running')").run(runId);
    canceled = Number(result.changes);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { canceled, runId: canceled ? runId : null };
}

function claimNext(db) {
  ensureSchema(db);
  const run = db.prepare("SELECT id FROM universe_merge_runs WHERE state IN ('waiting','running') ORDER BY id DESC LIMIT 1").get();
  if (!run) return null;
  const row = db.prepare(`SELECT run_id AS runId, level, batch_index AS batchIndex, input_json AS inputJson FROM universe_merge_chunks WHERE run_id=? AND state='waiting' ORDER BY level ASC, batch_index ASC LIMIT 1`).get(run.id);
  if (!row) return { runId: Number(run.id), idle: true };
  const changed = db.prepare(`UPDATE universe_merge_chunks SET state='running', started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND level=? AND batch_index=? AND state='waiting'`).run(row.runId, row.level, row.batchIndex);
  if (!changed.changes) return null;
  db.prepare("UPDATE universe_merge_runs SET state='running', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.runId);
  return { runId: Number(row.runId), level: Number(row.level), batchIndex: Number(row.batchIndex), input: safeJson(row.inputJson, {}) };
}

function completeChunk(db, job, output) {
  db.prepare(`UPDATE universe_merge_chunks SET state='done', output_json=?, error='', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND level=? AND batch_index=?`).run(JSON.stringify(output), job.runId, job.level, job.batchIndex);
  const model = String(output?.model ?? "").trim();
  db.prepare("UPDATE universe_merge_runs SET model=CASE WHEN ? <> '' THEN ? ELSE model END, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(model, model, job.runId);
}

function failChunk(db, job, error) {
  const message = String(error instanceof Error ? error.message : String(error)).trim().slice(0, 2000);
  db.prepare(`UPDATE universe_merge_chunks SET state='error', error=?, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND level=? AND batch_index=?`).run(message, job.runId, job.level, job.batchIndex);
  db.prepare(`UPDATE universe_merge_runs SET state='error', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(message, job.runId);
}

function advance(db, runId) {
  const error = db.prepare("SELECT error FROM universe_merge_chunks WHERE run_id=? AND state='error' LIMIT 1").get(runId);
  if (error) {
    db.prepare("UPDATE universe_merge_runs SET state='error', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(error.error || "Evrene İşleme parçası başarısız.", runId);
    return status(db, runId);
  }
  const pending = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_chunks WHERE run_id=? AND state IN ('waiting','running')").get(runId)?.count ?? 0);
  if (pending) return status(db, runId);
  const level = Number(db.prepare("SELECT MAX(level) AS level FROM universe_merge_chunks WHERE run_id=?").get(runId)?.level ?? 0);
  const rows = db.prepare("SELECT output_json AS outputJson FROM universe_merge_chunks WHERE run_id=? AND level=? AND state='done' ORDER BY batch_index").all(runId, level);
  if (!rows.length) return status(db, runId);
  if (rows.length === 1) {
    const final = safeJson(rows[0].outputJson, {});
    const universe = final.universe ?? final;
    const sourceSignature = db.prepare("SELECT source_signature AS sourceSignature FROM universe_merge_runs WHERE id=?").get(runId)?.sourceSignature ?? "";
    const coverage = sourceCoverage(universe, sourceSignature);
    if (!coverage.complete) {
      const message = `Evrene İşleme eksik sonuç verdi: ${coverage.actual}/${coverage.expected} kaynak video korundu, ${coverage.missing.length} kaynak kayboldu.`;
      db.prepare(`UPDATE universe_merge_runs SET state='error', result_json=?, error=?, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(JSON.stringify(universe), message, runId);
      return status(db, runId);
    }
    db.prepare(`UPDATE universe_merge_runs SET state='done', result_json=?, error='', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(JSON.stringify(universe), runId);
    return status(db, runId);
  }
  const nextLevel = level + 1;
  const exists = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_merge_chunks WHERE run_id=? AND level=?").get(runId, nextLevel)?.count ?? 0);
  if (!exists) {
    const outputs = rows.map((row) => safeJson(row.outputJson, {})).map((entry) => entry.universe ?? entry);
    const insert = db.prepare("INSERT INTO universe_merge_chunks (run_id, level, batch_index, state, input_json) VALUES (?, ?, ?, 'waiting', ?)");
    chunk(outputs, REDUCE_BATCH).forEach((batch, index) => insert.run(runId, nextLevel, index, JSON.stringify({ partials: batch })));
  }
  return status(db, runId);
}

module.exports = { MAX_INGEST_SELECTION, advance, cancelActive, claimNext, completeChunk, editorialBacklog, ensureSchema, failChunk, latestResult, pendingSourcePreview, resetInterrupted, selectPendingEntries, sourceCoverage, start, status };
