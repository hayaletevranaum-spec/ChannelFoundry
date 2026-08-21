import { loadPublication } from './http-provider.js';

export function loadContentProvider() {
  return loadPublication('/content/publication.json');
}
