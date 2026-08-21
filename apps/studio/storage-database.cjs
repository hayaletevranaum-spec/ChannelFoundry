const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

let database = null;
const LEGACY_FIXTURE_CLEANUP_VERSION = "2";
const LEGACY_FIXTURE_KEYS = [
  "video:video-001",
  "video:video-002",
  "character:character-001",
  "character:character-002",
  "event:event-001",
  "event:event-002",
  "file:file-001",
  "file:file-002",
];
const LEGACY_LOCAL_TEST_TITLES = [
  "Web Snapshot Testi",
  "Kalıcı Test",
  "Test karakteri",
  "test",
  "Toplu Test A",
  "Toplu Test B",
];

function openStudioDatabase(userDataPath) {
  if (database) return database;

  const databasePath = path.join(userDataPath, "birdesengor-studio.sqlite");
  database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
      key TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('video', 'character', 'event', 'file')),
      title TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('published', 'draft')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS content_sources (
      content_key TEXT PRIMARY KEY REFERENCES content_items(key) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      pair_key TEXT NOT NULL UNIQUE,
      from_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
      to_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'bağlantılı',
      note TEXT,
      source TEXT NOT NULL CHECK (source IN ('base', 'local')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (from_key <> to_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS studio_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS idx_content_items_kind ON content_items(kind);
    CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
    CREATE INDEX IF NOT EXISTS idx_content_sources_provider ON content_sources(provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_key);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_key);
  `);

  cleanupLegacyFixtureData(database);
  return database;
}

function getMeta(db, key) {
  return db.prepare("SELECT value FROM studio_meta WHERE key = ?").get(key)?.value ?? null;
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO studio_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), String(value));
}

function cleanupLegacyFixtureData(db) {
  if (getMeta(db, "legacy_fixture_cleanup_version") === LEGACY_FIXTURE_CLEANUP_VERSION) return { cleaned: false, removed: 0 };
  let removed = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    const removeByKey = db.prepare("DELETE FROM content_items WHERE key = ?");
    for (const key of LEGACY_FIXTURE_KEYS) removed += Number(removeByKey.run(key).changes);
    const removeLocalTest = db.prepare(`
      DELETE FROM content_items
      WHERE key LIKE 'local:%' AND lower(trim(title)) = lower(trim(?))
        AND NOT EXISTS (SELECT 1 FROM content_sources WHERE content_sources.content_key = content_items.key)
    `);
    for (const title of LEGACY_LOCAL_TEST_TITLES) removed += Number(removeLocalTest.run(title).changes);
    setMeta(db, "legacy_fixture_cleanup_version", LEGACY_FIXTURE_CLEANUP_VERSION);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { cleaned: true, removed };
}

function getDatabaseInfo(db, userDataPath) {
  const itemCount = Number(db.prepare("SELECT COUNT(*) AS count FROM content_items").get().count);
  const relationCount = Number(db.prepare("SELECT COUNT(*) AS count FROM relations").get().count);
  return { engine: "node:sqlite", file: path.join(userDataPath, "birdesengor-studio.sqlite"), itemCount, relationCount };
}

module.exports = { cleanupLegacyFixtureData, getDatabaseInfo, getMeta, openStudioDatabase, setMeta };
