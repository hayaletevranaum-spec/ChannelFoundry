import { CommunityProvider } from './provider.js';

function endpointUrl(endpoint, action, params = {}) {
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function authorLabel(author) {
  return author?.displayName || author?.username || 'Topluluk';
}

function threadPreview(thread) {
  const count = Number(thread?.postCount ?? 0);
  const updated = String(thread?.updatedAt ?? thread?.createdAt ?? '').trim();
  return {
    threadId: String(thread?.id ?? ''),
    title: String(thread?.title ?? 'Başlıksız kayıt'),
    authorLabel: authorLabel(thread?.author),
    excerpt: [count ? `${count} ileti` : '', updated ? `Son hareket: ${updated}` : ''].filter(Boolean).join(' · '),
    visibility: thread?.visibility === 'special' ? 'special' : 'community',
    locked: Boolean(thread?.locked),
    postCount: count,
  };
}

function creditEntry(entry, index, prefix) {
  const video = entry?.video && typeof entry.video === 'object' ? entry.video : {};
  return {
    id: String(entry?.id || `${prefix}-${index + 1}`),
    name: String(entry?.name || '').trim(),
    date: String(entry?.date || '').trim(),
    note: String(entry?.note || '').trim(),
    video: {
      id: String(video?.id || '').trim(),
      title: String(video?.title || '').trim(),
      url: String(video?.url || '').trim(),
    },
  };
}

function creditPayload(payload) {
  if (!payload || typeof payload !== 'object'
      || !Array.isArray(payload.sponsors)
      || !Array.isArray(payload.contributors)) return null;
  return {
    sponsors: payload.sponsors.map((entry, index) => creditEntry(entry, index, 'sponsor')).filter((entry) => entry.name),
    contributors: payload.contributors.map((entry, index) => creditEntry(entry, index, 'contributor')).filter((entry) => entry.name),
  };
}

export class CommunityHttpError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'CommunityHttpError';
    this.status = status;
    this.code = code;
  }
}

export class HttpCommunityProvider extends CommunityProvider {
  constructor(endpoint = '/api/community/') {
    super();
    this.endpoint = endpoint;
  }

  async request(action, options = {}) {
    const method = options.method || 'GET';
    const init = {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    };
    if (options.form instanceof FormData) {
      init.body = options.form;
    } else if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(endpointUrl(this.endpoint, action, options.params), init);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok === false) {
      throw new CommunityHttpError(payload?.message || `Topluluk servisi ${response.status} yanıtı verdi.`, response.status, payload?.error || '');
    }
    return payload;
  }

  async getNotebookMeta() {
    return {
      title: 'Topluluk Defteri',
      subtitle: 'Üyelerin başlık, mesaj ve dosya paylaşım alanı',
      status: 'connected',
    };
  }

  async getCredits() {
    try {
      const publicationUrl = new URL('/content/publication.json', window.location.href);
      const publicationResponse = await fetch(publicationUrl, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const publication = await publicationResponse.json().catch(() => null);
      const credits = publicationResponse.ok ? creditPayload(publication?.support) : null;
      if (credits) return { ...credits, updatedAt: publication?.publication?.generatedAt || null };
    } catch {
      // Geçiş döneminde eski, ayrı kredi dosyasına geri düşülür.
    }

    const url = new URL('/content/community-credits.json', window.location.href);
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 404) return { sponsors: [], contributors: [] };
    const payload = await response.json().catch(() => null);
    const credits = response.ok ? creditPayload(payload) : null;
    if (!credits) {
      throw new CommunityHttpError('Sponsor ve katkı kayıtları okunamadı.', response.status, 'credits_unavailable');
    }
    return { ...credits, updatedAt: payload.updatedAt || null };
  }

  async getSession() {
    return this.request('me');
  }

  async register(input) {
    return this.request('register', { method: 'POST', body: input });
  }

  async login(input) {
    return this.request('login', { method: 'POST', body: input });
  }

  async logout() {
    return this.request('logout', { method: 'POST', body: {} });
  }

  async resendVerification(input) {
    return this.request('resend_verification', { method: 'POST', body: input });
  }

  async listThreads(options = {}) {
    const payload = await this.request('forum_threads');
    const threads = Array.isArray(payload.threads) ? payload.threads : Array.isArray(payload.items) ? payload.items : [];
    const limit = Math.max(1, Math.min(Number(options.limit ?? 50), 100));
    return threads.slice(0, limit).map(threadPreview).filter((thread) => thread.threadId);
  }

  async getThread(threadId) {
    const payload = await this.request('forum_thread', { params: { id: threadId } });
    return payload.thread ?? null;
  }

  async createThread(input) {
    const form = new FormData();
    form.set('title', String(input?.title || ''));
    form.set('body', String(input?.body || ''));
    if (input?.attachment instanceof File) form.set('attachment', input.attachment, input.attachment.name);
    return this.request('forum_create', { method: 'POST', form });
  }

  async reply(input) {
    const form = new FormData();
    form.set('threadId', String(input?.threadId || ''));
    form.set('body', String(input?.body || ''));
    if (input?.attachment instanceof File) form.set('attachment', input.attachment, input.attachment.name);
    return this.request('forum_reply', { method: 'POST', form });
  }
}
