import { createSectionRenderAnchor, parseSectionRenderAnchor } from './navigation-state.js';

const PAGE_PROFILES = Object.freeze({
  mobile: Object.freeze({ capacity: 600, paragraphOverhead: 72, paragraphCharacters: 210, headingBase: 88, figureBase: 260 }),
  desktop: Object.freeze({ capacity: 690, paragraphOverhead: 72, paragraphCharacters: 260, headingBase: 88, figureBase: 320 }),
});

function resolveProfile(mode, capacityScale = 1) {
  const base = PAGE_PROFILES[mode];
  const scale = Math.min(1, Math.max(.42, Number(capacityScale) || 1));
  return {
    ...base,
    capacity: Math.max(300, Math.floor(base.capacity * scale)),
    paragraphCharacters: Math.max(118, Math.floor(base.paragraphCharacters * scale)),
  };
}

const stringLength = (value) => (typeof value === 'string' ? value.length : 0);

function spanLength(span) {
  if (!span || typeof span !== 'object') return 0;
  if (span.type === 'reference') return stringLength(span.label);
  return stringLength(span.text);
}

function paragraphLength(block) {
  return (block?.spans ?? []).reduce((total, span) => total + spanLength(span), 0);
}

function genericBlockLength(block) {
  return stringLength(block?.text) + stringLength(block?.label) + stringLength(block?.caption) + paragraphLength(block);
}

function normalizedFigure(media) {
  if (!media || typeof media !== 'object') return null;
  return media.type === 'figure' ? media : { ...media, type: 'figure' };
}

function normalizeSection(section) {
  const authoredBlocks = Array.isArray(section?.blocks) ? section.blocks.filter(Boolean) : [];
  const media = (Array.isArray(section?.media) ? section.media : []).map(normalizedFigure).filter(Boolean);
  const authoredAssetIds = new Set(
    authoredBlocks.filter((block) => block.type === 'figure' && block.assetId).map((block) => block.assetId),
  );
  const appendedAssetIds = new Set();
  const mediaBlocks = media.filter((block) => {
    if (!block.assetId) return true;
    if (authoredAssetIds.has(block.assetId) || appendedAssetIds.has(block.assetId)) return false;
    appendedAssetIds.add(block.assetId);
    return true;
  });
  return { blocks: [...authoredBlocks, ...mediaBlocks], media };
}

function preferredTextCut(text, maximum) {
  if (text.length <= maximum) return text.length;
  for (let index = maximum; index >= 1; index -= 1) {
    if (/\s/u.test(text[index - 1]) && text.slice(0, index).trim().length) return index;
  }
  return maximum;
}

function leadingWordLength(text) {
  const match = text.match(/^\s*\S+/u);
  return match ? match[0].length : 0;
}

function splitParagraph(block, maximumCharacters) {
  const totalLength = paragraphLength(block);
  if (totalLength <= maximumCharacters) return [{ block, offsetStart: 0, offsetEnd: totalLength }];

  const chunks = [];
  let spans = [];
  let chunkLength = 0;
  let chunkStart = 0;
  let semanticOffset = 0;

  function append(span, length) {
    if (!spans.length) chunkStart = semanticOffset;
    spans.push(span);
    chunkLength += length;
    semanticOffset += length;
  }

  function flush() {
    if (!spans.length) return;
    chunks.push({ block: { ...block, spans }, offsetStart: chunkStart, offsetEnd: semanticOffset });
    spans = [];
    chunkLength = 0;
  }

  for (const span of block.spans ?? []) {
    const length = spanLength(span);
    if (span?.type === 'reference') {
      if (chunkLength && chunkLength + length > maximumCharacters) flush();
      append(span, length);
      if (chunkLength >= maximumCharacters) flush();
      continue;
    }
    if (!length) {
      append(span, 0);
      continue;
    }

    const text = span.text;
    let textOffset = 0;
    while (textOffset < text.length) {
      if (chunkLength >= maximumCharacters) flush();
      const remaining = maximumCharacters - chunkLength;
      const rest = text.slice(textOffset);

      // Never leave the tail of a normal word on the next page merely because
      // the current page has a few characters left. Start that word on the
      // next chunk instead. Only genuinely overlong single words may split.
      if (chunkLength && rest.length > remaining && leadingWordLength(rest) > remaining) {
        flush();
        continue;
      }

      const take = preferredTextCut(rest, remaining);
      const part = rest.slice(0, take);
      const partSpan = textOffset === 0 && take === text.length ? span : { ...span, text: part };
      append(partSpan, part.length);
      textOffset += take;
      if (chunkLength >= maximumCharacters) flush();
    }
  }

  flush();
  return chunks;
}

