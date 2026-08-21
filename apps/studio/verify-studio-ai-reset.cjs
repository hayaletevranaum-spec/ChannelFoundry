const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { AI_TABLES, resetAiWorkspace, snapshot } = require("./studio-ai-reset.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE youtube_channels (id TEXT PRIMARY KEY);
  CREATE TABLE youtube_videos (video_id TEXT PRIMARY KEY);
  CREATE TABLE source_transcripts (external_id TEXT PRIMARY KEY);
  CREATE TABLE content_items (key TEXT PRIMARY KEY);
  CREATE TABLE content_sources (content_key TEXT PRIMARY KEY);
  CREATE TABLE relations (id TEXT PRIMARY KEY);

  CREATE TABLE source_ai_analyses (id INTEGER PRIMARY KEY);
  CREATE TABLE ai_analysis_jobs (id INTEGER PRIMARY KEY);
  CREATE TABLE ai_analysis_editorial_reviews (id INTEGER PRIMARY KEY);
  CREATE TABLE universe_merge_runs (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE universe_merge_chunks (run_id INTEGER REFERENCES universe_merge_runs(id) ON DELETE CASCADE);
  CREATE TABLE universe_ingest_sources (id INTEGER PRIMARY KEY);
  CREATE TABLE universe_ingest_runs (run_id INTEGER PRIMARY KEY);
  CREATE TABLE universe_ingest_run_sources (run_id INTEGER REFERENCES universe_ingest_runs(run_id) ON DELETE CASCADE);
  CREATE TABLE universe_workspace_nodes (key TEXT PRIMARY KEY);
  CREATE TABLE universe_workspace_relations (key TEXT PRIMARY KEY, from_key TEXT REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE, to_key TEXT REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE);
  CREATE TABLE universe_workspace_imports (run_id INTEGER PRIMARY KEY);
  CREATE TABLE universe_workspace_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, node_key TEXT REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE);
  CREATE TABLE universe_workspace_history (id INTEGER PRIMARY KEY AUTOINCREMENT, node_key TEXT REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE);

  CREATE TABLE narrative_runs (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE narrative_run_sources (run_id INTEGER REFERENCES narrative_runs(id) ON DELETE CASCADE, source_key TEXT);
  CREATE TABLE narrative_sections (key TEXT PRIMARY KEY);
  CREATE TABLE narrative_section_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_key TEXT REFERENCES narrative_sections(key) ON DELETE CASCADE,
    run_id INTEGER REFERENCES narrative_runs(id) ON DELETE CASCADE
  );
  CREATE TABLE narrative_visual_slots (section_key TEXT, revision_id INTEGER);
`);

db.exec(`
  INSERT INTO youtube_channels VALUES ('channel');
  INSERT INTO youtube_videos VALUES ('video');
  INSERT INTO source_transcripts VALUES ('video');
  INSERT INTO content_items VALUES ('content');
  INSERT INTO content_sources VALUES ('content');
  INSERT INTO relations VALUES ('relation');

  INSERT INTO source_ai_analyses VALUES (1);
  INSERT INTO ai_analysis_jobs VALUES (1);
  INSERT INTO ai_analysis_editorial_reviews VALUES (1);
  INSERT INTO universe_merge_runs DEFAULT VALUES;
  INSERT INTO universe_merge_chunks VALUES (1);
  INSERT INTO universe_ingest_sources VALUES (1);
  INSERT INTO universe_ingest_runs VALUES (1);
  INSERT INTO universe_ingest_run_sources VALUES (1);
  INSERT INTO universe_workspace_nodes VALUES ('node');
  INSERT INTO universe_workspace_relations VALUES ('edge','node','node');
  INSERT INTO universe_workspace_imports VALUES (1);
  INSERT INTO universe_workspace_revisions (node_key) VALUES ('node');
  INSERT INTO universe_workspace_history (node_key) VALUES ('node');

  INSERT INTO narrative_runs DEFAULT VALUES;
  INSERT INTO narrative_run_sources VALUES (1,'node');
  INSERT INTO narrative_sections VALUES ('chapter');
  INSERT INTO narrative_section_revisions (section_key,run_id) VALUES ('chapter',1);
  INSERT INTO narrative_visual_slots VALUES ('chapter',1);
`);

const before = snapshot(db);
assert.equal(before.preserved.youtube_videos, 1);
assert.equal(before.preserved.source_transcripts, 1);
for (const table of AI_TABLES) assert.equal(before.reset[table], 1, `${table} test kaydı başlamadan önce bulunmalı`);

const result = resetAiWorkspace(db);
for (const table of AI_TABLES) assert.equal(result.after.reset[table], 0, `${table} temizlenmeli`);
assert.equal(result.after.preserved.youtube_channels, 1);
assert.equal(result.after.preserved.youtube_videos, 1);
assert.equal(result.after.preserved.source_transcripts, 1);
assert.equal(result.after.preserved.content_items, 1);
assert.equal(result.after.preserved.content_sources, 1);
assert.equal(result.after.preserved.relations, 1);

db.close();
console.log("Studio clean-start reset clears AI, universe, narrative and visual-decision state while preserving catalog, transcripts and general content");
