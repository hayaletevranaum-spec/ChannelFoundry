export class CommunityProvider {
  async getNotebookMeta() { throw new Error('Not implemented'); }
  async getCredits() { return { sponsors: [], contributors: [] }; }
  async listThreads(_options = {}) { throw new Error('Not implemented'); }
  async getThread(_threadId) { throw new Error('Not implemented'); }
}
