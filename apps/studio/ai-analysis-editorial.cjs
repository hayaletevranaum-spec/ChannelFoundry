const crypto = require("node:crypto");

const REVIEW_STATES = new Set(["pending", "curated", "excluded"]);
const UNIVERSE_DECISIONS = new Set(["include", "context", "exclude"]);
const SUPPORT_DECISIONS = new Set(["confirm", "exclude"]);
const NAMED_CATEGORIES = new Set(["character", "location", "object"]);

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function clean(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function textArray(value, limit = 200, max = 260) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry, max);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeKeyText(value) {
  return clean(value, 4000).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function itemKey(category, identity) {
  return `${category}:${crypto.createHash("sha1").update(`${category}:${normalizeKeyText(identity)}`).digest("hex").slice(0, 16)}`;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_analysis_editorial_reviews (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','curated','excluded')) DEFAULT 'pending',
      decisions_json TEXT NOT NULL DEFAULT '{}',
      name_overrides_json TEXT NOT NULL DEFAULT '{}',
      manual_sponsors_json TEXT NOT NULL DEFAULT '[]',
      manual_contributors_json TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_editorial_state
      ON ai_analysis_editorial_reviews(state, updated_at DESC);
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(ai_analysis_editorial_reviews)").all().map((row) => String(row.name)));
  if (!columns.has("name_overrides_json")) {
    db.exec("ALTER TABLE ai_analysis_editorial_reviews ADD COLUMN name_overrides_json TEXT NOT NULL DEFAULT '{}';");
  }
}

function defaultReview(videoId) {
  return {
    videoId: String(videoId ?? ""),
    state: "pending",
    decisions: {},
    nameOverrides: {},
    manualSponsors: [],
    manualContributors: [],
    reviewedAt: null,
    updatedAt: "",
  };
}

function objectMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getReview(db, videoId) {
  ensureSchema(db);
  const id = clean(videoId, 100);
  const row = db.prepare(`
    SELECT external_id AS videoId, state, decisions_json AS decisionsJson,
           name_overrides_json AS nameOverridesJson,
           manual_sponsors_json AS manualSponsorsJson,
           manual_contributors_json AS manualContributorsJson,
           reviewed_at AS reviewedAt, updated_at AS updatedAt
    FROM ai_analysis_editorial_reviews
    WHERE provider='youtube' AND external_id=?
  `).get(id);
  if (!row) return defaultReview(id);
  return {
    videoId: String(row.videoId),
    state: REVIEW_STATES.has(row.state) ? row.state : "pending",
    decisions: objectMap(safeJson(row.decisionsJson, {})),
    nameOverrides: objectMap(safeJson(row.nameOverridesJson, {})),
    manualSponsors: textArray(safeJson(row.manualSponsorsJson, [])),
    manualContributors: textArray(safeJson(row.manualContributorsJson, [])),
    reviewedAt: row.reviewedAt ? String(row.reviewedAt) : null,
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function resetReview(db, videoId) {
  ensureSchema(db);
  const id = clean(videoId, 100);
  db.prepare(`
    INSERT INTO ai_analysis_editorial_reviews (
      provider, external_id, state, decisions_json, name_overrides_json,
      manual_sponsors_json, manual_contributors_json, reviewed_at, updated_at
    ) VALUES ('youtube', ?, 'pending', '{}', '{}', '[]', '[]', NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      state='pending', decisions_json='{}', name_overrides_json='{}', reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP
  `).run(id);
  return getReview(db, id);
}

function resultRow(db, videoId) {
  const id = clean(videoId, 100);
  return db.prepare(`
    SELECT external_id AS videoId, model, title, summary,
           topics_json AS topicsJson, story_beats_json AS storyBeatsJson,
           story_hints_json AS storyHintsJson, cover_visual_json AS coverVisualJson,
           characters_json AS charactersJson, locations_json AS locationsJson,
           objects_json AS objectsJson, scenes_json AS scenesJson,
           sponsors_json AS sponsorsJson, contributors_json AS contributorsJson,
           updated_at AS updatedAt
    FROM source_ai_analyses
    WHERE provider='youtube' AND external_id=?
  `).get(id);
}

function item(category, identity, label, detail, target, payload) {
  return {
    key: itemKey(category, identity),
    category,
    label: clean(label, 500),
    detail: clean(detail, 4000),
    target,
    payload,
  };
}

function buildItems(row) {
  if (!row) return [];
  const items = [];
  for (const hint of textArray(safeJson(row.storyHintsJson, []), 30, 500)) {
    items.push(item("storyHint", hint, hint, "Hikâye hattı adayı", "universe", hint));
  }
  for (const beat of textArray(safeJson(row.storyBeatsJson, []), 80, 1200)) {
    items.push(item("storyBeat", beat, beat, "Kaynaklı anlatı ayrıntısı", "universe", beat));
  }
  for (const entry of Array.isArray(safeJson(row.charactersJson, [])) ? safeJson(row.charactersJson, []) : []) {
    const name = clean(entry?.name, 260);
    if (!name) continue;
    const detail = [clean(entry?.role, 500), ...textArray(entry?.details, 20, 800)].filter(Boolean).join(" · ");
    items.push(item("character", name, name, detail || "Muhatap adayı", "universe", entry));
  }
  for (const entry of Array.isArray(safeJson(row.scenesJson, [])) ? safeJson(row.scenesJson, []) : []) {
    const name = clean(entry?.name || entry?.description, 260);
    if (!name) continue;
    items.push(item("scene", `${name}:${clean(entry?.description, 1200)}`, name, clean(entry?.description, 1200), "universe", entry));
  }
  for (const entry of Array.isArray(safeJson(row.locationsJson, [])) ? safeJson(row.locationsJson, []) : []) {
    const name = clean(entry?.name, 260);
    if (!name) continue;
    items.push(item("location", name, name, textArray(entry?.details, 20, 800).join(" · "), "universe", entry));
  }
  for (const entry of Array.isArray(safeJson(row.objectsJson, [])) ? safeJson(row.objectsJson, []) : []) {
    const name = clean(entry?.name, 260);
    if (!name) continue;
    items.push(item("object", name, name, textArray(entry?.details, 20, 800).join(" · "), "universe", entry));
  }
  for (const name of textArray(safeJson(row.sponsorsJson, []), 200, 260)) {
    items.push(item("sponsor", name, name, "Destekçi Kaydı / sponsor", "support", name));
  }
  for (const name of textArray(safeJson(row.contributorsJson, []), 200, 260)) {
    items.push(item("contributor", name, name, "Video sonu katkı kaydı", "support", name));
  }
  return items;
}

function defaultDecision(entry) {
  if (entry.target === "support") return "confirm";
  return entry.category === "storyHint" ? "include" : "context";
}

function editorialPackage(db, videoId) {
  ensureSchema(db);
  const row = resultRow(db, videoId);
  if (!row) return null;
  const review = getReview(db, videoId);
  const items = buildItems(row).map((entry) => {
    const rawDecision = String(review.decisions?.[entry.key] ?? "");
    const valid = entry.target === "support" ? SUPPORT_DECISIONS.has(rawDecision) : UNIVERSE_DECISIONS.has(rawDecision);
    const rawOverride = NAMED_CATEGORIES.has(entry.category) ? clean(review.nameOverrides?.[entry.key], 260) : "";
    const nameOverride = rawOverride && normalizeKeyText(rawOverride) !== normalizeKeyText(entry.label) ? rawOverride : "";
    return { ...entry, decision: valid ? rawDecision : defaultDecision(entry), nameOverride };
  });
  return {
    videoId: String(row.videoId),
    state: review.state,
    reviewedAt: review.reviewedAt,
    updatedAt: review.updatedAt,
    manualSponsors: review.manualSponsors,
    manualContributors: review.manualContributors,
    items,
  };
}

function saveReview(db, input) {
  ensureSchema(db);
  const videoId = clean(input?.videoId, 100);
  if (!videoId || !resultRow(db, videoId)) throw new Error("Editoryal ayıklama için çözümleme sonucu bulunamadı.");
  const state = REVIEW_STATES.has(String(input?.state)) ? String(input.state) : "pending";
  const available = editorialPackage(db, videoId)?.items ?? [];
  const byKey = new Map(available.map((entry) => [entry.key, entry]));
  const decisions = {};
  const supplied = objectMap(input?.decisions);
  for (const [key, value] of Object.entries(supplied)) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const decision = String(value);
    if (entry.target === "support" ? SUPPORT_DECISIONS.has(decision) : UNIVERSE_DECISIONS.has(decision)) decisions[key] = decision;
  }
  const nameOverrides = {};
  const suppliedOverrides = objectMap(input?.nameOverrides);
  for (const [key, value] of Object.entries(suppliedOverrides)) {
    const entry = byKey.get(key);
    if (!entry || entry.target !== "universe" || !NAMED_CATEGORIES.has(entry.category)) continue;
    const canonical = clean(value, 260);
    if (canonical && normalizeKeyText(canonical) !== normalizeKeyText(entry.label)) nameOverrides[key] = canonical;
  }
  const manualSponsors = textArray(input?.manualSponsors, 300, 260);
  const manualContributors = textArray(input?.manualContributors, 300, 260);
  db.prepare(`
    INSERT INTO ai_analysis_editorial_reviews (
      provider, external_id, state, decisions_json, name_overrides_json,
      manual_sponsors_json, manual_contributors_json, reviewed_at, updated_at
    ) VALUES ('youtube', ?, ?, ?, ?, ?, ?, CASE WHEN ?='pending' THEN NULL ELSE CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      state=excluded.state,
      decisions_json=excluded.decisions_json,
      name_overrides_json=excluded.name_overrides_json,
      manual_sponsors_json=excluded.manual_sponsors_json,
      manual_contributors_json=excluded.manual_contributors_json,
      reviewed_at=CASE WHEN excluded.state='pending' THEN NULL ELSE CURRENT_TIMESTAMP END,
      updated_at=CURRENT_TIMESTAMP
  `).run(videoId, state, JSON.stringify(decisions), JSON.stringify(nameOverrides), JSON.stringify(manualSponsors), JSON.stringify(manualContributors), state);
  return editorialPackage(db, videoId);
}

function effectivePayload(entry) {
  if (!NAMED_CATEGORIES.has(entry.category) || !entry.nameOverride || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return entry.payload;
  const originalName = clean(entry.payload.name, 260);
  const canonicalName = clean(entry.nameOverride, 260);
  const next = { ...entry.payload, name: canonicalName };
  if (originalName && normalizeKeyText(originalName) !== normalizeKeyText(canonicalName)) {
    next.aliases = textArray([...(Array.isArray(entry.payload.aliases) ? entry.payload.aliases : []), originalName], 30, 260);
  }
  return next;
}

function mergeNamedEntries(values) {
  const merged = new Map();
  for (const raw of values) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = clean(raw.name, 260);
    if (!name) continue;
    const key = normalizeKeyText(name);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...raw,
        name,
        aliases: textArray(raw.aliases, 30, 260),
        details: textArray(raw.details, 80, 800),
      });
      continue;
    }
    current.aliases = textArray([...(current.aliases || []), ...(Array.isArray(raw.aliases) ? raw.aliases : [])], 30, 260);
    current.details = textArray([...(current.details || []), ...(Array.isArray(raw.details) ? raw.details : [])], 80, 800);
    if (!clean(current.role, 500) && clean(raw.role, 500)) current.role = clean(raw.role, 500);
    if ((!current.visual || typeof current.visual !== "object" || !Object.keys(current.visual).length) && raw.visual && typeof raw.visual === "object") current.visual = raw.visual;
  }
  return [...merged.values()];
}

