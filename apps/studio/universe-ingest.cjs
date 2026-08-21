const crypto = require("node:crypto");
const aiAnalysis = require("./ai-analysis.cjs");

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function ensureSchema(db) {
  aiAnalysis.ensureSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS universe_ingest_sources (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      last_run_id INTEGER NOT NULL DEFAULT 0,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_ingest_runs (
      run_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('prepared','applied','stale','discarded')) DEFAULT 'prepared',
      source_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_ingest_run_sources (
      run_id INTEGER NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY(run_id, provider, external_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_universe_ingest_runs_state
      ON universe_ingest_runs(state, run_id DESC);
    CREATE INDEX IF NOT EXISTS idx_universe_ingest_sources_run
      ON universe_ingest_sources(last_run_id, processed_at DESC);
  `);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function universePayload(source) {
  return {
    videoId: String(source?.videoId ?? ""),
    title: String(source?.title ?? ""),
    summary: String(source?.summary ?? ""),
    topics: Array.isArray(source?.topics) ? source.topics : [],
    storyHints: Array.isArray(source?.storyHints) ? source.storyHints : [],
    storyBeats: Array.isArray(source?.storyBeats) ? source.storyBeats : [],
    characters: Array.isArray(source?.characters) ? source.characters : [],
    locations: Array.isArray(source?.locations) ? source.locations : [],
    objects: Array.isArray(source?.objects) ? source.objects : [],
    scenes: Array.isArray(source?.scenes) ? source.scenes : [],
    context: source?.context && typeof source.context === "object" ? source.context : {},
  };
}

function fingerprint(source) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(universePayload(source)))).digest("hex");
}

function hasUniverseMaterial(source) {
  return ["storyHints", "storyBeats", "characters", "locations", "objects", "scenes"]
    .some((key) => Array.isArray(source?.[key]) && source[key].length > 0);
}

function curatedSourceMap(db) {
  ensureSchema(db);
  return new Map(aiAnalysis.curatedSources(db).map((source) => [String(source.videoId), source]));
}

function eligibleSources(db) {
  return [...curatedSourceMap(db).values()].filter(hasUniverseMaterial);
}

function processedSourceIds(db) {
  ensureSchema(db);
  return new Set(db.prepare(`
    SELECT external_id AS videoId
    FROM universe_ingest_sources
    WHERE provider='youtube'
  `).all().map((row) => String(row.videoId)));
}

function pendingSources(db) {
  ensureSchema(db);
  const processed = processedSourceIds(db);
  return eligibleSources(db)
    .filter((source) => !processed.has(String(source.videoId)))
    .map((source) => ({
      source,
      fingerprint: fingerprint(source),
      reason: "new",
      pending: true,
    }));
}

function withdrawalSources(db) {
  ensureSchema(db);
  const curated = curatedSourceMap(db);
  const states = new Map(db.prepare(`
    SELECT external_id AS videoId, state
    FROM ai_analysis_editorial_reviews
    WHERE provider='youtube'
  `).all().map((row) => [String(row.videoId), String(row.state)]));
  return db.prepare(`
    SELECT external_id AS videoId, last_run_id AS lastRunId, processed_at AS processedAt
    FROM universe_ingest_sources
    WHERE provider='youtube'
    ORDER BY processed_at ASC, external_id ASC
  `).all().map((row) => ({
    videoId: String(row.videoId),
    lastRunId: Number(row.lastRunId || 0),
    processedAt: String(row.processedAt || ""),
  })).filter((row) => {
    const state = states.get(row.videoId) || "pending";
    if (state === "excluded") return true;
    if (state !== "curated") return false;
    const source = curated.get(row.videoId);
    return !source || !hasUniverseMaterial(source);
  });
}

function runRows(db, runId) {
  ensureSchema(db);
  return db.prepare(`
    SELECT external_id AS videoId, fingerprint
    FROM universe_ingest_run_sources
    WHERE run_id=? AND provider='youtube'
    ORDER BY external_id
  `).all(Number(runId)).map((row) => ({ videoId: String(row.videoId), fingerprint: String(row.fingerprint) }));
}

function currentFingerprintMap(db) {
  return new Map(eligibleSources(db).map((source) => [String(source.videoId), fingerprint(source)]));
}

function freshness(db, runId) {
  const expected = runRows(db, runId);
  if (!expected.length) return { tracked: false, fresh: true, changed: [] };
  const current = currentFingerprintMap(db);
  const changed = expected.filter((entry) => current.get(entry.videoId) !== entry.fingerprint).map((entry) => entry.videoId);
  return { tracked: true, fresh: changed.length === 0, changed };
}

function assertRunFresh(db, runId) {
  const result = freshness(db, runId);
  if (result.tracked && !result.fresh) {
    throw new Error(`Evrene işleme çalışması oluşturulduktan sonra ${result.changed.length} kaynak yeniden ayıklandı veya evren dışı bırakıldı. Eski sonucu uygulama; yeni bir Evrene İşleme çalışması oluştur.`);
  }
  return result;
}

function prepareRun(db, runId, entries) {
  ensureSchema(db);
  const values = Array.isArray(entries) ? entries : [];
  const insert = db.prepare(`
    INSERT INTO universe_ingest_run_sources (run_id, provider, external_id, fingerprint)
    VALUES (?, 'youtube', ?, ?)
  `);
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      INSERT INTO universe_ingest_runs (run_id, state, source_count, created_at, applied_at)
      VALUES (?, 'prepared', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(run_id) DO UPDATE SET state='prepared', source_count=excluded.source_count, created_at=CURRENT_TIMESTAMP, applied_at=NULL
    `).run(Number(runId), values.length);
    db.prepare("DELETE FROM universe_ingest_run_sources WHERE run_id=?").run(Number(runId));
    for (const entry of values) insert.run(Number(runId), String(entry.source.videoId), String(entry.fingerprint));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function markApplied(db, runId) {
  ensureSchema(db);
  const rows = runRows(db, runId);
  if (!rows.length) return { tracked: false, processed: 0 };
  assertRunFresh(db, runId);
  const upsert = db.prepare(`
    INSERT INTO universe_ingest_sources (provider, external_id, fingerprint, last_run_id, processed_at, updated_at)
    VALUES ('youtube', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      fingerprint=excluded.fingerprint,
      last_run_id=excluded.last_run_id,
      processed_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  `);
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rows) upsert.run(row.videoId, row.fingerprint, Number(runId));
    db.prepare("UPDATE universe_ingest_runs SET state='applied', applied_at=CURRENT_TIMESTAMP WHERE run_id=?").run(Number(runId));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { tracked: true, processed: rows.length };
}

function discardRun(db, runId) {
  ensureSchema(db);
  db.prepare("UPDATE universe_ingest_runs SET state='discarded' WHERE run_id=? AND state='prepared'").run(Number(runId));
}

function unappliedRun(db) {
  ensureSchema(db);
  if (!tableExists(db, "universe_merge_runs")) return null;
  const rows = db.prepare(`
    SELECT ir.run_id AS runId
    FROM universe_ingest_runs ir
    JOIN universe_merge_runs mr ON mr.id=ir.run_id
    WHERE ir.state='prepared' AND mr.state='done'
    ORDER BY ir.run_id DESC
  `).all();
  for (const row of rows) {
    const check = freshness(db, row.runId);
    if (check.fresh) return Number(row.runId);
    db.prepare("UPDATE universe_ingest_runs SET state='stale' WHERE run_id=? AND state='prepared'").run(Number(row.runId));
  }
  return null;
}

function status(db) {
  ensureSchema(db);
  const pending = pendingSources(db);
  const eligible = eligibleSources(db);
  const processed = Number(db.prepare("SELECT COUNT(*) AS count FROM universe_ingest_sources WHERE provider='youtube'").get()?.count ?? 0);
  const withdrawals = withdrawalSources(db);
  return {
    pending: pending.length,
    newSources: pending.length,
    changedSources: 0,
    eligible: eligible.length,
    processed,
    withdrawals: withdrawals.length,
    awaitingApplyRunId: unappliedRun(db),
  };
}

module.exports = {
  assertRunFresh,
  discardRun,
  eligibleSources,
  ensureSchema,
  fingerprint,
  freshness,
  hasUniverseMaterial,
  markApplied,
  pendingSources,
  prepareRun,
  processedSourceIds,
  status,
  universePayload,
  unappliedRun,
  withdrawalSources,
};
