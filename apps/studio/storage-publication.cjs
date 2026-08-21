const path = require("node:path");
const { getMeta, setMeta } = require("./storage-database.cjs");
const publicationV2 = require("./publication-v2.cjs");

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordPublicationInfo(db, info) {
  const publication = {
    generatedAt: String(info?.generatedAt ?? ""),
    file: String(info?.file ?? ""),
    publicationId: String(info?.publicationId ?? ""),
    contentFingerprint: String(info?.contentFingerprint ?? ""),
    sectionCount: number(info?.sectionCount),
    entityCount: number(info?.entityCount),
    relationCount: number(info?.relationCount),
    assetCount: number(info?.assetCount),
  };
  setMeta(db, "last_export_at", publication.generatedAt);
  setMeta(db, "last_export_file", publication.file);
  setMeta(db, "last_export_publication_id", publication.publicationId);
  setMeta(db, "last_export_fingerprint", publication.contentFingerprint);
  setMeta(db, "last_export_sections", publication.sectionCount);
  setMeta(db, "last_export_entities", publication.entityCount);
  setMeta(db, "last_export_relations", publication.relationCount);
  setMeta(db, "last_export_assets", publication.assetCount);
  return {
    ...publication,
    itemCount: publication.sectionCount + publication.entityCount,
  };
}

function exportPublicSnapshot(db, userDataPath) {
  const result = publicationV2.exportPublicationV2(db, userDataPath);
  const publication = recordPublicationInfo(db, result);
  return {
    root: path.join(String(userDataPath), "public-export"),
    ...publication,
    assetsDirectory: result.assetsDirectory,
    readiness: result.readiness,
    publicationV2: result,
  };
}

function getPublicationInfo(db) {
  const generatedAt = getMeta(db, "last_export_at");
  if (!generatedAt) return null;
  const sectionCount = number(getMeta(db, "last_export_sections"));
  const entityCount = number(getMeta(db, "last_export_entities"));
  return {
    generatedAt,
    file: String(getMeta(db, "last_export_file") ?? ""),
    publicationId: String(getMeta(db, "last_export_publication_id") ?? ""),
    contentFingerprint: String(getMeta(db, "last_export_fingerprint") ?? ""),
    sectionCount,
    entityCount,
    relationCount: number(getMeta(db, "last_export_relations")),
    assetCount: number(getMeta(db, "last_export_assets")),
    itemCount: sectionCount + entityCount,
  };
}

module.exports = {
  exportPublicSnapshot,
  getPublicationInfo,
  recordPublicationInfo,
};
