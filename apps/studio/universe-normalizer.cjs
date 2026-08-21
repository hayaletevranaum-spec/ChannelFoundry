function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function textArray(value, limit = 20, max = 500) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = cleanText(entry, max);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeVisual(value) {
  const entry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    description: cleanText(entry.description, 1800),
    attributes: textArray(entry.attributes, 18, 300),
    atmosphere: cleanText(entry.atmosphere, 900),
    prompt: cleanText(entry.prompt, 6000),
    negativePrompt: cleanText(entry.negativePrompt, 2400),
  };
}

function ids(value, allowed) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = cleanText(entry, 80);
    if (!id || !allowed.has(id) || result.includes(id)) continue;
    result.push(id);
  }
  return result;
}

function detailArray(value, allowed, limit = 30) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry === "string") {
      const text = cleanText(entry, 700);
      if (text) result.push({ text, sourceVideoIds: [] });
    } else if (entry && typeof entry === "object") {
      const text = cleanText(entry.text ?? entry.description, 700);
      if (text) result.push({ text, sourceVideoIds: ids(entry.sourceVideoIds, allowed) });
    }
    if (result.length >= limit) break;
  }
  return result;
}

function namedEntities(value, allowed, kind) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = cleanText(entry.name, 220);
    if (!name) continue;
    const item = {
      name,
      aliases: textArray(entry.aliases, 12, 160),
      summary: cleanText(entry.summary, 3000),
      sourceVideoIds: ids(entry.sourceVideoIds, allowed),
      storyNames: textArray(entry.storyNames, 20, 220),
      details: detailArray(entry.details, allowed, 40),
      visual: normalizeVisual(entry.visual),
    };
    if (kind === "character") item.roles = textArray(entry.roles, 16, 260);
    result.push(item);
    if (result.length >= 80) break;
  }
  return result;
}

function normalizeStories(value, allowed) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = cleanText(entry.name, 220);
    if (!name) continue;
    result.push({
      name,
      aliases: textArray(entry.aliases, 12, 180),
      summary: cleanText(entry.summary, 5000),
      sourceVideoIds: ids(entry.sourceVideoIds, allowed),
      sequence: detailArray(entry.sequence, allowed, 40),
      characterNames: textArray(entry.characterNames, 40, 220),
      locationNames: textArray(entry.locationNames, 30, 220),
      objectNames: textArray(entry.objectNames, 30, 220),
      visual: normalizeVisual(entry.visual),
    });
    if (result.length >= 60) break;
  }
  return result;
}

function normalizeEvents(value, allowed) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = cleanText(entry.name, 220);
    if (!name) continue;
    result.push({
      name,
      summary: cleanText(entry.summary, 3000),
      sourceVideoIds: ids(entry.sourceVideoIds, allowed),
      storyNames: textArray(entry.storyNames, 20, 220),
      characterNames: textArray(entry.characterNames, 30, 220),
      locationNames: textArray(entry.locationNames, 20, 220),
      visual: normalizeVisual(entry.visual),
    });
    if (result.length >= 80) break;
  }
  return result;
}

function normalizeRelations(value, allowed) {
  const allowedTypes = new Set(["story", "character", "event", "location", "object"]);
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const fromType = cleanText(entry.fromType, 20);
    const toType = cleanText(entry.toType, 20);
    const fromName = cleanText(entry.fromName, 220);
    const toName = cleanText(entry.toName, 220);
    if (!allowedTypes.has(fromType) || !allowedTypes.has(toType) || !fromName || !toName) continue;
    result.push({ fromType, fromName, toType, toName, label: cleanText(entry.label || "bağlantılı", 160), sourceVideoIds: ids(entry.sourceVideoIds, allowed) });
    if (result.length >= 200) break;
  }
  return result;
}

function collectVideoIds(value, target = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectVideoIds(entry, target);
    return target;
  }
  if (!value || typeof value !== "object") return target;
  if (typeof value.videoId === "string" && value.videoId) target.add(value.videoId);
  if (Array.isArray(value.sourceVideoIds)) for (const id of value.sourceVideoIds) if (id) target.add(String(id));
  for (const child of Object.values(value)) collectVideoIds(child, target);
  return target;
}

function normalizeUniverse(value, allowed) {
  const entry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    stories: normalizeStories(entry.stories, allowed),
    characters: namedEntities(entry.characters, allowed, "character"),
    events: normalizeEvents(entry.events, allowed),
    locations: namedEntities(entry.locations, allowed, "location"),
    objects: namedEntities(entry.objects, allowed, "object"),
    relations: normalizeRelations(entry.relations, allowed),
  };
}

function compactSource(row) {
  const characters = safeJson(row.charactersJson, []).slice(0, 16).map((entry) => ({
    name: cleanText(entry?.name, 180), aliases: textArray(entry?.aliases, 8, 120), role: cleanText(entry?.role, 240), details: textArray(entry?.details, 8, 360), visual: normalizeVisual(entry?.visual),
  })).filter((entry) => entry.name);
  const compactNamed = (raw) => safeJson(raw, []).slice(0, 12).map((entry) => ({ name: cleanText(entry?.name, 180), details: textArray(entry?.details, 6, 300), visual: normalizeVisual(entry?.visual) })).filter((entry) => entry.name);
  const scenes = safeJson(row.scenesJson, []).slice(0, 8).map((entry) => ({ name: cleanText(entry?.name, 180), description: cleanText(entry?.description, 700), visual: normalizeVisual(entry?.visual) })).filter((entry) => entry.name || entry.description);
  return {
    videoId: String(row.videoId),
    title: cleanText(row.sourceTitle || row.title, 320),
    publishedAt: cleanText(row.publishedAt, 32),
    summary: cleanText(row.summary, 1800),
    topics: textArray(safeJson(row.topicsJson, []), 8, 140),
    storyHints: textArray(safeJson(row.storyHintsJson, []), 6, 180),
    storyBeats: textArray(safeJson(row.storyBeatsJson, []), 12, 700),
    characters,
    locations: compactNamed(row.locationsJson),
    objects: compactNamed(row.objectsJson),
    scenes,
  };
}

module.exports = { cleanText, collectVideoIds, compactSource, normalizeUniverse, safeJson };
