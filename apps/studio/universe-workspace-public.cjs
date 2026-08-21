const { clean, ensureSchema, safeJson, textArray } = require("./universe-workspace-core.cjs");
const { listNodes } = require("./universe-workspace-store.cjs");
const { attachPublicSupport } = require("./support-public.cjs");

function publicVisual(payload) {
  const visual = payload?.visual && typeof payload.visual === "object" ? payload.visual : {};
  const description = clean(visual.description, 4000);
  const attributes = textArray(visual.attributes, 30, 300);
  const atmosphere = clean(visual.atmosphere, 1000);
  if (!description && !attributes.length && !atmosphere) return undefined;
  return { description, attributes, atmosphere };
}

function publicDetailList(value) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    text: clean(entry?.text, 4000),
    sourceVideoIds: textArray(entry?.sourceVideoIds, 2000, 100),
  })).filter((entry) => entry.text);
}

function publicNode(node) {
  const payload = node.payload && typeof node.payload === "object" ? node.payload : {};
  const record = {
    id: node.key,
    kind: node.kind,
    name: node.name,
    aliases: node.aliases,
    summary: node.summary,
    sourceVideoIds: node.sourceVideoIds,
    status: "published",
  };
  const visual = publicVisual(payload);
  if (visual) record.visual = visual;
  if (Array.isArray(payload.roles) && payload.roles.length) record.roles = textArray(payload.roles, 30, 260);
  if (Array.isArray(payload.storyNames) && payload.storyNames.length) record.storyNames = textArray(payload.storyNames, 80, 260);
  if (Array.isArray(payload.characterNames) && payload.characterNames.length) record.characterNames = textArray(payload.characterNames, 80, 260);
  if (Array.isArray(payload.locationNames) && payload.locationNames.length) record.locationNames = textArray(payload.locationNames, 80, 260);
  if (Array.isArray(payload.objectNames) && payload.objectNames.length) record.objectNames = textArray(payload.objectNames, 80, 260);
  const sequence = publicDetailList(payload.sequence);
  if (sequence.length) record.sequence = sequence;
  const details = publicDetailList(payload.details);
  if (details.length) record.details = details;
  return record;
}

function publicEditorial(db) {
  ensureSchema(db);
  const nodes = listNodes(db, { state: "approved" }).map(publicNode);
  const byKey = new Map(nodes.map((node) => [node.id, node]));
  const relationRows = db.prepare(`
    SELECT key, from_key AS fromKey, to_key AS toKey, label, source_video_ids_json AS sourceVideoIdsJson
    FROM universe_workspace_relations WHERE state='approved' ORDER BY updated_at ASC, key ASC
  `).all();
  const relations = [];
  for (const row of relationRows) {
    const from = byKey.get(String(row.fromKey));
    const to = byKey.get(String(row.toKey));
    if (!from || !to) continue;
    relations.push({
      id: String(row.key),
      fromId: from.id,
      fromKind: from.kind,
      fromName: from.name,
      toId: to.id,
      toKind: to.kind,
      toName: to.name,
      label: String(row.label ?? "bağlantılı"),
      sourceVideoIds: textArray(safeJson(row.sourceVideoIdsJson, []), 2000, 100),
    });
  }
  return {
    nodes,
    relations,
    counts: {
      nodes: nodes.length,
      relations: relations.length,
      stories: nodes.filter((node) => node.kind === "story").length,
      characters: nodes.filter((node) => node.kind === "character").length,
      events: nodes.filter((node) => node.kind === "event").length,
      locations: nodes.filter((node) => node.kind === "location").length,
      objects: nodes.filter((node) => node.kind === "object").length,
    },
  };
}

function attachPublicSnapshot(db, snapshot) {
  if (!snapshot?.universe || typeof snapshot.universe !== "object") throw new Error("Public snapshot evren verisi geçersiz.");
  const editorial = publicEditorial(db);
  snapshot.universe.editorial = editorial;
  attachPublicSupport(db, snapshot);
  const legacyItemCount = ["videos", "characters", "events", "files"]
    .reduce((total, kind) => total + (Array.isArray(snapshot.universe[kind]) ? snapshot.universe[kind].length : 0), 0);
  const legacyRelationCount = Array.isArray(snapshot.universe.relations) ? snapshot.universe.relations.length : 0;
  snapshot.counts = {
    items: legacyItemCount + editorial.counts.nodes,
    relations: legacyRelationCount + editorial.counts.relations,
  };
  return snapshot;
}

module.exports = { attachPublicSnapshot, publicEditorial };