function pickEntries(items, category, decision = "include") {
  const selected = items.filter((entry) => entry.category === category && entry.decision === decision);
  if (!NAMED_CATEGORIES.has(category)) return selected.map((entry) => entry.payload);
  return mergeNamedEntries(selected.map(effectivePayload));
}

function curatedResult(db, videoId) {
  const row = resultRow(db, videoId);
  if (!row) return null;
  const pack = editorialPackage(db, videoId);
  if (!pack || pack.state !== "curated") return null;
  const rawTopics = textArray(safeJson(row.topicsJson, []), 8, 140);
  const sponsors = [
    ...pickEntries(pack.items, "sponsor", "confirm").map(String),
    ...pack.manualSponsors,
  ];
  const contributors = [
    ...pickEntries(pack.items, "contributor", "confirm").map(String),
    ...pack.manualContributors,
  ];
  return {
    videoId: String(row.videoId),
    model: String(row.model ?? ""),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    topics: rawTopics,
    storyHints: pickEntries(pack.items, "storyHint"),
    storyBeats: pickEntries(pack.items, "storyBeat"),
    coverVisual: safeJson(row.coverVisualJson, {}),
    characters: pickEntries(pack.items, "character"),
    locations: pickEntries(pack.items, "location"),
    objects: pickEntries(pack.items, "object"),
    scenes: pickEntries(pack.items, "scene"),
    context: {
      storyHints: pickEntries(pack.items, "storyHint", "context"),
      storyBeats: pickEntries(pack.items, "storyBeat", "context"),
      characters: pickEntries(pack.items, "character", "context"),
      locations: pickEntries(pack.items, "location", "context"),
      objects: pickEntries(pack.items, "object", "context"),
      scenes: pickEntries(pack.items, "scene", "context"),
    },
    sponsors: textArray(sponsors, 500, 260),
    contributors: textArray(contributors, 500, 260),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function curatedSources(db) {
  ensureSchema(db);
  const ids = db.prepare(`
    SELECT sa.external_id AS videoId
    FROM source_ai_analyses sa
    JOIN ai_analysis_editorial_reviews er
      ON er.provider=sa.provider AND er.external_id=sa.external_id
    WHERE sa.provider='youtube' AND er.state='curated'
    ORDER BY sa.external_id ASC
  `).all();
  return ids.map((row) => curatedResult(db, row.videoId)).filter(Boolean);
}

function supportRecords(db) {
  ensureSchema(db);
  const records = [];
  for (const result of curatedSources(db)) {
    for (const name of result.sponsors) records.push({ videoId: result.videoId, kind: "sponsor", name, source: "transcript-or-manual" });
    for (const name of result.contributors) records.push({ videoId: result.videoId, kind: "contributor", name, source: "transcript-or-manual" });
  }
  return records;
}

module.exports = {
  buildItems,
  curatedResult,
  curatedSources,
  editorialPackage,
  ensureSchema,
  getReview,
  resetReview,
  saveReview,
  supportRecords,
};
