const MEDIA_ROLES = new Set(["scene", "portrait", "location", "artifact", "supporting"]);

function clean(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
}

function inlineText(value, max = 12000) {
  return String(value ?? "").slice(0, max);
}

function entityFor(entityLookup, entityId) {
  const entity = typeof entityLookup === "function" ? entityLookup(entityId) : null;
  if (!entity || entity.sourceType !== "node") {
    throw new Error(`Anlatı referansı onaylı bir Evren entity kaydına bağlı değil: ${entityId}`);
  }
  return entity;
}

function ensureReferencedSource(sourceKeys, entityId) {
  if (sourceKeys && !sourceKeys.has(entityId)) {
    throw new Error(`Anlatı referansı bölümün sourceKeys listesinde yer almıyor: ${entityId}`);
  }
}

function normalizeSpans(value, options = {}) {
  const spans = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object") continue;
    const type = clean(raw.type, 40);
    if (type === "text" || type === "emphasis") {
      const text = inlineText(raw.text, 12000);
      if (text) spans.push({ type, text });
      continue;
    }
    if (type === "reference") {
      const entityId = clean(raw.entityId, 220);
      const label = clean(raw.label, 1000);
      if (!entityId || !label) throw new Error("Anlatı reference span'i entityId ve label içermelidir.");
      entityFor(options.entityLookup, entityId);
      ensureReferencedSource(options.sourceKeys, entityId);
      spans.push({ type: "reference", entityId, label });
      continue;
    }
    throw new Error(`Desteklenmeyen anlatı span türü: ${type || "(boş)"}`);
  }
  return spans;
}

function normalizeFigure(raw, options = {}) {
  const assetId = clean(raw.assetId, 220);
  if (!assetId) throw new Error("Figure block assetId içermelidir.");
  const role = clean(raw.role || "supporting", 80);
  if (!MEDIA_ROLES.has(role)) throw new Error(`Desteklenmeyen görsel rolü: ${role}`);
  const figure = {
    type: "figure",
    assetId,
    role,
    alt: clean(raw.alt, 2000),
    caption: clean(raw.caption, 4000),
  };
  const entityId = clean(raw.entityId, 220);
  if (entityId) {
    entityFor(options.entityLookup, entityId);
    ensureReferencedSource(options.sourceKeys, entityId);
    figure.entityId = entityId;
  }
  return figure;
}

function normalizeBlocks(value, options = {}) {
  const blocks = [];
  const rawBlocks = Array.isArray(value) ? value : [];
  if (rawBlocks.length > 400) throw new Error("Bir anlatı bölümünde en fazla 400 structured block olabilir.");
  for (const raw of rawBlocks) {
    if (!raw || typeof raw !== "object") continue;
    const type = clean(raw.type, 40);
    if (type === "paragraph") {
      const rawSpans = Array.isArray(raw.spans) ? raw.spans : [];
      if (rawSpans.length > 500) throw new Error("Bir paragrafta en fazla 500 span olabilir.");
      const spans = normalizeSpans(rawSpans, options);
      if (spans.length) blocks.push({ type: "paragraph", spans });
      continue;
    }
    if (type === "figure") {
      blocks.push(normalizeFigure(raw, options));
      continue;
    }
    throw new Error(`Desteklenmeyen anlatı block türü: ${type || "(boş)"}`);
  }
  return blocks;
}

function fallbackBlocks(body) {
  const text = clean(body, 60000);
  return text ? [{ type: "paragraph", spans: [{ type: "text", text }] }] : [];
}

function plainTextFromBlocks(blocks) {
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type === "paragraph") {
      const text = (Array.isArray(block.spans) ? block.spans : []).map((span) => {
        if (span?.type === "reference") return String(span.label ?? "");
        return String(span?.text ?? "");
      }).join("").trim();
      if (text) lines.push(text);
    } else if (block?.type === "figure" && block.caption) {
      lines.push(String(block.caption));
    }
  }
  return clean(lines.join("\n\n"), 60000);
}

function entityReferencesFromBlocks(blocks, entityLookup) {
  const result = [];
  const seen = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type !== "paragraph") continue;
    for (const span of Array.isArray(block.spans) ? block.spans : []) {
      if (span?.type !== "reference") continue;
      const entityId = clean(span.entityId, 220);
      if (!entityId || seen.has(entityId)) continue;
      seen.add(entityId);
      const entity = entityFor(entityLookup, entityId);
      const snapshot = entity.snapshot && typeof entity.snapshot === "object" ? entity.snapshot : {};
      result.push({
        entityId,
        kind: clean(snapshot.kind, 80),
        label: clean(span.label || snapshot.name || entityId, 1000),
      });
    }
  }
  return result;
}

function normalizeMedia(value, options = {}) {
  const result = [];
  const seen = new Set();
  const append = (raw) => {
    if (!raw || typeof raw !== "object") return;
    const assetId = clean(raw.assetId, 220);
    if (!assetId) throw new Error("Narrative media assetId içermelidir.");
    const role = clean(raw.role || "supporting", 80);
    if (!MEDIA_ROLES.has(role)) throw new Error(`Desteklenmeyen görsel rolü: ${role}`);
    const entityId = clean(raw.entityId, 220);
    if (entityId) {
      entityFor(options.entityLookup, entityId);
      ensureReferencedSource(options.sourceKeys, entityId);
    }
    const key = `${assetId}:${role}:${entityId}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      assetId,
      role,
      ...(entityId ? { entityId } : {}),
      alt: clean(raw.alt, 2000),
      caption: clean(raw.caption, 4000),
    });
  };
  for (const raw of Array.isArray(value) ? value : []) append(raw);
  for (const block of Array.isArray(options.blocks) ? options.blocks : []) {
    if (block?.type === "figure") append(block);
  }
  if (result.length > 400) throw new Error("Bir anlatı bölümünde en fazla 400 media bağlantısı olabilir.");
  return result;
}

module.exports = {
  MEDIA_ROLES,
  entityReferencesFromBlocks,
  fallbackBlocks,
  normalizeBlocks,
  normalizeMedia,
  plainTextFromBlocks,
};
