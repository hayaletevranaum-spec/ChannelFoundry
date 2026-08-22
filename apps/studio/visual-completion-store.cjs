const crypto = require("node:crypto");
const narrativeStore = require("./narrative-store.cjs");
const visualProfiles = require("./visual-profiles.cjs");

const SCENE_ROLE = "scene";
const SCENE_STATES = new Set(["pending", "skipped"]);

function clean(value, limit = 12000) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function stringArray(value, limit = 24, maxLength = 400) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry, maxLength);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function ensureSchema(db) {
  narrativeStore.ensureSchema(db);
  visualProfiles.ensureSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS narrative_visual_slots (
      section_key TEXT NOT NULL,
      revision_id INTEGER NOT NULL,
      slot_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('scene','portrait','location','artifact','supporting')),
      profile_key TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','skipped')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (section_key, revision_id, slot_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_narrative_visual_slots_profile
      ON narrative_visual_slots(profile_key);
  `);
}

function assetId(profileKey) {
  return `asset-${crypto.createHash("sha256").update(String(profileKey)).digest("hex").slice(0, 22)}`;
}

function sceneProfileKey(section) {
  return `narrative-scene:${clean(section.sectionKey, 220)}:revision:${Number(section.id)}`;
}

function entityRole(kind) {
  if (kind === "character") return "portrait";
  if (kind === "location") return "location";
  if (kind === "object") return "artifact";
  if (kind === "event") return "scene";
  return "supporting";
}

function compactProfile(profile) {
  if (!profile) return null;
  return {
    entityKey: profile.entityKey,
    entityType: profile.entityType,
    source: profile.source,
    description: profile.description,
    attributes: profile.attributes,
    atmosphere: profile.atmosphere,
    prompt: profile.prompt,
    negativePrompt: profile.negativePrompt,
    imagePath: profile.imagePath,
    imageSource: profile.imageSource,
    imageProvider: profile.imageProvider,
    imageModel: profile.imageModel,
    updatedAt: profile.updatedAt,
  };
}

function sceneSeed(section) {
  const references = (section.entityReferences ?? []).map((entry) => clean(entry.label, 180)).filter(Boolean);
  const referenceText = references.length ? references.join(", ") : "Açık entity referansı yok";
  const body = clean(section.body, 6500);
  const title = clean(section.title, 300) || section.sectionKey;
  return {
    description: body,
    attributes: references.map((label) => `Açık referans: ${label}`),
    atmosphere: "Araştırma günlüğü, belgesel ve arşiv hissi; sahne anlatıyı desteklemeli, yeni bilgi eklememeli.",
    prompt: [
      "Channel Foundry araştırma günlüğü için kaynaklara dayalı editoryal sahne illüstrasyonu oluştur.",
      `Bölüm: ${title}.`,
      `Onaylı anlatı: ${body}`,
      `Açıkça referans verilen varlıklar: ${referenceText}.`,
      "Yalnız anlatıda açıkça bulunan kişi, varlık, mekân, nesne ve olayları kullan.",
      "Kaynakta belirtilmeyen fiziksel özellik, kişi, nesne, mekân, yazı veya dramatik olay ekleme.",
      "Fiziksel kitap sayfası, çerçeve, arayüz, başlık metni veya dekoratif yazı üretme; yalnız sahne görselini üret.",
    ].join(" "),
    negativePrompt: "metin, logo, filigran, altyazı, UI, kitap sayfası, çerçeve, kaynakta olmayan kişi, kaynakta olmayan nesne, kaynakta olmayan mekân, uydurma fiziksel ayrıntı",
  };
}

function approvedUniverseNode(db, entityId) {
  try {
    const row = db.prepare(`
      SELECT key, kind, name, summary, payload_json AS payloadJson
      FROM universe_workspace_nodes
      WHERE key=? AND state='approved'
    `).get(clean(entityId, 220));
    if (!row) return null;
    const payload = safeJson(row.payloadJson, {});
    const visual = payload?.visual && typeof payload.visual === "object" ? payload.visual : {};
    return {
      key: clean(row.key, 220),
      kind: clean(row.kind, 80),
      name: clean(row.name, 300),
      summary: clean(row.summary, 6000),
      visual,
    };
  } catch {
    return null;
  }
}

function entitySeed(db, reference) {
  const node = approvedUniverseNode(db, reference.entityId);
  const kind = node?.kind || clean(reference.kind, 80) || "entity";
  const name = node?.name || clean(reference.label, 300) || reference.entityId;
  const description = clean(node?.visual?.description ?? node?.summary ?? "", 6000);
  const attributes = stringArray(node?.visual?.attributes, 24, 400);
  const atmosphere = clean(node?.visual?.atmosphere ?? "Araştırma arşivi, nötr belgesel sunum.", 1200);
  const prompt = clean(node?.visual?.prompt, 12000) || [
    `Channel Foundry arşiv kartı için ${name} adlı ${kind} kaydının kaynaklara dayalı görselini oluştur.`,
    description ? `Onaylı açıklama: ${description}.` : "Kaynaklarda fiziksel ayrıntı belirtilmemiş.",
    "Yalnız verilen açıklamadaki özellikleri kullan; bilinmeyen görünüş, kıyafet, yaş, renk, dönem veya çevre ayrıntısı uydurma.",
    "Metin, logo, filigran veya arayüz üretme.",
  ].join(" ");
  const negativePrompt = clean(node?.visual?.negativePrompt, 6000) || "metin, logo, filigran, UI, kaynakta belirtilmeyen fiziksel ayrıntı";
  return { description, attributes, atmosphere, prompt, negativePrompt };
}

function ensureCurrentSceneSlots(db) {
  ensureSchema(db);
  const memory = narrativeStore.narrativeMemory(db);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO narrative_visual_slots (
      section_key, revision_id, slot_key, role, profile_key, asset_id, state
    ) VALUES (?, ?, 'scene', ?, ?, ?, 'pending')
  `);
  for (const section of memory) {
    const profileKey = sceneProfileKey(section);
    insert.run(section.sectionKey, section.id, SCENE_ROLE, profileKey, assetId(profileKey));
  }
  return memory;
}

