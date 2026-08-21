const crypto = require("node:crypto");
const narrativeStore = require("./narrative-store.cjs");

const CONTRACT_VERSION = 1;
const FORBIDDEN_LAYOUT_KEYS = new Set([
  "page", "pagenumber", "pageindex", "pageid",
  "spread", "spreadnumber", "spreadindex", "spreadid",
  "leftpage", "rightpage", "physicalpage", "physicalspread",
]);

function clean(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
}

function textArray(value, limit = 5000, max = 220) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry, max);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function videoMetadata(db, videoIds) {
  const ids = textArray(videoIds, 5000, 100);
  const youtube = hasTable(db, "youtube_videos")
    ? db.prepare("SELECT title, published_at AS publishedAt FROM youtube_videos WHERE video_id=?")
    : null;
  const legacy = hasTable(db, "content_sources") && hasTable(db, "content_items")
    ? db.prepare(`
        SELECT ci.title, ci.meta AS publishedAt
        FROM content_sources cs
        LEFT JOIN content_items ci ON ci.key=cs.content_key
        WHERE cs.provider='youtube' AND cs.external_id=?
        LIMIT 1
      `)
    : null;
  return ids.map((videoId) => {
    const row = youtube?.get(videoId) ?? legacy?.get(videoId) ?? null;
    return {
      videoId,
      title: clean(row?.title, 1000),
      publishedAt: clean(row?.publishedAt, 100) || null,
    };
  });
}

function sourceDescriptor(source) {
  const snapshot = source?.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  const base = {
    sourceType: String(source?.sourceType ?? ""),
    sourceKey: String(source?.sourceKey ?? ""),
    sourceVideoIds: textArray(source?.sourceVideoIds, 5000, 100),
  };
  if (base.sourceType === "node") {
    return {
      ...base,
      entityId: base.sourceKey,
      kind: clean(snapshot.kind, 80),
      name: clean(snapshot.name, 1000),
      aliases: textArray(snapshot.aliases, 80, 260),
      summary: clean(snapshot.summary, 12000),
      payload: snapshot.payload && typeof snapshot.payload === "object" ? snapshot.payload : {},
    };
  }
  return {
    ...base,
    fromKey: clean(snapshot.fromKey, 220),
    toKey: clean(snapshot.toKey, 220),
    label: clean(snapshot.label, 500),
  };
}

function contextSources(sourceMap, changes) {
  const included = new Set();
  const seedNodes = new Set();
  const addSource = (key) => {
    if (sourceMap.has(key)) included.add(key);
  };

  for (const change of Array.isArray(changes) ? changes : []) {
    const key = clean(change?.sourceKey, 220);
    if (!key) continue;
    addSource(key);
    const source = sourceMap.get(key);
    if (source?.sourceType === "node") seedNodes.add(key);
    if (source?.sourceType === "relation") {
      const snapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
      const fromKey = clean(snapshot.fromKey, 220);
      const toKey = clean(snapshot.toKey, 220);
      if (fromKey) seedNodes.add(fromKey);
      if (toKey) seedNodes.add(toKey);
    }
  }

  for (const source of sourceMap.values()) {
    if (source?.sourceType !== "relation") continue;
    const snapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
    const fromKey = clean(snapshot.fromKey, 220);
    const toKey = clean(snapshot.toKey, 220);
    if (!seedNodes.has(fromKey) && !seedNodes.has(toKey)) continue;
    included.add(String(source.sourceKey));
    if (fromKey) included.add(fromKey);
    if (toKey) included.add(toKey);
  }

  return [...included]
    .map((key) => sourceMap.get(key))
    .filter(Boolean)
    .map(sourceDescriptor)
    .sort((a, b) => `${a.sourceType}:${a.sourceKey}`.localeCompare(`${b.sourceType}:${b.sourceKey}`));
}

