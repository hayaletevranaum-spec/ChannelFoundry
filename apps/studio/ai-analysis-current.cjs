const legacy = require("./ai-analysis-legacy.cjs");
const editorial = require("./ai-analysis-editorial.cjs");
const entityResolution = require("./ai-analysis-entity-resolution.cjs");

function ensureSchema(db) {
  legacy.ensureSchema(db);
  editorial.ensureSchema(db);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function universeLocked(db, videoId) {
  if (!tableExists(db, "universe_ingest_sources")) return false;
  const id = String(videoId ?? "").trim();
  if (!id) return false;
  return Boolean(db.prepare(`
    SELECT 1 AS ok
    FROM universe_ingest_sources
    WHERE provider='youtube' AND external_id=?
  `).get(id));
}

function parseNames(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cleanName(value) {
  return String(value ?? "").trim().slice(0, 260);
}

function objectMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function enqueue(db, input) {
  ensureSchema(db);
  const ids = [...new Set((Array.isArray(input?.videoIds) ? input.videoIds : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  const locked = ids.filter((id) => universeLocked(db, id));
  const available = ids.filter((id) => !locked.includes(id));
  if (!available.length && locked.length) {
    throw new Error("Seçilen video Evrene daha önce işlendiği için yeniden çözümlenemez. Evren kaydını doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.");
  }
  const result = legacy.enqueue(db, { ...input, videoIds: available });
  return {
    ...result,
    requested: ids.length,
    skipped: Number(result.skipped ?? 0) + locked.length,
    locked: locked.length,
  };
}

function complete(db, videoId, model, analysis) {
  ensureSchema(db);
  const id = String(videoId ?? "").trim();
  if (universeLocked(db, id)) {
    throw new Error("Bu video Evrene daha önce işlendiği için çözümleme sonucu artık değiştirilemez. Evren kaydını doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.");
  }
  legacy.complete(db, id, model, analysis);
  db.prepare(`UPDATE source_ai_analyses SET sponsors_json=?, contributors_json=?, updated_at=CURRENT_TIMESTAMP WHERE provider='youtube' AND external_id=?`).run(
    JSON.stringify(Array.isArray(analysis?.sponsors) ? analysis.sponsors : []),
    JSON.stringify(Array.isArray(analysis?.contributors) ? analysis.contributors : []),
    id,
  );
  editorial.resetReview(db, id);
  return getResult(db, id);
}

function getResult(db, videoId) {
  ensureSchema(db);
  const result = legacy.getResult(db, videoId);
  if (!result) return null;
  const row = db.prepare(`SELECT sponsors_json AS sponsorsJson, contributors_json AS contributorsJson FROM source_ai_analyses WHERE provider='youtube' AND external_id=?`).get(String(videoId ?? "").trim());
  return { ...result, sponsors: parseNames(row?.sponsorsJson), contributors: parseNames(row?.contributorsJson) };
}

function list(db) {
  ensureSchema(db);
  const reviews = new Map(db.prepare(`SELECT external_id AS videoId, state FROM ai_analysis_editorial_reviews WHERE provider='youtube'`).all().map((row) => [String(row.videoId), String(row.state)]));
  return legacy.list(db).map((video) => ({
    ...video,
    editorialState: video.hasAnalysis ? (reviews.get(String(video.videoId)) || "pending") : "",
    universeLocked: video.hasAnalysis ? universeLocked(db, video.videoId) : false,
  }));
}

function stats(db) {
  ensureSchema(db);
  const base = legacy.stats(db);
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN er.state='curated' THEN 1 ELSE 0 END) AS curated,
      SUM(CASE WHEN er.state='excluded' THEN 1 ELSE 0 END) AS excluded,
      SUM(CASE WHEN COALESCE(er.state,'pending')='pending' THEN 1 ELSE 0 END) AS editorialPending
    FROM source_ai_analyses sa
    LEFT JOIN ai_analysis_editorial_reviews er ON er.provider=sa.provider AND er.external_id=sa.external_id
    WHERE sa.provider='youtube'
  `).get();
  return { ...base, editorialPending: Number(row?.editorialPending ?? 0), curated: Number(row?.curated ?? 0), excluded: Number(row?.excluded ?? 0) };
}

function editorialPackage(db, videoId) {
  ensureSchema(db);
  const pack = editorial.editorialPackage(db, videoId);
  if (!pack) return null;
  const review = editorial.getReview(db, videoId);
  const resolved = entityResolution.decoratePackage(db, pack, review);
  return { ...resolved, universeLocked: universeLocked(db, videoId) };
}

function withResolutionDefaults(db, input) {
  const videoId = String(input?.videoId ?? "").trim();
  const current = editorialPackage(db, videoId);
  if (!current) return input;
  const suppliedDecisions = objectMap(input?.decisions);
  const suppliedOverrides = objectMap(input?.nameOverrides);
  const decisions = { ...suppliedDecisions };
  const nameOverrides = { ...suppliedOverrides };
  for (const item of current.items) {
    if (!Object.prototype.hasOwnProperty.call(suppliedDecisions, item.key)) decisions[item.key] = item.decision;
    if (!Object.prototype.hasOwnProperty.call(suppliedOverrides, item.key) && cleanName(item.nameOverride)) {
      nameOverrides[item.key] = cleanName(item.nameOverride);
    }
  }
  return { ...input, videoId, decisions, nameOverrides };
}

function editorialSave(db, input) {
  ensureSchema(db);
  const videoId = String(input?.videoId ?? "").trim();
  const prepared = withResolutionDefaults(db, input);
  if (!universeLocked(db, videoId)) {
    editorial.saveReview(db, prepared);
    return editorialPackage(db, videoId);
  }

  const current = editorialPackage(db, videoId);
  if (!current) throw new Error("Evrene işlenmiş videonun editoryal kaydı bulunamadı.");
  if (String(input?.state ?? "") !== "curated") {
    throw new Error("Bu video Evrene daha önce işlendiği için Evren dışı bırakılamaz veya yeniden ayıklamaya açılamaz. Evren kaydını doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.");
  }

  const supplied = objectMap(prepared?.decisions);
  const suppliedOverrides = objectMap(prepared?.nameOverrides);
  const decisions = { ...supplied };
  const nameOverrides = { ...suppliedOverrides };
  for (const item of current.items) {
    if (item.target !== "universe") continue;
    const requested = Object.prototype.hasOwnProperty.call(supplied, item.key) ? String(supplied[item.key]) : item.decision;
    if (requested !== item.decision) {
      throw new Error("Bu video Evrene daha önce işlendiği için Evren malzemesi Ayıklama ekranından değiştirilemez. İlgili Evren kaydını doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.");
    }
    const currentOverride = cleanName(item.nameOverride);
    const requestedOverride = Object.prototype.hasOwnProperty.call(suppliedOverrides, item.key) ? cleanName(suppliedOverrides[item.key]) : currentOverride;
    if (requestedOverride !== currentOverride) {
      throw new Error("Bu video Evrene daha önce işlendiği için kayıt adları Ayıklama ekranından değiştirilemez. İlgili Evren kaydını doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.");
    }
    decisions[item.key] = item.decision;
    if (currentOverride) nameOverrides[item.key] = currentOverride;
    else delete nameOverrides[item.key];
  }

  editorial.saveReview(db, { ...prepared, state: "curated", decisions, nameOverrides });
  return editorialPackage(db, videoId);
}

module.exports = {
  ...legacy,
  ensureSchema,
  enqueue,
  complete,
  getResult,
  list,
  stats,
  editorialPackage,
  editorialSave,
  curatedResult: editorial.curatedResult,
  curatedSources: editorial.curatedSources,
  supportRecords: editorial.supportRecords,
  universeLocked,
};
