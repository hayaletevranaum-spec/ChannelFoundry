const ARCHIVE_PROFILES = Object.freeze({
  desktop: Object.freeze({ capacity: 560, detailCharacters: 680 }),
  mobile: Object.freeze({ capacity: 430, detailCharacters: 460 }),
});

function preferredTextCut(text, maximum) {
  if (text.length <= maximum) return text.length;
  const floor = Math.floor(maximum * 0.58);
  for (let index = maximum; index >= floor; index -= 1) {
    if (/\s/u.test(text[index - 1])) return index;
  }
  return maximum;
}

function splitText(value, maximum) {
  const text = String(value ?? '').trim();
  if (!text) return [''];
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const length = preferredTextCut(rest, maximum);
    chunks.push(rest.slice(0, length).trim());
    offset += length;
    while (/\s/u.test(text[offset] ?? '')) offset += 1;
  }
  return chunks.filter(Boolean);
}

function detailItems(details, profile) {
  return (Array.isArray(details) ? details : []).flatMap((detail, detailIndex) => {
    const label = String(detail?.label ?? `Not ${detailIndex + 1}`).trim();
    const value = detail?.value ?? detail?.text ?? '';
    return splitText(value, profile.detailCharacters).map((text, partIndex) => ({
      type: 'detail',
      key: `detail-${detailIndex}-${partIndex}`,
      label: partIndex === 0 ? label : `${label} · devam`,
      text,
      cost: 68 + Math.ceil(text.length * 0.62),
    }));
  });
}

function relationItems(relations) {
  return (Array.isArray(relations) ? relations : []).map((relation, index) => ({
    type: 'relation',
    key: relation.relationId ?? `relation-${index}`,
    relation,
    cost: 86 + Math.ceil(String(relation.label ?? '').length * 0.5),
  }));
}

function paginateItems(items, capacity) {
  if (!items.length) return [[]];
  const pages = [];
  let page = [];
  let cost = 0;

  for (const item of items) {
    if (page.length && cost + item.cost > capacity) {
      pages.push(page);
      page = [];
      cost = 0;
    }
    page.push(item);
    cost += item.cost;
  }
  if (page.length) pages.push(page);
  return pages;
}

export function buildArchiveFrames(entity, relations, mode = 'desktop') {
  if (!entity) return [];
  const viewportMode = mode === 'mobile' ? 'mobile' : 'desktop';
  const profile = ARCHIVE_PROFILES[viewportMode];
  const items = [
    ...detailItems(entity.details, profile),
    ...relationItems(relations),
  ];
  const notePages = paginateItems(items, profile.capacity);
  const pages = [
    { kind: 'profile', entity },
    ...notePages.map((pageItems) => ({ kind: 'notes', entity, items: pageItems })),
  ];
  const pageTotal = pages.length;
  const numberedPages = pages.map((page, index) => ({
    ...page,
    recordPageNumber: index + 1,
    recordPageTotal: pageTotal,
  }));

  if (viewportMode === 'mobile') {
    return numberedPages.map((page) => ({ page }));
  }

  const frames = [];
  for (let index = 0; index < numberedPages.length; index += 2) {
    frames.push({
      left: numberedPages[index],
      right: numberedPages[index + 1] ?? { kind: 'blank', entity, recordPageNumber: index + 2, recordPageTotal: pageTotal },
    });
  }
  return frames;
}
