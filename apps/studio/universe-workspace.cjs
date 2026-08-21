const core = require("./universe-workspace-core.cjs");
const revisionImport = require("./universe-workspace-revision-import.cjs");
const publicWorkspace = require("./universe-workspace-public.cjs");
const revisions = require("./universe-workspace-revisions.cjs");
const store = require("./universe-workspace-store.cjs");

function status(db) {
  const base = store.status(db);
  const pendingRevisions = revisions.list(db, { state: "pending" }).length;
  return { ...base, counts: { ...base.counts, pendingRevisions } };
}

function applyRun(db, runId = null) {
  const result = revisionImport.applyRun(db, runId);
  return { ...result, ...status(db) };
}

function listNodes(db, input = {}) {
  if (input?.view === "revisions") return revisions.list(db, input);
  if (input?.view === "history") return revisions.listHistory(db, input.nodeKey);
  return store.listNodes(db, input);
}

function setNodeState(db, input) {
  const keys = Array.isArray(input?.keys) ? input.keys.map(String) : [];
  const before = new Map(store.listNodes(db).filter((node) => keys.includes(node.key)).map((node) => [node.key, node]));
  const result = store.setNodeState(db, input);
  const nextState = String(input?.state || "");
  for (const key of keys) {
    const previous = before.get(key);
    if (!previous || previous.state === nextState) continue;
    revisions.history(db, key, nextState === "approved" ? "approved" : "drafted", previous.runId, nextState === "approved" ? "Editoryal kayıt onaylandı." : "Editoryal kayıt yeniden taslağa çekildi.", revisions.snap(previous));
  }
  return { ...result, ...status(db) };
}

function updateNode(db, input) {
  if (input?.action === "apply-revision") return revisions.apply(db, Number(input.id));
  if (input?.action === "dismiss-revision") return revisions.dismiss(db, Number(input.id));
  const key = String(input?.key || "");
  const previous = store.listNodes(db).find((node) => node.key === key);
  const updated = store.updateNode(db, input);
  if (previous) revisions.history(db, key, "editorial_update", updated.runId, "Editoryal kayıt kullanıcı tarafından düzenlendi.", revisions.snap(previous));
  return updated;
}

module.exports = {
  ensureSchema: core.ensureSchema,
  applyRun,
  listNodes,
  listRelations: store.listRelations,
  setNodeState,
  updateNode,
  status,
  listRevisions: revisions.list,
  applyRevision: revisions.apply,
  dismissRevision: revisions.dismiss,
  listHistory: revisions.listHistory,
  publicEditorial: publicWorkspace.publicEditorial,
  attachPublicSnapshot: publicWorkspace.attachPublicSnapshot,
};
