const database = require("./storage-database.cjs");
const content = require("./storage-content.cjs");
const publication = require("./storage-publication.cjs");

// Stable storage boundary used by the Electron main process and verification scripts.
module.exports = {
  openStudioDatabase: database.openStudioDatabase,
  bootstrap: content.bootstrap,
  cleanupLegacyFixtureData: database.cleanupLegacyFixtureData,
  loadState: content.loadState,
  upsertItem: content.upsertItem,
  deleteItem: content.deleteItem,
  insertRelation: content.insertRelation,
  deleteRelation: content.deleteRelation,
  recordPublicationInfo: publication.recordPublicationInfo,
  exportPublicSnapshot: publication.exportPublicSnapshot,
  getPublicationInfo: publication.getPublicationInfo,
  getDatabaseInfo: database.getDatabaseInfo,
};
