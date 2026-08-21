const universeMerge = require("./universe-merge.cjs");
const universeIngest = require("./universe-ingest.cjs");
const importer = require("./universe-workspace-import.cjs");
const accumulator = require("./universe-workspace-accumulate.cjs");
const { nodeRows } = require("./universe-workspace-core.cjs");
const revisions = require("./universe-workspace-revisions.cjs");
const store = require("./universe-workspace-store.cjs");

function applyRun(db, requestedRunId = null) {
  const result = universeMerge.latestResult(db, requestedRunId);
  const freshness = result?.id ? universeIngest.assertRunFresh(db, result.id) : { tracked: false };
  const previous = new Map(store.listNodes(db).map((node) => [node.key, node]));
  const approved = new Map([...previous].filter(([, node]) => node.state === "approved"));
  const rows = result?.state === "done" && result.complete ? nodeRows(result.universe) : [];
  const applied = importer.applyRun(db, requestedRunId);
  let accumulatedDrafts = 0;
  if (freshness.tracked && result?.id) {
    const writeDraft = db.prepare("UPDATE universe_workspace_nodes SET run_id=?,name=?,summary=?,aliases_json=?,source_video_ids_json=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=? AND state='draft'");
    for (const row of rows) {
      const old = previous.get(row.key);
      if (!old || old.state !== "draft") continue;
      const next = accumulator.accumulateNode(old, row, result.id);
      accumulatedDrafts += Number(writeDraft.run(result.id, next.name, next.summary, JSON.stringify(next.aliases), JSON.stringify(next.sourceVideoIds), JSON.stringify(next.payload), row.key).changes);
    }
  }
  let revisionProposed = 0;
  for (const row of rows) {
    const current = approved.get(row.key);
    if (!current) continue;
    const proposed = freshness.tracked ? accumulator.accumulateNode(current, row, result.id) : row;
    if (revisions.propose(db, current, proposed, result.id)) revisionProposed += 1;
  }
  const ingestApplied = result?.id ? universeIngest.markApplied(db, result.id) : { tracked: false, processed: 0 };
  return { ...applied, accumulatedDrafts, revisionProposed, ingestProcessed: ingestApplied.processed, ...store.status(db) };
}

module.exports = { applyRun };