function buildRequest(db, runId) {
  narrativeStore.ensureSchema(db);
  narrativeStore.refreshStale(db);
  const run = narrativeStore.getRun(db, runId);
  if (!run) throw new Error("Hikâyeleştir isteği için çalışma bulunamadı.");
  if (run.state === "stale" || narrativeStore.isRunStale(db, runId)) {
    throw new Error("Stale Hikâyeleştir çalışması için AI isteği oluşturulamaz.");
  }
  if (run.state !== "prepared") throw new Error("AI isteği yalnız prepared Hikâyeleştir çalışması için oluşturulabilir.");

  const sourceMap = narrativeStore.runSourceMap(db, runId);
  const allSources = [...sourceMap.values()].map(sourceDescriptor)
    .sort((a, b) => `${a.sourceType}:${a.sourceKey}`.localeCompare(`${b.sourceType}:${b.sourceKey}`));
  const videoIds = [];
  for (const source of sourceMap.values()) {
    for (const videoId of source.sourceVideoIds ?? []) {
      const value = clean(videoId, 100);
      if (value && !videoIds.includes(value)) videoIds.push(value);
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    run: {
      id: run.id,
      baselineRunId: run.baselineRunId,
      inputFingerprint: run.inputFingerprint,
      universeFingerprint: run.universeFingerprint,
    },
    rules: {
      language: "tr",
      factualOnly: true,
      preserveChronology: true,
      preservePublishedNarrativeMemory: true,
      inventionAllowed: false,
      physicalPaginationAllowed: false,
      referenceRule: "reference.entityId yalnız allowedSources içindeki sourceType=node kayıtlarından biri olabilir ve aynı bölümün sourceKeys listesinde yer almalıdır.",
      revisionRule: "Mevcut bir bölümü değiştirirken baselineNarrative içindeki sectionId aynen kullanılmalıdır. Yeni bölüm için sectionId null gönderilir; stable kimliği Studio atar.",
    },
    input: {
      baselineNarrative: Array.isArray(run.input?.baselineNarrative) ? run.input.baselineNarrative : [],
      changes: Array.isArray(run.input?.changes) ? run.input.changes : [],
      removed: Array.isArray(run.input?.removed) ? run.input.removed : [],
      contextSources: contextSources(sourceMap, run.input?.changes),
      allowedSources: allSources,
      sourceVideos: videoMetadata(db, videoIds),
    },
    responseContract: {
      contractVersion: CONTRACT_VERSION,
      sections: [{
        sectionId: null,
        order: 0,
        title: "",
        sourceKeys: [],
        blocks: [{
          type: "paragraph",
          spans: [
            { type: "text", text: "" },
            { type: "reference", entityId: "approved-entity-id", label: "" },
          ],
        }],
        media: [],
        retire: false,
      }],
    },
  };
}

function parseResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new Error("Hikâyeleştir AI yanıtı JSON nesnesi olmalıdır.");
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  throw new Error("Hikâyeleştir AI yanıtı geçerli JSON nesnesi değil.");
}

function normalizedLayoutKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rejectPhysicalLayout(value, path = "response") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPhysicalLayout(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_LAYOUT_KEYS.has(normalizedLayoutKey(key))) {
      throw new Error(`Hikâyeleştir fiziksel sayfa/spread bilgisi üretemez: ${path}.${key}`);
    }
    rejectPhysicalLayout(child, `${path}.${key}`);
  }
}

function generatedSectionId(runId, index) {
  const digest = crypto.createHash("sha1").update(`narrative:${Number(runId)}:${Number(index)}`).digest("hex").slice(0, 14);
  return `narrative-section-${digest}`;
}