function sceneRow(db, section) {
  return db.prepare(`
    SELECT section_key AS sectionKey, revision_id AS revisionId, slot_key AS slotKey,
           role, profile_key AS profileKey, asset_id AS assetId, state,
           created_at AS createdAt, updated_at AS updatedAt
    FROM narrative_visual_slots
    WHERE section_key=? AND revision_id=? AND slot_key='scene'
  `).get(section.sectionKey, Number(section.id));
}

function status(db) {
  const memory = ensureCurrentSceneSlots(db);
  const scenes = memory.map((section) => {
    const row = sceneRow(db, section);
    const profile = compactProfile(visualProfiles.getMetadata(db, row.profileKey));
    const state = profile?.imagePath ? "ready" : row.state === "skipped" ? "skipped" : "pending";
    return {
      sectionKey: section.sectionKey,
      revisionId: section.id,
      revisionNo: section.revisionNo,
      position: section.position,
      title: section.title,
      body: section.body,
      sourceKeys: section.sourceKeys,
      sourceVideoIds: section.sourceVideoIds,
      entityReferences: section.entityReferences,
      role: row.role,
      profileKey: row.profileKey,
      assetId: row.assetId,
      state,
      seed: sceneSeed(section),
      profile,
    };
  });

  const referenceMap = new Map();
  for (const section of memory) {
    for (const reference of section.entityReferences ?? []) {
      const entityId = clean(reference.entityId, 220);
      if (!entityId || referenceMap.has(entityId)) continue;
      referenceMap.set(entityId, {
        entityId,
        kind: clean(reference.kind, 80) || "entity",
        label: clean(reference.label, 300) || entityId,
        sectionKeys: [section.sectionKey],
      });
    }
  }
  for (const section of memory) {
    for (const reference of section.entityReferences ?? []) {
      const entityId = clean(reference.entityId, 220);
      const entry = referenceMap.get(entityId);
      if (entry && !entry.sectionKeys.includes(section.sectionKey)) entry.sectionKeys.push(section.sectionKey);
    }
  }

  const entities = [...referenceMap.values()].map((reference) => {
    const node = approvedUniverseNode(db, reference.entityId);
    const kind = node?.kind || reference.kind;
    const profile = compactProfile(visualProfiles.getMetadata(db, reference.entityId));
    return {
      ...reference,
      kind,
      label: node?.name || reference.label,
      role: entityRole(kind),
      profileKey: reference.entityId,
      assetId: assetId(`entity:${reference.entityId}`),
      seed: entitySeed(db, { ...reference, kind }),
      profile,
      hasImage: Boolean(profile?.imagePath),
    };
  }).sort((left, right) => left.label.localeCompare(right.label, "tr"));

  const sceneReady = scenes.filter((entry) => entry.state === "ready").length;
  const sceneSkipped = scenes.filter((entry) => entry.state === "skipped").length;
  const scenePending = scenes.length - sceneReady - sceneSkipped;
  const entityReady = entities.filter((entry) => entry.hasImage).length;
  return {
    sections: scenes,
    entities,
    counts: {
      sections: scenes.length,
      sceneReady,
      sceneSkipped,
      scenePending,
      entities: entities.length,
      entityReady,
      entityMissing: Math.max(0, entities.length - entityReady),
    },
    complete: scenes.length > 0 && scenePending === 0,
  };
}

function setSceneState(db, input = {}) {
  const nextState = clean(input?.state, 40);
  if (!SCENE_STATES.has(nextState)) throw new Error("Görsel Tamamlama sahne durumu pending veya skipped olmalıdır.");
  const sectionKey = clean(input?.sectionKey, 220);
  const revisionId = Number(input?.revisionId);
  if (!sectionKey || !Number.isInteger(revisionId) || revisionId <= 0) {
    throw new Error("Görsel Tamamlama için geçerli bölüm ve revizyon gerekli.");
  }
  const memory = ensureCurrentSceneSlots(db);
  const current = memory.find((entry) => entry.sectionKey === sectionKey && Number(entry.id) === revisionId);
  if (!current) throw new Error("Yalnız güncel onaylı anlatı revizyonunun görsel kararı değiştirilebilir.");
  const row = sceneRow(db, current);
  const profile = visualProfiles.getMetadata(db, row.profileKey);
  if (nextState === "skipped" && profile?.imagePath) {
    throw new Error("Görseli olan bir sahne görselsiz bırakılamaz; önce mevcut görseli kaldır.");
  }
  db.prepare(`
    UPDATE narrative_visual_slots
    SET state=?, updated_at=CURRENT_TIMESTAMP
    WHERE section_key=? AND revision_id=? AND slot_key='scene'
  `).run(nextState, sectionKey, revisionId);
  return status(db);
}

module.exports = {
  assetId,
  ensureCurrentSceneSlots,
  ensureSchema,
  sceneProfileKey,
  setSceneState,
  status,
};
