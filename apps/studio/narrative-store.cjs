const crypto = require("node:crypto");
const { listNodes, listRelations } = require("./universe-workspace-store.cjs");
const { ensureSchema: ensureUniverseSchema, safeJson, textArray } = require("./universe-workspace-core.cjs");
const {
  entityReferencesFromBlocks,
  fallbackBlocks,
  normalizeBlocks,
  normalizeMedia,
  plainTextFromBlocks,
} = require("./narrative-structured-content.cjs");

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => String(row.name)));
}

function ensureRevisionColumns(db) {
  const columns = tableColumns(db, "narrative_section_revisions");
  const additions = [
    ["blocks_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["entity_references_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["source_video_ids_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["media_json", "TEXT NOT NULL DEFAULT '[]'"],
  ];
  for (const [name, definition] of additions) {
    if (columns.has(name)) continue;
    db.exec(`ALTER TABLE narrative_section_revisions ADD COLUMN ${name} ${definition};`);
    columns.add(name);
  }
}

function ensureSchema(db) {
  ensureUniverseSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS narrative_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL CHECK (state IN ('prepared','applied','stale','discarded')) DEFAULT 'prepared',
      baseline_run_id INTEGER,
      universe_fingerprint TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_at TEXT,
      discarded_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS narrative_run_sources (
      run_id INTEGER NOT NULL REFERENCES narrative_runs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('node','relation')),
      source_key TEXT NOT NULL,
      change_kind TEXT NOT NULL CHECK (change_kind IN ('new','changed','unchanged','removed')),
      is_current INTEGER NOT NULL CHECK (is_current IN (0,1)),
      source_fingerprint TEXT NOT NULL,
      source_video_ids_json TEXT NOT NULL DEFAULT '[]',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, source_type, source_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS narrative_sections (
      key TEXT PRIMARY KEY,
      current_revision_id INTEGER,
      state TEXT NOT NULL CHECK (state IN ('active','retired')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS narrative_section_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_key TEXT NOT NULL REFERENCES narrative_sections(key) ON DELETE CASCADE,
      run_id INTEGER NOT NULL REFERENCES narrative_runs(id) ON DELETE CASCADE,
      revision_no INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      blocks_json TEXT NOT NULL DEFAULT '[]',
      entity_references_json TEXT NOT NULL DEFAULT '[]',
      source_keys_json TEXT NOT NULL DEFAULT '[]',
      source_video_ids_json TEXT NOT NULL DEFAULT '[]',
      media_json TEXT NOT NULL DEFAULT '[]',
      retire INTEGER NOT NULL CHECK (retire IN (0,1)) DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('draft','approved','published','superseded','discarded')) DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT,
      published_at TEXT,
      UNIQUE (section_key, run_id),
      UNIQUE (section_key, revision_no)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_narrative_runs_state ON narrative_runs(state, id DESC);
    CREATE INDEX IF NOT EXISTS idx_narrative_sources_run ON narrative_run_sources(run_id, is_current, source_type, source_key);
    CREATE INDEX IF NOT EXISTS idx_narrative_section_revisions_run ON narrative_section_revisions(run_id, state, position, id);
    CREATE INDEX IF NOT EXISTS idx_narrative_section_revisions_section ON narrative_section_revisions(section_key, revision_no DESC);
  `);
  ensureRevisionColumns(db);
}

function clean(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
  return result;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function sourceId(source) {
  return `${source.sourceType}:${source.sourceKey}`;
}

function currentUniverseSources(db) {
  ensureSchema(db);
  const sources = [];
  for (const node of listNodes(db, { state: "approved" })) {
    const snapshot = {
      key: node.key,
      kind: node.kind,
      name: node.name,
      summary: node.summary,
      aliases: node.aliases,
      sourceVideoIds: node.sourceVideoIds,
      payload: node.payload,
    };
    sources.push({
      sourceType: "node",
      sourceKey: String(node.key),
      sourceVideoIds: textArray(node.sourceVideoIds, 2000, 100),
      snapshot,
      fingerprint: fingerprint(snapshot),
    });
  }
  for (const relation of listRelations(db, { state: "approved" })) {
    const snapshot = {
      key: relation.key,
      fromKey: relation.fromKey,
      toKey: relation.toKey,
      label: relation.label,
      sourceVideoIds: relation.sourceVideoIds,
    };
    sources.push({
      sourceType: "relation",
      sourceKey: String(relation.key),
      sourceVideoIds: textArray(relation.sourceVideoIds, 2000, 100),
      snapshot,
      fingerprint: fingerprint(snapshot),
    });
  }
  return sources.sort((a, b) => sourceId(a).localeCompare(sourceId(b)));
}

function universeFingerprint(sources) {
  return fingerprint(sources.map((source) => [source.sourceType, source.sourceKey, source.fingerprint]));
}

function latestAppliedRun(db) {
  ensureSchema(db);
  const row = db.prepare(`
    SELECT id, baseline_run_id AS baselineRunId, universe_fingerprint AS universeFingerprint,
           input_fingerprint AS inputFingerprint, input_json AS inputJson, model, created_at AS createdAt,
           applied_at AS appliedAt
    FROM narrative_runs WHERE state='applied' ORDER BY id DESC LIMIT 1
  `).get();
  return row ? hydrateRun(row, "applied") : null;
}

function baselineSourceMap(db, runId) {
  if (!runId) return new Map();
  const rows = db.prepare(`
    SELECT source_type AS sourceType, source_key AS sourceKey, source_fingerprint AS sourceFingerprint,
           source_video_ids_json AS sourceVideoIdsJson, snapshot_json AS snapshotJson
    FROM narrative_run_sources WHERE run_id=? AND is_current=1
    ORDER BY source_type, source_key
  `).all(Number(runId));
  return new Map(rows.map((row) => [`${row.sourceType}:${row.sourceKey}`, {
    sourceType: String(row.sourceType),
    sourceKey: String(row.sourceKey),
    fingerprint: String(row.sourceFingerprint),
    sourceVideoIds: textArray(safeJson(row.sourceVideoIdsJson, []), 2000, 100),
    snapshot: safeJson(row.snapshotJson, {}),
  }]));
}

function runSourceMap(db, runId) {
  ensureSchema(db);
  const rows = db.prepare(`
    SELECT source_type AS sourceType, source_key AS sourceKey,
           source_video_ids_json AS sourceVideoIdsJson, snapshot_json AS snapshotJson
    FROM narrative_run_sources WHERE run_id=? AND is_current=1
    ORDER BY source_type, source_key
  `).all(Number(runId));
  return new Map(rows.map((row) => [String(row.sourceKey), {
    sourceType: String(row.sourceType),
    sourceKey: String(row.sourceKey),
    sourceVideoIds: textArray(safeJson(row.sourceVideoIdsJson, []), 2000, 100),
    snapshot: safeJson(row.snapshotJson, {}),
  }]));
}

function sourceVideoIdsFor(sourceMap, sourceKeys) {
  const result = [];
  const seen = new Set();
  for (const sourceKey of sourceKeys) {
    const source = sourceMap.get(sourceKey);
    for (const videoId of source?.sourceVideoIds ?? []) {
      const value = clean(videoId, 100);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function hydrateSectionRevision(row, db = null) {
  const sourceKeys = textArray(safeJson(row.sourceKeysJson, []), 5000, 220);
  let blocks = safeJson(row.blocksJson, []);
  if (!Array.isArray(blocks) || !blocks.length) blocks = fallbackBlocks(row.body);
  let sourceVideoIds = textArray(safeJson(row.sourceVideoIdsJson, []), 5000, 100);
  if (!sourceVideoIds.length && db && row.runId != null) {
    sourceVideoIds = sourceVideoIdsFor(runSourceMap(db, row.runId), sourceKeys);
  }
  const rawEntityReferences = safeJson(row.entityReferencesJson, []);
  const rawMedia = safeJson(row.mediaJson, []);
  return {
    id: Number(row.id),
    sectionKey: String(row.sectionKey),
    runId: Number(row.runId),
    revisionNo: Number(row.revisionNo),
    position: Number(row.position),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    blocks,
    entityReferences: Array.isArray(rawEntityReferences) ? rawEntityReferences : [],
    sourceKeys,
    sourceVideoIds,
    media: Array.isArray(rawMedia) ? rawMedia : [],
    retire: Boolean(row.retire),
    state: String(row.revisionState ?? row.state),
    createdAt: String(row.createdAt ?? ""),
    approvedAt: row.approvedAt ? String(row.approvedAt) : null,
    publishedAt: row.publishedAt ? String(row.publishedAt) : null,
  };
}

function narrativeMemory(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT s.key AS sectionKey, s.state AS sectionState, r.id AS id, r.run_id AS runId,
           r.revision_no AS revisionNo, r.position, r.title, r.body,
           r.blocks_json AS blocksJson, r.entity_references_json AS entityReferencesJson,
           r.source_keys_json AS sourceKeysJson, r.source_video_ids_json AS sourceVideoIdsJson,
           r.media_json AS mediaJson, r.retire, r.state AS revisionState,
           r.created_at AS createdAt, r.approved_at AS approvedAt, r.published_at AS publishedAt
    FROM narrative_sections s
    JOIN narrative_section_revisions r ON r.id=s.current_revision_id
    WHERE s.state='active' AND r.state IN ('approved','published')
    ORDER BY r.position ASC, s.key ASC
  `).all().map((row) => hydrateSectionRevision(row, db));
}

function buildInput(db) {
  ensureSchema(db);
  const baseline = latestAppliedRun(db);
  const baselineMap = baselineSourceMap(db, baseline?.id);
  const current = currentUniverseSources(db);
  const currentMap = new Map(current.map((source) => [sourceId(source), source]));
  const changes = [];
  const sourceStates = [];

  for (const source of current) {
    const previous = baselineMap.get(sourceId(source));
    const changeKind = !previous ? "new" : previous.fingerprint === source.fingerprint ? "unchanged" : "changed";
    sourceStates.push({ ...source, changeKind, isCurrent: 1 });
    if (changeKind !== "unchanged") {
      changes.push({
        sourceType: source.sourceType,
        sourceKey: source.sourceKey,
        changeKind,
        sourceVideoIds: source.sourceVideoIds,
        snapshot: source.snapshot,
      });
    }
  }

  const removed = [];
  for (const [id, previous] of baselineMap) {
    if (currentMap.has(id)) continue;
    sourceStates.push({ ...previous, changeKind: "removed", isCurrent: 0 });
    removed.push({ sourceType: previous.sourceType, sourceKey: previous.sourceKey });
  }
  sourceStates.sort((a, b) => sourceId(a).localeCompare(sourceId(b)));
  removed.sort((a, b) => `${a.sourceType}:${a.sourceKey}`.localeCompare(`${b.sourceType}:${b.sourceKey}`));

  const input = {
    baselineRunId: baseline?.id ?? null,
    baselineNarrative: narrativeMemory(db),
    changes,
    removed,
  };
  return {
    ...input,
    currentSources: sourceStates,
    universeFingerprint: universeFingerprint(current),
    inputFingerprint: fingerprint(input),
    hasChanges: changes.length > 0 || removed.length > 0,
  };
}

function hydrateRun(row, forcedState = null) {
  return {
    id: Number(row.id),
    state: forcedState ?? String(row.state),
    baselineRunId: row.baselineRunId == null ? null : Number(row.baselineRunId),
    universeFingerprint: String(row.universeFingerprint),
    inputFingerprint: String(row.inputFingerprint),
    input: safeJson(row.inputJson, {}),
    model: String(row.model ?? ""),
    createdAt: String(row.createdAt ?? ""),
    appliedAt: row.appliedAt ? String(row.appliedAt) : null,
    discardedAt: row.discardedAt ? String(row.discardedAt) : null,
  };
}

function getRun(db, runId) {
  ensureSchema(db);
  const row = db.prepare(`
    SELECT id, state, baseline_run_id AS baselineRunId, universe_fingerprint AS universeFingerprint,
           input_fingerprint AS inputFingerprint, input_json AS inputJson, model,
           created_at AS createdAt, applied_at AS appliedAt, discarded_at AS discardedAt
    FROM narrative_runs WHERE id=?
  `).get(Number(runId));
  return row ? hydrateRun(row) : null;
}

function refreshStale(db) {
  ensureSchema(db);
  const currentFingerprint = universeFingerprint(currentUniverseSources(db));
  return Number(db.prepare(`
    UPDATE narrative_runs SET state='stale'
    WHERE state='prepared' AND universe_fingerprint<>?
  `).run(currentFingerprint).changes);
}

function isRunStale(db, runId) {
  const run = getRun(db, runId);
  if (!run) throw new Error("Hikâyeleştir çalışması bulunamadı.");
  if (run.state === "stale") return true;
  return run.state === "prepared" && run.universeFingerprint !== universeFingerprint(currentUniverseSources(db));
}

function prepareRun(db, input = {}) {
  ensureSchema(db);
  refreshStale(db);
  const built = buildInput(db);
  if (!built.hasChanges) throw new Error("Hikâyeleştir için yeni onaylı Evren değişikliği yok.");

  const existing = db.prepare(`
    SELECT id FROM narrative_runs
    WHERE state='prepared' AND universe_fingerprint=? AND input_fingerprint=?
    ORDER BY id DESC LIMIT 1
  `).get(built.universeFingerprint, built.inputFingerprint);
  if (existing) return getRun(db, existing.id);

  db.exec("BEGIN IMMEDIATE;");
  try {
    const info = db.prepare(`
      INSERT INTO narrative_runs (state, baseline_run_id, universe_fingerprint, input_fingerprint, input_json, model)
      VALUES ('prepared', ?, ?, ?, ?, ?)
    `).run(built.baselineRunId, built.universeFingerprint, built.inputFingerprint, JSON.stringify({
      baselineRunId: built.baselineRunId,
      baselineNarrative: built.baselineNarrative,
      changes: built.changes,
      removed: built.removed,
    }), clean(input?.model, 200));
    const runId = Number(info.lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO narrative_run_sources (
        run_id, source_type, source_key, change_kind, is_current, source_fingerprint,
        source_video_ids_json, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of built.currentSources) {
      insert.run(
        runId, source.sourceType, source.sourceKey, source.changeKind, Number(source.isCurrent),
        source.fingerprint, JSON.stringify(source.sourceVideoIds), JSON.stringify(source.snapshot),
      );
    }
    db.exec("COMMIT;");
    return getRun(db, runId);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function knownRunSourceKeys(db, runId) {
  return new Set(runSourceMap(db, runId).keys());
}

function stableSectionKey(title) {
  const base = clean(title, 500).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
  return `narrative-section-${crypto.createHash("sha1").update(base).digest("hex").slice(0, 14)}`;
}

function structuredSection(entry, sourceMap, sourceKeys) {
  const retire = entry.retire === true;
  if (retire) {
    return { body: "", blocks: [], entityReferences: [], sourceVideoIds: sourceVideoIdsFor(sourceMap, sourceKeys), media: [] };
  }
  const sourceKeySet = new Set(sourceKeys);
  const entityLookup = (entityId) => sourceMap.get(entityId) ?? null;
  const requestedBlocks = Array.isArray(entry.blocks) && entry.blocks.length ? entry.blocks : fallbackBlocks(entry.body);
  const blocks = normalizeBlocks(requestedBlocks, { entityLookup, sourceKeys: sourceKeySet });
  const body = plainTextFromBlocks(blocks);
  if (!body) throw new Error("Aktif anlatı bölümü structured metni boş bırakılamaz.");
  const entityReferences = entityReferencesFromBlocks(blocks, entityLookup);
  const media = normalizeMedia(entry.media, { entityLookup, sourceKeys: sourceKeySet, blocks });
  return {
    body,
    blocks,
    entityReferences,
    sourceVideoIds: sourceVideoIdsFor(sourceMap, sourceKeys),
    media,
  };
}

function saveDraftSections(db, runId, sections) {
  ensureSchema(db);
  refreshStale(db);
  const run = getRun(db, runId);
  if (!run) throw new Error("Taslak kaydedilebilecek Hikâyeleştir çalışması bulunamadı.");
  if (run.state === "stale" || isRunStale(db, runId)) throw new Error("Hikâyeleştir girdisi hazırlandıktan sonra Evren değişti; çalışma stale oldu.");
  if (run.state !== "prepared") throw new Error("Taslak kaydedilebilecek prepared Hikâyeleştir çalışması bulunamadı.");
  const values = Array.isArray(sections) ? sections : [];
  if (!values.length) throw new Error("En az bir anlatı bölümü taslağı gerekli.");
  if (values.length > 200) throw new Error("Bir Hikâyeleştir çalışmasında en fazla 200 bölüm taslağı kaydedilebilir.");

  const sourceMap = runSourceMap(db, runId);
  const allowedSources = knownRunSourceKeys(db, runId);
  const seen = new Set();
  const saved = [];
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (let index = 0; index < values.length; index += 1) {
      const entry = values[index] && typeof values[index] === "object" ? values[index] : {};
      const title = clean(entry.title, 500);
      const retire = entry.retire === true ? 1 : 0;
      const key = clean(entry.key, 220) || stableSectionKey(title || `section-${index + 1}`);
      if (seen.has(key)) throw new Error(`Aynı anlatı bölümü bir çalışmada iki kez kullanılamaz: ${key}`);
      seen.add(key);
      const existingSection = db.prepare("SELECT key FROM narrative_sections WHERE key=?").get(key);
      if (retire && !existingSection) throw new Error("Henüz var olmayan bir anlatı bölümü emekliye ayrılamaz.");
      const sourceKeys = textArray(entry.sourceKeys, 5000, 220);
      const unknown = sourceKeys.filter((sourceKey) => !allowedSources.has(sourceKey));
      if (unknown.length) throw new Error(`Anlatı bölümü bu çalışmanın onaylı Evren girdisinde olmayan kaynaklara bağlı: ${unknown.join(", ")}`);
      if (!sourceKeys.length && !retire) throw new Error("Aktif anlatı bölümü en az bir onaylı Evren kaynağına bağlanmalıdır.");
      const structured = structuredSection(entry, sourceMap, sourceKeys);

      db.prepare("INSERT INTO narrative_sections (key) VALUES (?) ON CONFLICT(key) DO NOTHING").run(key);
      const revisionNo = Number(db.prepare("SELECT COALESCE(MAX(revision_no),0)+1 AS next FROM narrative_section_revisions WHERE section_key=?").get(key)?.next ?? 1);
      const position = Number.isFinite(Number(entry.position)) ? Math.trunc(Number(entry.position)) : index;
      const existingDraft = db.prepare("SELECT id FROM narrative_section_revisions WHERE section_key=? AND run_id=?").get(key, Number(runId));
      if (existingDraft) {
        db.prepare(`
          UPDATE narrative_section_revisions SET
            position=?, title=?, body=?, blocks_json=?, entity_references_json=?, source_keys_json=?,
            source_video_ids_json=?, media_json=?, retire=?, state='draft', approved_at=NULL, published_at=NULL
          WHERE id=?
        `).run(
          position, title, structured.body, JSON.stringify(structured.blocks), JSON.stringify(structured.entityReferences),
          JSON.stringify(sourceKeys), JSON.stringify(structured.sourceVideoIds), JSON.stringify(structured.media), retire,
          Number(existingDraft.id),
        );
        saved.push(Number(existingDraft.id));
      } else {
        const info = db.prepare(`
          INSERT INTO narrative_section_revisions (
            section_key, run_id, revision_no, position, title, body, blocks_json, entity_references_json,
            source_keys_json, source_video_ids_json, media_json, retire, state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `).run(
          key, Number(runId), revisionNo, position, title, structured.body, JSON.stringify(structured.blocks),
          JSON.stringify(structured.entityReferences), JSON.stringify(sourceKeys), JSON.stringify(structured.sourceVideoIds),
          JSON.stringify(structured.media), retire,
        );
        saved.push(Number(info.lastInsertRowid));
      }
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return saved;
}

function applyRun(db, runId) {
  ensureSchema(db);
  refreshStale(db);
  const run = getRun(db, runId);
  if (!run) throw new Error("Hikâyeleştir çalışması bulunamadı.");
  if (run.state === "stale" || isRunStale(db, runId)) throw new Error("Evren değiştiği için stale Hikâyeleştir çalışması uygulanamaz.");
  if (run.state !== "prepared") throw new Error("Uygulanabilecek prepared Hikâyeleştir çalışması bulunamadı.");
  const drafts = db.prepare(`
    SELECT id, section_key AS sectionKey, retire FROM narrative_section_revisions
    WHERE run_id=? AND state='draft' ORDER BY position, id
  `).all(Number(runId));
  if (!drafts.length) throw new Error("Hikâyeleştir çalışmasını uygulamak için en az bir bölüm taslağı gerekli.");

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const draft of drafts) {
      const current = db.prepare("SELECT current_revision_id AS currentRevisionId FROM narrative_sections WHERE key=?").get(String(draft.sectionKey));
      if (current?.currentRevisionId) {
        db.prepare("UPDATE narrative_section_revisions SET state='superseded' WHERE id=? AND state='approved'").run(Number(current.currentRevisionId));
      }
      db.prepare("UPDATE narrative_section_revisions SET state='approved', approved_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(draft.id));
      db.prepare(`
        UPDATE narrative_sections SET current_revision_id=?, state=?, updated_at=CURRENT_TIMESTAMP WHERE key=?
      `).run(Number(draft.id), Number(draft.retire) ? "retired" : "active", String(draft.sectionKey));
    }
    db.prepare("UPDATE narrative_runs SET state='applied', applied_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(runId));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { run: getRun(db, runId), memory: narrativeMemory(db) };
}

function discardRun(db, runId) {
  ensureSchema(db);
  const run = getRun(db, runId);
  if (!run || !["prepared", "stale"].includes(run.state)) throw new Error("Discard edilebilecek Hikâyeleştir çalışması bulunamadı.");
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("UPDATE narrative_section_revisions SET state='discarded' WHERE run_id=? AND state='draft'").run(Number(runId));
    db.prepare("UPDATE narrative_runs SET state='discarded', discarded_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(runId));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getRun(db, runId);
}

function listSectionRevisions(db, sectionKey) {
  ensureSchema(db);
  return db.prepare(`
    SELECT id, section_key AS sectionKey, run_id AS runId, revision_no AS revisionNo, position,
           title, body, blocks_json AS blocksJson, entity_references_json AS entityReferencesJson,
           source_keys_json AS sourceKeysJson, source_video_ids_json AS sourceVideoIdsJson,
           media_json AS mediaJson, retire, state,
           created_at AS createdAt, approved_at AS approvedAt, published_at AS publishedAt
    FROM narrative_section_revisions WHERE section_key=? ORDER BY revision_no DESC
  `).all(clean(sectionKey, 220)).map((row) => hydrateSectionRevision(row, db));
}

function status(db) {
  ensureSchema(db);
  refreshStale(db);
  const count = (table, where = "") => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get()?.count ?? 0);
  return {
    latestAppliedRun: latestAppliedRun(db),
    memory: narrativeMemory(db),
    counts: {
      prepared: count("narrative_runs", "WHERE state='prepared'"),
      stale: count("narrative_runs", "WHERE state='stale'"),
      applied: count("narrative_runs", "WHERE state='applied'"),
      discarded: count("narrative_runs", "WHERE state='discarded'"),
      sections: count("narrative_sections"),
      activeSections: count("narrative_sections", "WHERE state='active' AND current_revision_id IS NOT NULL"),
    },
  };
}

module.exports = {
  applyRun,
  buildInput,
  currentUniverseSources,
  discardRun,
  ensureSchema,
  fingerprint,
  getRun,
  isRunStale,
  latestAppliedRun,
  listSectionRevisions,
  narrativeMemory,
  prepareRun,
  refreshStale,
  runSourceMap,
  saveDraftSections,
  status,
};
