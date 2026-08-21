import { ContentProvider } from './provider.js';

function normalizeDetails(details) {
  return (Array.isArray(details) ? details : []).map((detail, index) => {
    if (detail && typeof detail === 'object' && ('label' in detail || 'value' in detail)) return detail;
    const text = typeof detail === 'string' ? detail : String(detail?.text ?? '').trim();
    return { label: `Not ${index + 1}`, value: text, sourceVideoIds: detail?.sourceVideoIds ?? [] };
  }).filter((detail) => detail.value || detail.text);
}

function resolveAsset(asset, publicationUrl) {
  if (!asset) return null;
  const raw = String(asset.url ?? '').trim();
  return { ...asset, url: raw ? new URL(raw, publicationUrl).toString() : '' };
}

function enrichSection(section) {
  const blocks = Array.isArray(section?.blocks) ? section.blocks.map((block) => ({ ...block })) : [];
  const figureAssets = new Set(blocks.filter((block) => block?.type === 'figure').map((block) => block.assetId));
  for (const media of Array.isArray(section?.media) ? section.media : []) {
    if (!media?.assetId || media.role !== 'scene' || figureAssets.has(media.assetId)) continue;
    blocks.push({ type: 'figure', assetId: media.assetId, role: media.role, ...(media.entityId ? { entityId: media.entityId } : {}), alt: media.alt ?? '', caption: media.caption ?? '' });
    figureAssets.add(media.assetId);
  }
  return { ...section, blocks };
}

export class PublicationContentProvider extends ContentProvider {
  constructor(publication, options = {}) {
    super();
    if (!publication || publication.schemaVersion !== 2) throw new Error('Desteklenmeyen publication sürümü. Schema v2 gerekli.');
    if (!publication.journal || !publication.archive || !Array.isArray(publication.assets)) throw new Error('Publication v2 paketi eksik.');
    this.publication = publication;
    this.publicationUrl = options.publicationUrl || new URL('/content/publication.json', window.location.href).toString();
    this.sections = (publication.journal.sections ?? []).map(enrichSection).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    this.sectionMap = new Map(this.sections.map((section) => [section.sectionId, section]));
    this.entities = (publication.archive.entities ?? []).map((entity) => ({ ...entity, details: normalizeDetails(entity.details) }));
    this.entityMap = new Map(this.entities.map((entity) => [entity.entityId, entity]));
    this.relations = Array.isArray(publication.archive.relations) ? publication.archive.relations : [];
    this.assetMap = new Map(publication.assets.map((asset) => [asset.assetId, resolveAsset(asset, this.publicationUrl)]));
  }

  getPublicationMeta() { return this.publication.publication ?? null; }
  getJournalSections() { return this.sections; }
  getSection(sectionId) { return this.sectionMap.get(sectionId) ?? null; }
  getEntity(entityId) { return this.entityMap.get(entityId) ?? null; }
  getAsset(assetId) { return this.assetMap.get(assetId) ?? null; }
  getEntitiesByKind(kind) { return this.entities.filter((entity) => entity.kind === kind); }
  getRelations(entityId) { return this.relations.filter((relation) => relation.fromEntityId === entityId || relation.toEntityId === entityId); }
  getEntityCard(entityId) {
    const entity = this.getEntity(entityId);
    if (!entity) return null;
    return { entityId: entity.entityId, kind: entity.kind, name: entity.name, summary: entity.summary, asset: entity.visual?.assetId ? this.getAsset(entity.visual.assetId) : null };
  }
}
