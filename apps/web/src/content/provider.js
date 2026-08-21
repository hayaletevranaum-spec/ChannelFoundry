export class ContentProvider {
  getPublicationMeta() { throw new Error('Not implemented'); }
  getJournalSections() { throw new Error('Not implemented'); }
  getSection(_sectionId) { throw new Error('Not implemented'); }
  getEntity(_entityId) { throw new Error('Not implemented'); }
  getEntityCard(_entityId) { throw new Error('Not implemented'); }
  getRelations(_entityId) { throw new Error('Not implemented'); }
  getAsset(_assetId) { throw new Error('Not implemented'); }
  getEntitiesByKind(_kind) { throw new Error('Not implemented'); }
}
