const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const narrativeStore = require("./narrative-store.cjs");
const universeWorkspace = require("./universe-workspace.cjs");
const visualCompletion = require("./visual-completion-store.cjs");
const visualProfiles = require("./visual-profiles.cjs");
const aiAnalysis = require("./ai-analysis-public.cjs");
const supportPublic = require("./support-public.cjs");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function clean(value, limit = 12000) {
  return String(value ?? "").trim().slice(0, limit);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stringArray(value, limit = 2000, maxLength = 300) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry, maxLength);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function detailList(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = clean(entry?.text ?? entry, 4000);
    if (!text) continue;
    const sourceVideoIds = stringArray(entry?.sourceVideoIds, 2000, 100);
    const key = `${text}\u0000${sourceVideoIds.join("\u0001")}`;
    if (result.some((item) => item._key === key)) continue;
    result.push({ _key: key, text, sourceVideoIds });
  }
  return result.map(({ _key, ...entry }) => entry);
}

function entityRole(kind) {
  if (kind === "character") return "portrait";
  if (kind === "location") return "location";
  if (kind === "object") return "artifact";
  if (kind === "event") return "scene";
  return "supporting";
}

function fileMetadata(file) {
  const value = clean(file, 4000);
  if (!value || !fs.existsSync(value)) return null;
  const stat = fs.statSync(value);
  if (!stat.isFile()) return null;
  const sourceExtension = path.extname(value).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(sourceExtension)) return null;
  const extension = sourceExtension === ".jpeg" ? ".jpg" : sourceExtension;
  const buffer = fs.readFileSync(value);
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) return null;
  return {
    file: value,
    extension,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function addAsset(assetMap, sourceMap, input) {
  const assetId = clean(input?.assetId, 220);
  if (!assetId) throw new Error("Publication v2 görseli için stable assetId gerekli.");
  const meta = fileMetadata(input?.file);
  if (!meta) return null;
  const filename = `${assetId}-${meta.sha256.slice(0, 12)}${meta.extension}`;
  const record = {
    assetId,
    type: "image",
    role: clean(input?.role, 40) || "supporting",
    ...(input?.entityId ? { entityId: clean(input.entityId, 220) } : {}),
    ...(input?.sectionId ? { sectionId: clean(input.sectionId, 220) } : {}),
    url: `assets/${filename}`,
    alt: clean(input?.alt, 1000),
    ...(input?.caption ? { caption: clean(input.caption, 2000) } : {}),
    sha256: meta.sha256,
    bytes: meta.bytes,
    provenance: {
      source: clean(input?.source, 80),
      provider: clean(input?.provider, 160),
      model: clean(input?.model, 260),
    },
  };
  const existing = assetMap.get(assetId);
  if (existing && existing.sha256 !== record.sha256) {
    throw new Error(`Aynı assetId iki farklı görsel dosyasına bağlanamaz: ${assetId}`);
  }
  assetMap.set(assetId, record);
  sourceMap.set(assetId, { assetId, file: meta.file, filename });
  return record;
}

function archiveData(db, assetMap, assetSourceMap) {
  const editorial = universeWorkspace.publicEditorial(db);
  const relationIds = new Map(editorial.nodes.map((node) => [node.id, []]));
  const relations = editorial.relations.map((relation) => {
    relationIds.get(relation.fromId)?.push(relation.id);
    relationIds.get(relation.toId)?.push(relation.id);
    return {
      relationId: relation.id,
      fromEntityId: relation.fromId,
      toEntityId: relation.toId,
      label: clean(relation.label, 300) || "bağlantılı",
      sourceVideoIds: stringArray(relation.sourceVideoIds, 2000, 100),
    };
  }).sort((left, right) => left.relationId.localeCompare(right.relationId));

  const entities = editorial.nodes.map((node) => {
    const profile = visualProfiles.getMetadata(db, node.id);
    const assetId = visualCompletion.assetId(`entity:${node.id}`);
    const asset = addAsset(assetMap, assetSourceMap, {
      assetId,
      file: profile?.imagePath,
      role: entityRole(node.kind),
      entityId: node.id,
      alt: `${node.name || node.id} arşiv görseli`,
      source: profile?.imageSource,
      provider: profile?.imageProvider,
      model: profile?.imageModel,
    });
    const details = detailList([...(node.details ?? []), ...(node.sequence ?? [])]);
    return {
      entityId: node.id,
      kind: node.kind,
      name: node.name,
      aliases: stringArray(node.aliases, 100, 300),
      summary: clean(node.summary, 6000),
      sourceVideoIds: stringArray(node.sourceVideoIds, 2000, 100),
      details,
      relations: [...new Set(relationIds.get(node.id) ?? [])].sort(),
      ...(Array.isArray(node.roles) && node.roles.length ? { roles: stringArray(node.roles, 50, 300) } : {}),
      ...(Array.isArray(node.storyNames) && node.storyNames.length ? { storyNames: stringArray(node.storyNames, 100, 300) } : {}),
      ...(Array.isArray(node.characterNames) && node.characterNames.length ? { characterNames: stringArray(node.characterNames, 100, 300) } : {}),
      ...(Array.isArray(node.locationNames) && node.locationNames.length ? { locationNames: stringArray(node.locationNames, 100, 300) } : {}),
      ...(Array.isArray(node.objectNames) && node.objectNames.length ? { objectNames: stringArray(node.objectNames, 100, 300) } : {}),
      visual: asset ? { assetId } : {},
    };
  }).sort((left, right) => `${left.kind}:${left.entityId}`.localeCompare(`${right.kind}:${right.entityId}`));

  return { entities, relations };
}

function mediaEntry(value) {
  return {
    assetId: clean(value?.assetId, 220),
    role: clean(value?.role, 40) || "supporting",
    ...(value?.entityId ? { entityId: clean(value.entityId, 220) } : {}),
    alt: clean(value?.alt, 1000),
    caption: clean(value?.caption, 2000),
  };
}

function journalData(db, archive, assetMap, assetSourceMap) {
  const memory = narrativeStore.narrativeMemory(db);
  const visualStatus = visualCompletion.status(db);
  const sceneByRevision = new Map(visualStatus.sections.map((scene) => [Number(scene.revisionId), scene]));
  const archiveIds = new Set(archive.entities.map((entity) => entity.entityId));

  for (const scene of visualStatus.sections) {
    if (scene.state !== "ready") continue;
    addAsset(assetMap, assetSourceMap, {
      assetId: scene.assetId,
      file: scene.profile?.imagePath,
      role: "scene",
      sectionId: scene.sectionKey,
      alt: `${scene.title || scene.sectionKey} sahne görseli`,
      source: scene.profile?.imageSource,
      provider: scene.profile?.imageProvider,
      model: scene.profile?.imageModel,
    });
  }

  const sections = memory.map((section) => {
    for (const reference of section.entityReferences ?? []) {
      if (!archiveIds.has(reference.entityId)) {
        throw new Error(`Publication v2 anlatı referansı onaylı archive entity'sine çözülmüyor: ${reference.entityId}`);
      }
    }
    const blocks = JSON.parse(JSON.stringify(Array.isArray(section.blocks) ? section.blocks : []));
    for (const block of blocks) {
      if (block?.type === "figure" && !assetMap.has(clean(block.assetId, 220))) {
        throw new Error(`Publication v2 figure assetId çözümlenemedi: ${clean(block.assetId, 220)}`);
      }
    }
    const media = [];
    const seenMedia = new Set();
    for (const raw of Array.isArray(section.media) ? section.media : []) {
      const entry = mediaEntry(raw);
      if (!entry.assetId) continue;
      if (!assetMap.has(entry.assetId)) throw new Error(`Publication v2 media assetId çözümlenemedi: ${entry.assetId}`);
      if (seenMedia.has(entry.assetId)) continue;
      seenMedia.add(entry.assetId);
      media.push(entry);
    }
    const scene = sceneByRevision.get(Number(section.id));
    if (scene?.state === "ready" && assetMap.has(scene.assetId) && !seenMedia.has(scene.assetId)) {
      media.push({ assetId: scene.assetId, role: "scene", alt: `${section.title || section.sectionKey} sahne görseli`, caption: "" });
    }
    return {
      sectionId: section.sectionKey,
      revision: section.revisionNo,
      order: section.position,
      title: section.title,
      blocks,
      sourceKeys: stringArray(section.sourceKeys, 5000, 220),
      sourceVideoIds: stringArray(section.sourceVideoIds, 5000, 100),
      media,
    };
  }).sort((left, right) => left.order - right.order || left.sectionId.localeCompare(right.sectionId));

  const next = narrativeStore.buildInput(db);
  return {
    journal: { sections },
    readiness: {
      narrativeSections: sections.length,
      narrativeChangesPending: Boolean(next.hasChanges),
      visualComplete: Boolean(visualStatus.complete),
      readyForTheme: sections.length > 0 && !next.hasChanges && Boolean(visualStatus.complete),
    },
  };
}

function buildPublicationV2(db, options = {}) {
  const assetMap = new Map();
  const assetSourceMap = new Map();
  const archive = archiveData(db, assetMap, assetSourceMap);
  const journalResult = journalData(db, archive, assetMap, assetSourceMap);
  const assets = [...assetMap.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const youtubeAnalysis = { videos: aiAnalysis.publicVideoSummaries(db) };
  const support = supportPublic.publicationSupport(db);
  const logical = {
    schemaVersion: 2,
    journal: journalResult.journal,
    archive,
    assets,
    youtubeAnalysis,
    support,
  };
  const contentFingerprint = fingerprint(logical);
  const generatedAt = clean(options.generatedAt, 80) || new Date().toISOString();
  const snapshot = {
    schemaVersion: 2,
    publication: {
      id: `pub-${contentFingerprint.slice(0, 24)}`,
      generatedAt,
      contentFingerprint,
    },
    journal: logical.journal,
    archive: logical.archive,
    assets: logical.assets,
    youtubeAnalysis: logical.youtubeAnalysis,
    support: logical.support,
  };
  return {
    snapshot,
    assetSources: [...assetSourceMap.values()].sort((left, right) => left.assetId.localeCompare(right.assetId)),
    readiness: journalResult.readiness,
  };
}

function exportPublicationV2(db, userDataPath, options = {}) {
  const built = buildPublicationV2(db, options);
  const contentDirectory = path.join(String(userDataPath), "public-export", "content");
  const assetsDirectory = path.join(contentDirectory, "assets");
  const file = path.join(contentDirectory, "publication.json");
  const temporaryAssets = path.join(contentDirectory, `.publication-assets-${process.pid}-${Date.now()}`);
  const temporaryFile = `${file}.tmp`;
  fs.mkdirSync(temporaryAssets, { recursive: true });
  try {
    for (const asset of built.assetSources) fs.copyFileSync(asset.file, path.join(temporaryAssets, asset.filename));
    fs.mkdirSync(contentDirectory, { recursive: true });
    fs.writeFileSync(temporaryFile, `${JSON.stringify(built.snapshot, null, 2)}\n`, "utf8");
    fs.rmSync(assetsDirectory, { recursive: true, force: true });
    fs.renameSync(temporaryAssets, assetsDirectory);
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    fs.rmSync(temporaryAssets, { recursive: true, force: true });
    try { fs.unlinkSync(temporaryFile); } catch {}
    throw error;
  }
  return {
    file,
    assetsDirectory,
    publicationId: built.snapshot.publication.id,
    contentFingerprint: built.snapshot.publication.contentFingerprint,
    generatedAt: built.snapshot.publication.generatedAt,
    sectionCount: built.snapshot.journal.sections.length,
    entityCount: built.snapshot.archive.entities.length,
    relationCount: built.snapshot.archive.relations.length,
    assetCount: built.snapshot.assets.length,
    readiness: built.readiness,
  };
}

module.exports = {
  buildPublicationV2,
  exportPublicationV2,
  fingerprint,
};
