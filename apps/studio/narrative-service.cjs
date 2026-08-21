const narrativeStore = require("./narrative-store.cjs");
const aiContract = require("./narrative-ai-contract.cjs");

function runDrafts(db, runId) {
  narrativeStore.ensureSchema(db);
  const rows = db.prepare(`
    SELECT DISTINCT section_key AS sectionKey
    FROM narrative_section_revisions
    WHERE run_id=?
    ORDER BY section_key
  `).all(Number(runId));
  const result = [];
  for (const row of rows) {
    const revision = narrativeStore.listSectionRevisions(db, String(row.sectionKey))
      .find((entry) => entry.runId === Number(runId));
    if (revision) result.push(revision);
  }
  return result.sort((a, b) => a.position - b.position || a.sectionKey.localeCompare(b.sectionKey));
}

function latestWorkingRunId(db) {
  narrativeStore.ensureSchema(db);
  narrativeStore.refreshStale(db);
  const latestAppliedId = narrativeStore.latestAppliedRun(db)?.id ?? 0;
  const row = db.prepare(`
    SELECT id FROM narrative_runs
    WHERE state IN ('prepared','stale') AND id>?
    ORDER BY id DESC LIMIT 1
  `).get(Number(latestAppliedId));
  return row?.id == null ? null : Number(row.id);
}

function status(db) {
  const base = narrativeStore.status(db);
  const next = narrativeStore.buildInput(db);
  const workingRunId = latestWorkingRunId(db);
  return {
    ...base,
    workingRun: workingRunId ? getRun(db, workingRunId) : null,
    next: {
      hasChanges: next.hasChanges,
      baselineRunId: next.baselineRunId,
      changes: next.changes.length,
      removed: next.removed.length,
    },
  };
}

function prepare(db, input = {}) {
  const run = narrativeStore.prepareRun(db, input);
  return { run, request: aiContract.buildRequest(db, run.id), drafts: runDrafts(db, run.id) };
}

function getRun(db, runId) {
  narrativeStore.ensureSchema(db);
  narrativeStore.refreshStale(db);
  const run = narrativeStore.getRun(db, runId);
  if (!run) return null;
  return {
    run,
    drafts: runDrafts(db, run.id),
    request: run.state === "prepared" && !narrativeStore.isRunStale(db, run.id)
      ? aiContract.buildRequest(db, run.id)
      : null,
  };
}

function buildRequest(db, runId) {
  return aiContract.buildRequest(db, runId);
}

function recordModel(db, runId, model) {
  narrativeStore.ensureSchema(db);
  const id = Number(runId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Model kaydı için geçerli Hikâyeleştir runId gerekli.");
  const run = narrativeStore.getRun(db, id);
  if (!run) throw new Error("Model kaydı için Hikâyeleştir çalışması bulunamadı.");
  if (run.state !== "prepared") throw new Error("Model provenance yalnız prepared Hikâyeleştir çalışmasına kaydedilebilir.");
  const value = String(model ?? "").trim().slice(0, 200);
  if (!value) return run;
  db.prepare("UPDATE narrative_runs SET model=? WHERE id=? AND state='prepared'").run(value, id);
  return narrativeStore.getRun(db, id);
}

function saveDraftResponse(db, input = {}) {
  const runId = Number(input?.runId);
  if (!Number.isInteger(runId) || runId <= 0) throw new Error("Taslak kaydı için geçerli Hikâyeleştir runId gerekli.");
  const normalized = aiContract.normalizeResponse(db, runId, input?.response);
  narrativeStore.saveDraftSections(db, runId, normalized.sections);
  return {
    run: narrativeStore.getRun(db, runId),
    contractVersion: normalized.contractVersion,
    drafts: runDrafts(db, runId),
  };
}

function apply(db, runId) {
  const result = narrativeStore.applyRun(db, Number(runId));
  return { ...result, status: status(db) };
}

function discard(db, runId) {
  const run = narrativeStore.discardRun(db, Number(runId));
  return { run, status: status(db) };
}

module.exports = {
  apply,
  buildRequest,
  discard,
  getRun,
  latestWorkingRunId,
  prepare,
  recordModel,
  runDrafts,
  saveDraftResponse,
  status,
};
