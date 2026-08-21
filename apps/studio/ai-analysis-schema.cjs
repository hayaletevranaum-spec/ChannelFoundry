function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
}

function ensureColumn(db, table, name, definition) {
  if (!tableColumns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_ai_analyses (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      topics_json TEXT NOT NULL DEFAULT '[]',
      story_beats_json TEXT NOT NULL DEFAULT '[]',
      story_hints_json TEXT NOT NULL DEFAULT '[]',
      cover_visual_json TEXT NOT NULL DEFAULT '{}',
      characters_json TEXT NOT NULL DEFAULT '[]',
      locations_json TEXT NOT NULL DEFAULT '[]',
      objects_json TEXT NOT NULL DEFAULT '[]',
      scenes_json TEXT NOT NULL DEFAULT '[]',
      sponsors_json TEXT NOT NULL DEFAULT '[]',
      contributors_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('waiting', 'running', 'done', 'error')) DEFAULT 'waiting',
      error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_analysis_editorial_reviews (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','curated','excluded')) DEFAULT 'pending',
      decisions_json TEXT NOT NULL DEFAULT '{}',
      manual_sponsors_json TEXT NOT NULL DEFAULT '[]',
      manual_contributors_json TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_ai_analysis_jobs_state ON ai_analysis_jobs(state, queued_at);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_editorial_state ON ai_analysis_editorial_reviews(state, updated_at DESC);
  `);

  ensureColumn(db, "source_ai_analyses", "story_beats_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "story_hints_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "cover_visual_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "source_ai_analyses", "characters_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "locations_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "objects_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "scenes_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "sponsors_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "source_ai_analyses", "contributors_json", "TEXT NOT NULL DEFAULT '[]'");
}

module.exports = { ensureSchema };