function itemCost(block, profile) {
  if (block.type === 'paragraph') return profile.paragraphOverhead + paragraphLength(block);
  if (block.type === 'heading') return profile.headingBase + Math.ceil(stringLength(block.text) * .45);
  if (block.type === 'figure') return profile.figureBase + Math.min(40, Math.ceil(stringLength(block.caption) * .45));
  return 84 + Math.min(profile.paragraphCharacters, genericBlockLength(block));
}

function createItem(block, blockIndex, offsetStart, offsetEnd, profile) {
  return {
    block,
    blockIndex,
    offsetStart,
    offsetEnd,
    cost: itemCost(block, profile),
    isFigure: block.type === 'figure',
    isHeading: block.type === 'heading',
    isParagraph: block.type === 'paragraph',
  };
}

function createItems(blocks, profile) {
  return blocks.flatMap((block, blockIndex) => {
    if (block.type === 'paragraph') {
      return splitParagraph(block, profile.paragraphCharacters)
        .map((chunk) => createItem(chunk.block, blockIndex, chunk.offsetStart, chunk.offsetEnd, profile));
    }
    const length = Math.max(1, genericBlockLength(block));
    return [createItem(block, blockIndex, 0, length, profile)];
  });
}

function groupItems(items) {
  const groups = [];
  for (let index = 0; index < items.length;) {
    const grouped = [];
    if (items[index].isHeading) {
      while (items[index]?.isHeading) {
        grouped.push(items[index]);
        index += 1;
      }
      if (items[index]?.isParagraph) {
        grouped.push(items[index]);
        index += 1;
      }
    } else {
      grouped.push(items[index]);
      index += 1;
    }
    groups.push({
      items: grouped,
      cost: grouped.reduce((total, item) => total + item.cost, 0),
      hasFigure: grouped.some((item) => item.isFigure),
      hasParagraph: grouped.some((item) => item.isParagraph),
    });
  }
  return groups;
}

function pageFacts(page) {
  return {
    cost: page.groups.reduce((total, group) => total + group.cost, 0),
    hasFigure: page.groups.some((group) => group.hasFigure),
    hasParagraph: page.groups.some((group) => group.hasParagraph),
    paragraphGroups: page.groups.filter((group) => group.hasParagraph).length,
  };
}

function shouldStartPage(page, group, profile) {
  if (!page.groups.length) return false;
  const facts = pageFacts(page);
  if (facts.cost + group.cost > profile.capacity) return true;
  if (group.hasFigure && (facts.hasFigure || facts.paragraphGroups >= 2)) return true;
  if (facts.hasFigure && group.hasParagraph && facts.paragraphGroups >= 1) return true;
  return false;
}

function rebalanceFigurePages(pages, profile) {
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const facts = pageFacts(page);
    if (!facts.hasFigure || facts.hasParagraph) continue;

    const previous = pages[index - 1];
    const candidate = previous?.groups.at(-1);
    if (previous?.groups.length > 1 && candidate?.hasParagraph && !candidate.hasFigure && facts.cost + candidate.cost <= profile.capacity) {
      previous.groups.pop();
      page.groups.unshift(candidate);
      continue;
    }

    const next = pages[index + 1];
    const nextCandidate = next?.groups[0];
    if (next?.groups.length > 1 && nextCandidate?.hasParagraph && !nextCandidate.hasFigure && facts.cost + nextCandidate.cost <= profile.capacity) {
      next.groups.shift();
      page.groups.push(nextCandidate);
    }
  }
}

function paginateBlocks(blocks, profile) {
  const groups = groupItems(createItems(blocks, profile));
  if (!groups.length) return [{ groups: [] }];
  const pages = [];
  let page = { groups: [] };
  for (const group of groups) {
    if (shouldStartPage(page, group, profile)) {
      pages.push(page);
      page = { groups: [] };
    }
    page.groups.push(group);
  }
  if (page.groups.length) pages.push(page);
  rebalanceFigurePages(pages, profile);
  return pages;
}

