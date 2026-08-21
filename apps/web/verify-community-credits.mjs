import assert from 'node:assert/strict';
import { HttpCommunityProvider } from './src/community/http-provider.js';

globalThis.window = { location: { href: 'https://example.test/community' } };

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

const provider = new HttpCommunityProvider('/api/community/');

{
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).pathname);
    return response({
      schemaVersion: 2,
      publication: { generatedAt: '2026-08-17T05:00:00.000Z' },
      support: {
        sponsors: [{
          id: 'sponsor-1',
          name: 'Yayın Sponsoru',
          date: '2026-08-17',
          note: '',
          video: { id: 'video-1', title: 'Kaynak Video', url: 'https://www.youtube.com/watch?v=video-1' },
        }],
        contributors: [{ id: 'contributor-1', name: 'Katkı Sahibi', date: '', note: '', video: {} }],
      },
    });
  };
  const credits = await provider.getCredits();
  assert.deepEqual(requests, ['/content/publication.json'], 'Publication support varsa legacy dosya istenmemeli');
  assert.deepEqual(credits.sponsors.map((entry) => entry.name), ['Yayın Sponsoru']);
  assert.deepEqual(credits.contributors.map((entry) => entry.name), ['Katkı Sahibi']);
  assert.equal(credits.updatedAt, '2026-08-17T05:00:00.000Z');
}

{
  const requests = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    requests.push(pathname);
    if (pathname === '/content/publication.json') return response({ schemaVersion: 2, publication: {} });
    return response({
      schemaVersion: 1,
      updatedAt: '2026-08-16T00:00:00.000Z',
      sponsors: [{ id: 'legacy-1', name: 'Eski Sözleşme Sponsoru', date: '', note: '', video: {} }],
      contributors: [],
    });
  };
  const credits = await provider.getCredits();
  assert.deepEqual(requests, ['/content/publication.json', '/content/community-credits.json']);
  assert.deepEqual(credits.sponsors.map((entry) => entry.name), ['Eski Sözleşme Sponsoru']);
  assert.equal(credits.updatedAt, '2026-08-16T00:00:00.000Z');
}

{
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).pathname);
    return response({
      schemaVersion: 2,
      publication: { generatedAt: '2026-08-17T06:00:00.000Z' },
      support: { sponsors: [], contributors: [] },
    });
  };
  const credits = await provider.getCredits();
  assert.deepEqual(requests, ['/content/publication.json'], 'Boş publication support da yetkili kaynak sayılmalı');
  assert.deepEqual(credits, { sponsors: [], contributors: [], updatedAt: '2026-08-17T06:00:00.000Z' });
}

console.log('Community credits prefer publication support and retain the legacy JSON fallback');
