import { PublicationContentProvider } from './publication-provider.js';

export async function loadPublication(url = '/content/publication.json') {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Publication v2 paketi ${response.status} yanıtı verdi.`);
  const publication = await response.json().catch(() => null);
  if (!publication) throw new Error('Publication v2 paketi geçerli JSON değil.');
  const publicationUrl = response.url || new URL(url, window.location.href).toString();
  return new PublicationContentProvider(publication, { publicationUrl });
}