const pageItems = (page) => page.groups.flatMap((group) => group.items);

function pageStart(page) {
  const first = pageItems(page)[0];
  return first ? { blockIndex: first.blockIndex, offset: first.offsetStart } : { blockIndex: 0, offset: 0 };
}

function pageEnd(page) {
  const last = pageItems(page).at(-1);
  return last ? { blockIndex: last.blockIndex, offset: last.offsetEnd } : { blockIndex: 0, offset: 0 };
}

const blocksOn = (page) => pageItems(page).map((item) => item.block);

function frameBase(section, media, start, end, semanticAnchors) {
  return {
    sectionId: section.sectionId,
    renderAnchor: semanticAnchors[0] ?? createSectionRenderAnchor(section.sectionId),
    title: section.title,
    order: section.order,
    section,
    revision: section.revision,
    sourceKeys: section.sourceKeys ?? [],
    sourceVideoIds: section.sourceVideoIds ?? [],
    media,
    semanticAnchors,
    semanticRange: { start, end },
  };
}

function buildMobileFrames(section, pages, media) {
  return pages.map((page) => {
    const start = pageStart(page);
    const end = pageEnd(page);
    const anchor = createSectionRenderAnchor(section.sectionId, start.blockIndex, start.offset);
    return {
      ...frameBase(section, media, start, end, anchor ? [anchor] : []),
      pageBlocks: blocksOn(page),
    };
  });
}

function buildDesktopFrames(section, pages, media) {
  const frames = [];
  for (let index = 0; index < pages.length; index += 2) {
    const left = pages[index];
    const right = pages[index + 1] ?? { groups: [] };
    const start = pageStart(left);
    const end = pages[index + 1] ? pageEnd(right) : pageEnd(left);
    const anchors = [left, ...(pages[index + 1] ? [right] : [])]
      .map((page) => pageStart(page))
      .map((position) => createSectionRenderAnchor(section.sectionId, position.blockIndex, position.offset))
      .filter(Boolean);
    frames.push({
      ...frameBase(section, media, start, end, anchors),
      leftBlocks: blocksOn(left),
      rightBlocks: blocksOn(right),
    });
  }
  return frames;
}

export function buildJournalFrames(sections, mode, options = {}) {
  const viewportMode = mode === 'mobile' ? 'mobile' : 'desktop';
  const profile = resolveProfile(viewportMode, options.capacityScale);
  return (Array.isArray(sections) ? sections : []).flatMap((section) => {
    if (!section || typeof section !== 'object') return [];
    const normalized = normalizeSection(section);
    const pages = paginateBlocks(normalized.blocks, profile);
    return viewportMode === 'mobile'
      ? buildMobileFrames(section, pages, normalized.media)
      : buildDesktopFrames(section, pages, normalized.media);
  });
}

function comparePositions(left, right) {
  if (left.blockIndex !== right.blockIndex) return left.blockIndex - right.blockIndex;
  return left.offset - right.offset;
}

function rangeContains(range, position) {
  if (!range?.start || !range?.end) return false;
  const fromStart = comparePositions(position, range.start);
  const beforeEnd = comparePositions(position, range.end);
  if (comparePositions(range.start, range.end) === 0) return fromStart === 0;
  return fromStart >= 0 && beforeEnd < 0;
}

export function resolveJournalFrame(frames, bookmark) {
  if (!Array.isArray(frames) || !frames.length) return 0;
  const candidates = frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.sectionId === bookmark?.sectionId);
  if (!candidates.length) return 0;

  const exact = candidates.find(({ frame }) => frame.renderAnchor === bookmark?.renderAnchor);
  if (exact) return exact.index;
  const pageAnchor = candidates.find(({ frame }) => frame.semanticAnchors?.includes(bookmark?.renderAnchor));
  if (pageAnchor) return pageAnchor.index;

  const position = parseSectionRenderAnchor(bookmark?.renderAnchor);
  if (!position || position.sectionId !== bookmark.sectionId) return candidates[0].index;
  const containing = candidates.find(({ frame }) => rangeContains(frame.semanticRange, position));
  if (containing) return containing.index;

  let nearest = candidates[0];
  for (const candidate of candidates) {
    if (!candidate.frame.semanticRange?.start) continue;
    if (comparePositions(candidate.frame.semanticRange.start, position) > 0) break;
    nearest = candidate;
  }
  return nearest.index;
}
