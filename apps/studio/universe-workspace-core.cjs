const crypto = require("node:crypto");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS universe_workspace_nodes (
      key TEXT PRIMARY KEY,
      run_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('story','character','event','location','object')),
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      source_video_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL CHECK (state IN ('draft','approved')) DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_workspace_relations (
      key TEXT PRIMARY KEY,
      run_id INTEGER NOT NULL,
      from_key TEXT NOT NULL REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE,
      to_key TEXT NOT NULL REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'bağlantılı',
      source_video_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL CHECK (state IN ('draft','approved')) DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (from_key <> to_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_workspace_imports (
      run_id INTEGER PRIMARY KEY,
      analysis_count INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      node_count INTEGER NOT NULL DEFAULT 0,
      relation_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_workspace_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_key TEXT NOT NULL REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE,
      run_id INTEGER NOT NULL,
      base_run_id INTEGER NOT NULL DEFAULT 0,
      proposed_name TEXT NOT NULL DEFAULT '',
      proposed_summary TEXT NOT NULL DEFAULT '',
      proposed_aliases_json TEXT NOT NULL DEFAULT '[]',
      proposed_source_video_ids_json TEXT NOT NULL DEFAULT '[]',
      proposed_payload_json TEXT NOT NULL DEFAULT '{}',
      diff_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL CHECK (state IN ('pending','applied','dismissed')) DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      UNIQUE(node_key, run_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS universe_workspace_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_key TEXT NOT NULL REFERENCES universe_workspace_nodes(key) ON DELETE CASCADE,
      run_id INTEGER NOT NULL DEFAULT 0,
      event TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_universe_workspace_nodes_kind_state ON universe_workspace_nodes(kind, state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_universe_workspace_nodes_run ON universe_workspace_nodes(run_id, kind);
    CREATE INDEX IF NOT EXISTS idx_universe_workspace_relations_run ON universe_workspace_relations(run_id, state);
    CREATE INDEX IF NOT EXISTS idx_universe_workspace_revisions_state ON universe_workspace_revisions(state, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_universe_workspace_history_node ON universe_workspace_history(node_key, id DESC);
  `);
}

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function textArray(value, limit = 80, max = 500) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry, max);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizedName(value) {
  return clean(value, 260).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function stableKey(kind, name) {
  const source = `${kind}:${normalizedName(name)}`;
  return `universe-${kind}-${crypto.createHash("sha1").update(source).digest("hex").slice(0, 14)}`;
}

function relationKey(fromKey, toKey, label) {
  const source = `${fromKey}:${toKey}:${clean(label, 180).toLocaleLowerCase("tr-TR")}`;
  return `universe-relation-${crypto.createHash("sha1").update(source).digest("hex").slice(0, 16)}`;
}

function nodeRows(universe) {
  const result = [];
  const append = (kind, values) => {
    for (const entry of Array.isArray(values) ? values : []) {
      if (!entry || typeof entry !== "object") continue;
      const name = clean(entry.name, 260);
      if (!name) continue;
      result.push({
        key: stableKey(kind, name),
        kind,
        name,
        summary: clean(entry.summary, 12000),
        aliases: textArray(entry.aliases, 30, 260),
        sourceVideoIds: textArray(entry.sourceVideoIds, 2000, 100),
        payload: entry,
      });
    }
  };
  append("story", universe?.stories);
  append("character", universe?.characters);
  append("event", universe?.events);
  append("location", universe?.locations);
  append("object", universe?.objects);
  return result;
}

function nodeIndex(rows) {
  const index = new Map();
  for (const row of rows) index.set(`${row.kind}:${normalizedName(row.name)}`, row.key);
  return index;
}

function hydrateNode(row) {
  const payload = safeJson(row.payloadJson, {});
  return {
    key: String(row.key),
    runId: Number(row.runId),
    kind: String(row.kind),
    name: String(row.name),
    summary: String(row.summary ?? ""),
    aliases: textArray(safeJson(row.aliasesJson, []), 30, 260),
    sourceVideoIds: textArray(safeJson(row.sourceVideoIdsJson, []), 2000, 100),
    payload: payload && typeof payload === "object" ? payload : {},
    state: row.state === "approved" ? "approved" : "draft",
    updatedAt: String(row.updatedAt ?? ""),
  };
}

module.exports = { clean, ensureSchema, hydrateNode, nodeIndex, nodeRows, normalizedName, relationKey, safeJson, textArray };