function normalizeResponse(db, runId, value) {
  narrativeStore.ensureSchema(db);
  narrativeStore.refreshStale(db);
  const run = narrativeStore.getRun(db, runId);
  if (!run) throw new Error("Hikâyeleştir yanıtı için çalışma bulunamadı.");
  if (run.state === "stale" || narrativeStore.isRunStale(db, runId)) {
    throw new Error("Evren değiştiği için stale Hikâyeleştir yanıtı kaydedilemez.");
  }
  if (run.state !== "prepared") throw new Error("Hikâyeleştir yanıtı yalnız prepared çalışmaya kaydedilebilir.");

  const response = parseResponse(value);
  rejectPhysicalLayout(response);
  if (response.contractVersion != null && Number(response.contractVersion) !== CONTRACT_VERSION) {
    throw new Error(`Desteklenmeyen Hikâyeleştir response contract sürümü: ${response.contractVersion}`);
  }
  const sections = Array.isArray(response.sections) ? response.sections : [];
  if (!sections.length) throw new Error("Hikâyeleştir AI yanıtı en az bir section içermelidir.");
  if (sections.length > 200) throw new Error("Hikâyeleştir AI yanıtında en fazla 200 section olabilir.");

  const sourceMap = narrativeStore.runSourceMap(db, runId);
  const baseline = Array.isArray(run.input?.baselineNarrative) ? run.input.baselineNarrative : [];
  const baselineById = new Map(baseline.map((section) => [String(section.sectionKey ?? section.sectionId ?? ""), section]).filter(([key]) => key));
  const seen = new Set();
  const maxBaselineOrder = baseline.reduce((max, section) => Math.max(max, Number(section.position ?? section.order ?? -1)), -1);

  const normalized = sections.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Hikâyeleştir section #${index + 1} geçersiz.`);
    const requestedId = clean(raw.sectionId ?? raw.sectionKey, 220);
    const previous = requestedId ? baselineById.get(requestedId) : null;
    if (requestedId && !previous) {
      throw new Error("Yeni anlatı bölümü için sectionId AI tarafından belirlenemez; stable sectionId Studio tarafından atanır.");
    }
    const retire = raw.retire === true;
    if (retire && !previous) throw new Error("Yalnız mevcut bir anlatı bölümü retire edilebilir.");
    const sectionId = requestedId || generatedSectionId(runId, index);
    if (seen.has(sectionId)) throw new Error(`Aynı sectionId Hikâyeleştir yanıtında iki kez kullanılamaz: ${sectionId}`);
    seen.add(sectionId);

    const sourceKeys = textArray(raw.sourceKeys, 5000, 220);
    const unknownSources = sourceKeys.filter((key) => !sourceMap.has(key));
    if (unknownSources.length) throw new Error(`Hikâyeleştir yanıtı run girdisinde olmayan sourceKeys içeriyor: ${unknownSources.join(", ")}`);
    if (!retire && !sourceKeys.length) throw new Error("Aktif Hikâyeleştir section'ı en az bir sourceKey içermelidir.");

    let order;
    if (raw.order == null && raw.position == null) {
      order = previous ? Number(previous.position ?? previous.order ?? index) : maxBaselineOrder + index + 1;
    } else {
      order = Number(raw.order ?? raw.position);
      if (!Number.isInteger(order) || order < 0) throw new Error("Hikâyeleştir section order değeri sıfır veya pozitif bir tam sayı olmalıdır.");
    }

    const title = clean(raw.title ?? previous?.title, 500);
    if (!retire && !title) throw new Error("Aktif Hikâyeleştir section başlığı boş olamaz.");
    const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
    if (!retire && !blocks.length) throw new Error("Aktif Hikâyeleştir section structured blocks içermelidir.");

    return {
      key: sectionId,
      position: order,
      title,
      sourceKeys,
      blocks,
      media: Array.isArray(raw.media) ? raw.media : [],
      retire,
    };
  });

  return { contractVersion: CONTRACT_VERSION, sections: normalized };
}

module.exports = {
  CONTRACT_VERSION,
  buildRequest,
  contextSources,
  normalizeResponse,
  rejectPhysicalLayout,
  videoMetadata,
};
