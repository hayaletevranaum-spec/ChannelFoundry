const AI_TABLES = [
  "narrative_visual_slots",
  "narrative_section_revisions",
  "narrative_sections",
  "narrative_run_sources",
  "narrative_runs",
  "universe_workspace_history",
  "universe_workspace_revisions",
  "universe_workspace_relations",
  "universe_workspace_imports",
  "universe_workspace_nodes",
  "universe_ingest_run_sources",
  "universe_ingest_runs",
  "universe_ingest_sources",
  "universe_merge_chunks",
  "universe_merge_runs",
  "ai_analysis_editorial_reviews",
  "ai_analysis_jobs",
  "source_ai_analyses",
];

const PRESERVED_TABLES = [
  "youtube_channels",
  "youtube_videos",
  "source_transcripts",
  "content_transcripts",
  "content_items",
  "content_sources",
  "relations",
];

const AUTOINCREMENT_TABLES = [
  "universe_merge_runs",
  "universe_workspace_revisions",
  "universe_workspace_history",
];

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function countTable(db, name) {
  if (!tableExists(db, name)) return null;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count ?? 0);
}

function snapshot(db) {
  return {
    reset: Object.fromEntries(AI_TABLES.map((name) => [name, countTable(db, name)])),
    preserved: Object.fromEntries(PRESERVED_TABLES.map((name) => [name, countTable(db, name)])),
  };
}

function resetAiWorkspace(db) {
  const before = snapshot(db);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const table of AI_TABLES) {
      if (tableExists(db, table)) db.exec(`DELETE FROM ${table};`);
    }
    if (tableExists(db, "sqlite_sequence")) {
      const statement = db.prepare("DELETE FROM sqlite_sequence WHERE name=?");
      for (const table of AUTOINCREMENT_TABLES) statement.run(table);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  const after = snapshot(db);
  const removed = Object.fromEntries(AI_TABLES.map((name) => {
    const start = before.reset[name];
    const end = after.reset[name];
    return [name, start == null || end == null ? null : Math.max(0, start - end)];
  }));
  return { before, after, removed };
}

module.exports = {
  AI_TABLES,
  PRESERVED_TABLES,
  resetAiWorkspace,
  snapshot,
  tableExists,
};
