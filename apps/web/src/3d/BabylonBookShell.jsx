import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildArchiveFrames } from '../book/archive-pagination.js';
import { buildJournalFrames, resolveJournalFrame } from '../book/pagination.js';
import { createJournalBookmark } from '../book/navigation-state.js';
import { ArchiveCard, ArchiveNotesPage } from '../components/ArchiveCards.jsx';
import { BookContents } from '../components/BookContents.jsx';
import { BookSectionIndex } from '../components/BookSectionIndex.jsx';
import { CategoryBookmarks } from '../components/CategoryBookmarks.jsx';
import { ContentBlocks } from '../components/ContentBlocks.jsx';
import { BabylonBookViewport } from './BabylonBookViewport.jsx';

export function useViewportMode() {
  const getMode = () => (window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop');
  const [mode, setMode] = useState(getMode);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const update = () => setMode(query.matches ? 'mobile' : 'desktop');
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return mode;
}

const BOOK_FRAME_KINDS = new Set(['story', 'character', 'location', 'object']);

export function Page({ children, side = 'single', scrollable = false, paginated = false, frameKind = null, className = '' }) {
  const resolvedFrameKind = BOOK_FRAME_KINDS.has(frameKind) ? frameKind : null;
  return (
    <section
      className={`paper-page paper-${side} babylon-content-page${scrollable ? ' is-scrollable' : ''}${className ? ` ${className}` : ''}`}
      data-book-frame={resolvedFrameKind ?? undefined}
      data-paginated-page={paginated ? 'true' : undefined}
    >
      {resolvedFrameKind ? <span className="book-page-frame" data-frame-kind={resolvedFrameKind} aria-hidden="true" /> : null}
      {children}
    </section>
  );
}

export function PageTurnMarkers({ canGoBack, canGoForward, turning, onBack, onForward, ariaLabel = 'Günlük sayfaları', backLabel = 'Önceki sayfa', forwardLabel = 'Sonraki sayfa' }) {
  return (
    <nav className="page-turn-markers" aria-label={ariaLabel}>
      {canGoBack ? (
        <button type="button" className="page-turn-marker page-turn-marker-back" onClick={onBack} disabled={turning} aria-label={backLabel} title="Önceki sayfa"><span aria-hidden="true" /></button>
      ) : null}
      {canGoForward ? (
        <button type="button" className="page-turn-marker page-turn-marker-forward" onClick={onForward} disabled={turning} aria-label={forwardLabel} title="Sonraki sayfa"><span aria-hidden="true" /></button>
      ) : null}
    </nav>
  );
}

export function validLayout(nextLayout) {
  return Boolean(
    nextLayout
    && Number.isFinite(nextLayout.leftPage?.left)
    && Number.isFinite(nextLayout.leftPage?.width)
    && Number.isFinite(nextLayout.rightPage?.left)
    && Number.isFinite(nextLayout.rightPage?.width)
    && Number.isFinite(nextLayout.markers?.back?.x)
    && Number.isFinite(nextLayout.markers?.forward?.x)
  );
}

export function quadTransform(rect) {
  const corners = rect?.corners;
  const width = Math.max(1, rect?.width ?? 0);
  const height = Math.max(1, rect?.height ?? 0);
  if (!corners?.topLeft || !corners?.topRight || !corners?.bottomRight || !corners?.bottomLeft) return 'none';

  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
    .map((point) => ({ x: point.x - rect.left, y: point.y - rect.top }));
  const [p0, p1, p2, p3] = points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 0.000001) return 'none';

  const perspectiveX = (dx3 * dy2 - dx2 * dy3) / denominator;
  const perspectiveY = (dx1 * dy3 - dx3 * dy1) / denominator;
  const scaleX = p1.x - p0.x + perspectiveX * p1.x;
  const skewX = p3.x - p0.x + perspectiveY * p3.x;
  const scaleY = p1.y - p0.y + perspectiveX * p1.y;
  const skewY = p3.y - p0.y + perspectiveY * p3.y;
  const matrix = [
    scaleX / width, scaleY / width, 0, perspectiveX / width,
    skewX / height, skewY / height, 0, perspectiveY / height,
    0, 0, 1, 0,
    p0.x, p0.y, 0, 1,
  ];
  return `matrix3d(${matrix.map((value) => Number(value.toFixed(9))).join(',')})`;
}

const CATEGORY_LABELS = Object.freeze({ character: 'Kişiler', location: 'Mekânlar', object: 'Objeler' });
const INDEX_PAGE_SIZES = Object.freeze({ desktop: 10, mobile: 4 });

function indexPage(items, pageIndex, pageSize) {
  const startIndex = pageIndex * pageSize;
  return { items: items.slice(startIndex, startIndex + pageSize), startIndex };
}

export function BabylonBookShell({ provider }) {
  const mode = useViewportMode();
  const sections = useMemo(() => provider.getJournalSections(), [provider]);
  const [paginationScale, setPaginationScale] = useState(1);
  const frames = useMemo(() => buildJournalFrames(sections, mode, { capacityScale: paginationScale }), [sections, mode, paginationScale]);
  const engineRef = useRef(null);
  const contentRef = useRef(null);

  const [phase, setPhase] = useState('closed');
  const [contentVisible, setContentVisible] = useState(false);
  const [contentEntering, setContentEntering] = useState(false);
  const [turning, setTurning] = useState(false);
  const [surface, setSurface] = useState('contents');
  const [journalLocation, setJournalLocation] = useState(null);
  const [archiveEntityId, setArchiveEntityId] = useState(null);
  const [archiveKind, setArchiveKind] = useState(null);
  const [archiveFrameIndex, setArchiveFrameIndex] = useState(0);
  const [journalIndexPage, setJournalIndexPage] = useState(0);
  const [archiveIndexPage, setArchiveIndexPage] = useState(0);
  const [returnBookmark, setReturnBookmark] = useState(null);
  const [returnSurface, setReturnSurface] = useState('journal');
  const [returnKind, setReturnKind] = useState(null);
  const [categoryOriginSurface, setCategoryOriginSurface] = useState('contents');
  const [categoryOriginBookmark, setCategoryOriginBookmark] = useState(null);
  const [layout, setLayout] = useState(null);

  const journalIndex = resolveJournalFrame(frames, journalLocation);
  const frame = frames[journalIndex] ?? null;
  const archiveFrames = useMemo(() => {
    if (!archiveEntityId) return [];
    const currentEntity = provider.getEntity(archiveEntityId);
    return buildArchiveFrames(currentEntity, provider.getRelations(archiveEntityId), mode);
  }, [archiveEntityId, mode, provider]);
  const resolvedArchiveFrameIndex = Math.min(archiveFrameIndex, Math.max(0, archiveFrames.length - 1));
  const archiveFrame = archiveFrames[resolvedArchiveFrameIndex] ?? null;
  const archiveEntities = archiveKind ? provider.getEntitiesByKind(archiveKind) : [];
  const indexPageSize = INDEX_PAGE_SIZES[mode];
  const journalIndexPageTotal = Math.max(1, Math.ceil(sections.length / indexPageSize));
  const archiveIndexPageTotal = Math.max(1, Math.ceil(archiveEntities.length / indexPageSize));
  const resolvedJournalIndexPage = Math.min(journalIndexPage, journalIndexPageTotal - 1);
  const resolvedArchiveIndexPage = Math.min(archiveIndexPage, archiveIndexPageTotal - 1);
  const journalIndexSlice = indexPage(sections, resolvedJournalIndexPage, indexPageSize);
  const archiveIndexSlice = indexPage(archiveEntities, resolvedArchiveIndexPage, indexPageSize);
  const archiveIndex = archiveEntityId && archiveKind
    ? archiveEntities.findIndex((item) => item.entityId === archiveEntityId)
    : -1;

  useEffect(() => { setPaginationScale(1); }, [mode, sections]);
  useEffect(() => {
    setArchiveFrameIndex((current) => Math.min(current, Math.max(0, archiveFrames.length - 1)));
  }, [archiveFrames.length]);
  useEffect(() => {
    setJournalIndexPage((current) => Math.min(current, journalIndexPageTotal - 1));
    setArchiveIndexPage((current) => Math.min(current, archiveIndexPageTotal - 1));
  }, [archiveIndexPageTotal, journalIndexPageTotal]);

  useLayoutEffect(() => {
    if (!contentVisible || surface !== 'journal' || !frame || paginationScale <= 0.42) return undefined;
    const frameId = requestAnimationFrame(() => {
      const pages = contentRef.current?.querySelectorAll('[data-paginated-page="true"]') ?? [];
      const overflows = Array.from(pages).some((page) => page.scrollHeight > page.clientHeight + 2);
      if (overflows) setPaginationScale((current) => Math.max(0.42, Number((current * 0.82).toFixed(3))));
    });
    return () => cancelAnimationFrame(frameId);
  }, [contentVisible, frame, mode, paginationScale, surface]);

  const handleReady = useCallback((api) => { engineRef.current = api; }, []);
  const handleLayout = useCallback((nextLayout) => {
    if (validLayout(nextLayout)) setLayout(nextLayout);
  }, []);

  function refreshLayout(engine = engineRef.current) {
    if (!engine?.getPresentationLayout) return;
    const nextLayout = engine.getPresentationLayout();
    if (validLayout(nextLayout)) setLayout(nextLayout);
  }

  async function openBook() {
    const engine = engineRef.current;
    if (!engine || phase !== 'closed') return;
    setPhase('opening');
    await engine.open();
    refreshLayout(engine);
    setPhase('open');
    setContentVisible(true);
    setContentEntering(true);
  }

  async function closeBook() {
    const engine = engineRef.current;
    if (!engine || phase !== 'open' || turning) return;
    setPhase('closing');
    setContentEntering(false);
    setContentVisible(false);
    await engine.close();
    setArchiveEntityId(null);
    setArchiveKind(null);
    setArchiveFrameIndex(0);
    setJournalIndexPage(0);
    setArchiveIndexPage(0);
    setReturnBookmark(null);
    setReturnSurface('journal');
    setReturnKind(null);
    setCategoryOriginSurface('contents');
    setCategoryOriginBookmark(null);
    setSurface('contents');
    setPhase('closed');
  }

  async function animateTurn(direction, action) {
    const engine = engineRef.current;
    if (!engine || phase !== 'open' || turning) return;
    setTurning(true);
    try {
      await engine.turnPage(direction, action);
      refreshLayout(engine);
    } finally {
      setTurning(false);
    }
  }

  function openJournalFromContents() {
    if (surface !== 'contents' || turning || !sections.length) return;
    animateTurn('forward', () => {
      setJournalIndexPage(0);
      setSurface('journal-index');
    });
  }

  function openJournalSection(sectionId) {
    if (surface !== 'journal-index' || turning) return;
    const target = frames.find((candidate) => candidate.sectionId === sectionId);
    if (!target) return;
    animateTurn('forward', () => {
      setJournalLocation(createJournalBookmark(target));
      setSurface('journal');
    });
  }

  function move(delta) {
    if (surface !== 'journal' || archiveEntityId || turning || frames.length === 0) return;
    if (delta < 0 && journalIndex === 0) {
      animateTurn('backward', () => setSurface('journal-index'));
      return;
    }
    const next = Math.min(Math.max(journalIndex + delta, 0), frames.length - 1);
    if (next === journalIndex) return;
    animateTurn(delta > 0 ? 'forward' : 'backward', () => { setJournalLocation(createJournalBookmark(frames[next])); });
  }

  function moveArchive(delta) {
    if (turning || !archiveEntityId) return;
    if (delta < 0 && resolvedArchiveFrameIndex > 0) {
      animateTurn('backward', () => setArchiveFrameIndex((current) => Math.max(0, current - 1)));
      return;
    }
    if (delta > 0 && resolvedArchiveFrameIndex < archiveFrames.length - 1) {
      animateTurn('forward', () => setArchiveFrameIndex((current) => Math.min(archiveFrames.length - 1, current + 1)));
      return;
    }
    if (!archiveKind || archiveIndex < 0) return;
    if (delta < 0 && archiveIndex === 0) {
      animateTurn('backward', () => {
        setArchiveEntityId(null);
        setArchiveFrameIndex(0);
        setSurface('archive-index');
      });
      return;
    }
    const next = archiveIndex + delta;
    if (next < 0 || next >= archiveEntities.length) return;
    const nextEntity = archiveEntities[next];
    const nextFrames = buildArchiveFrames(nextEntity, provider.getRelations(nextEntity.entityId), mode);
    animateTurn(delta > 0 ? 'forward' : 'backward', () => {
      setArchiveEntityId(nextEntity.entityId);
      setArchiveFrameIndex(delta > 0 ? 0 : Math.max(0, nextFrames.length - 1));
    });
  }

  function openArchive(entityId) {
    if (phase !== 'open' || turning || surface !== 'journal' || !frame) return;
    setReturnBookmark(createJournalBookmark(frame));
    setReturnSurface('journal');
    setReturnKind(null);
    animateTurn('forward', () => {
      setArchiveKind(null);
      setArchiveEntityId(entityId);
      setArchiveFrameIndex(0);
    });
  }

  function selectCategory(kind) {
    if (phase !== 'open' || turning) return;
    const entries = provider.getEntitiesByKind(kind);
    if (!entries.length) return;
    const originSurface = !archiveEntityId && (surface === 'journal' || surface === 'journal-index') ? surface : 'contents';
    setCategoryOriginSurface(originSurface);
    setCategoryOriginBookmark(originSurface === 'journal' && frame ? createJournalBookmark(frame) : null);
    animateTurn('forward', () => {
      setArchiveKind(kind);
      setArchiveEntityId(null);
      setArchiveFrameIndex(0);
      setArchiveIndexPage(0);
      setSurface('archive-index');
    });
  }

  function moveJournalIndexPage(delta) {
    if (turning || surface !== 'journal-index') return;
    if (delta < 0 && resolvedJournalIndexPage === 0) {
      returnToContents();
      return;
    }
    if (delta > 0 && resolvedJournalIndexPage === journalIndexPageTotal - 1) {
      openJournalSection(journalIndexSlice.items[0]?.sectionId);
      return;
    }
    animateTurn(delta > 0 ? 'forward' : 'backward', () => {
      setJournalIndexPage((current) => Math.min(Math.max(current + delta, 0), journalIndexPageTotal - 1));
    });
  }

  function moveArchiveIndexPage(delta) {
    if (turning || surface !== 'archive-index' || archiveEntityId) return;
    if (delta < 0 && resolvedArchiveIndexPage === 0) {
      returnFromCategoryIndex();
      return;
    }
    if (delta > 0 && resolvedArchiveIndexPage === archiveIndexPageTotal - 1) {
      openCategoryEntry(archiveIndexSlice.items[0]?.entityId);
      return;
    }
    animateTurn(delta > 0 ? 'forward' : 'backward', () => {
      setArchiveIndexPage((current) => Math.min(Math.max(current + delta, 0), archiveIndexPageTotal - 1));
    });
  }

  function openCategoryEntry(entityId) {
    if (surface !== 'archive-index' || turning || !archiveKind) return;
    setReturnBookmark(null);
    setReturnSurface('archive-index');
    setReturnKind(archiveKind);
    animateTurn('forward', () => {
      setArchiveEntityId(entityId);
      setArchiveFrameIndex(0);
    });
  }

  function openRelatedEntity(entityId) {
    if (turning) return;
    animateTurn('forward', () => {
      setArchiveKind(null);
      setArchiveEntityId(entityId);
      setArchiveFrameIndex(0);
    });
  }

  function returnToContents() {
    if (turning) return;
    animateTurn('backward', () => {
      setArchiveEntityId(null);
      setArchiveKind(null);
      setArchiveFrameIndex(0);
      setJournalIndexPage(0);
      setArchiveIndexPage(0);
      setSurface('contents');
    });
  }

  function returnFromCategoryIndex() {
    if (turning) return;
    const targetSurface = categoryOriginSurface;
    const bookmark = categoryOriginBookmark;
    animateTurn('backward', () => {
      setArchiveEntityId(null);
      setArchiveKind(null);
      setArchiveFrameIndex(0);
      setArchiveIndexPage(0);
      setSurface(targetSurface === 'journal' || targetSurface === 'journal-index' ? targetSurface : 'contents');
      if (targetSurface === 'journal' && bookmark) setJournalLocation(bookmark);
    });
  }

  function returnFromArchive() {
    if (turning) return;
    const bookmark = returnBookmark;
    const targetSurface = returnSurface;
    const targetKind = returnKind;
    animateTurn('backward', () => {
      setArchiveEntityId(null);
      setArchiveFrameIndex(0);
      if (targetSurface === 'archive-index') {
        setArchiveKind(targetKind);
        setSurface('archive-index');
        return;
      }
      setArchiveKind(null);
      setSurface(targetSurface === 'contents' ? 'contents' : 'journal');
      if (targetSurface !== 'contents' && bookmark) setJournalLocation(bookmark);
    });
  }

  function renderArchivePage(page) {
    if (!page || page.kind === 'blank') return <div className="archive-blank-page" aria-hidden="true" />;
    if (page.kind === 'profile') return <ArchiveCard entity={page.entity} provider={provider} showDetails={false} />;
    return <ArchiveNotesPage page={page} provider={provider} onRelated={openRelatedEntity} />;
  }

  const bookOpen = phase === 'open';
  const returningToContents = returnSurface === 'contents';
  const returningToArchiveIndex = returnSurface === 'archive-index';
  const returnText = returningToContents ? 'İÇİNDEKİLER' : returningToArchiveIndex ? 'LİSTEYE DÖN' : 'GÜNLÜĞE DÖN';
  const returnTitle = returningToContents ? 'İçindekilere dön' : returningToArchiveIndex ? `${CATEGORY_LABELS[returnKind] ?? 'Kategori'} listesine dön` : 'Günlükte kaldığım yere dön';
  const closedJournalUrl = `${import.meta.env.BASE_URL}scene/closed-journal-v2.png`;
  const stageStyle = layout ? {
    '--left-page-left': `${layout.leftPage.left}px`, '--left-page-top': `${layout.leftPage.top}px`, '--left-page-width': `${layout.leftPage.width}px`, '--left-page-height': `${layout.leftPage.height}px`, '--left-page-transform': quadTransform(layout.leftPage),
    '--right-page-left': `${layout.rightPage.left}px`, '--right-page-top': `${layout.rightPage.top}px`, '--right-page-width': `${layout.rightPage.width}px`, '--right-page-height': `${layout.rightPage.height}px`, '--right-page-transform': quadTransform(layout.rightPage),
    '--page-marker-back-x': `${layout.markers.back.x}px`, '--page-marker-back-y': `${layout.markers.back.y}px`, '--page-marker-forward-x': `${layout.markers.forward.x}px`, '--page-marker-forward-y': `${layout.markers.forward.y}px`,
    '--category-anchor-x': `${layout.category.x}px`, '--category-anchor-y': `${layout.category.y}px`, '--journal-ribbon-x': `${layout.rightPage.right + 38}px`, '--journal-ribbon-y': `${layout.rightPage.bottom - 48}px`,
    '--clasp-left': `${layout.clasp.left - 8}px`, '--clasp-top': `${layout.clasp.top - 8}px`, '--clasp-width': `${Math.max(60, layout.clasp.width + 16)}px`, '--clasp-height': `${Math.max(126, layout.clasp.height + 16)}px`,
  } : undefined;

  return (
    <div className={`babylon-book-stage journal-book-stage phase-${phase} mode-${mode}${turning ? ' is-turning' : ''}`} style={stageStyle}>
      <BabylonBookViewport onReady={handleReady} onLayout={handleLayout} mode={mode} />
      {phase !== 'open' ? (
        <button className="babylon-open-book" type="button" onClick={openBook} disabled={phase !== 'closed'} aria-label="Channel Foundry defterini aç" title="Defteri aç">
          <img src={closedJournalUrl} alt="" draggable="false" />
        </button>
      ) : null}
      {contentVisible ? (
        <div
          className={`babylon-book-content${contentEntering ? ' is-content-entering' : ''}`}
          ref={contentRef}
          aria-live="polite"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.animationName === 'babylonContentReveal') setContentEntering(false);
          }}
        >
          {archiveEntityId ? (
            mode === 'desktop' ? (
              <div className="spread babylon-spread">
                <Page key={`archive-left-${archiveEntityId}-${resolvedArchiveFrameIndex}`} side="left" scrollable frameKind={archiveFrame?.left?.entity?.kind}>{renderArchivePage(archiveFrame?.left)}</Page>
                <Page key={`archive-right-${archiveEntityId}-${resolvedArchiveFrameIndex}`} side="right" scrollable frameKind={archiveFrame?.right?.entity?.kind}>{renderArchivePage(archiveFrame?.right)}</Page>
              </div>
            ) : <Page key={`archive-${archiveEntityId}-${resolvedArchiveFrameIndex}`} scrollable frameKind={archiveFrame?.page?.entity?.kind}>{renderArchivePage(archiveFrame?.page)}</Page>
          ) : surface === 'contents' ? (
            mode === 'desktop' ? (
              <div className="spread babylon-spread book-contents-spread">
                <Page side="left"><BookContents sections={sections} provider={provider} onOpenJournal={openJournalFromContents} onOpenCategory={selectCategory} part="intro" /></Page>
                <Page side="right"><BookContents sections={sections} provider={provider} onOpenJournal={openJournalFromContents} onOpenCategory={selectCategory} part="list" /></Page>
              </div>
            ) : <Page><BookContents sections={sections} provider={provider} onOpenJournal={openJournalFromContents} onOpenCategory={selectCategory} /></Page>
          ) : surface === 'journal-index' ? (
            mode === 'desktop' ? (
              <div className="spread babylon-spread book-section-index-spread">
                <Page side="left" frameKind="story"><BookSectionIndex type="journal" sections={journalIndexSlice.items} totalCount={sections.length} startIndex={journalIndexSlice.startIndex} pageNumber={resolvedJournalIndexPage + 1} pageTotal={journalIndexPageTotal} onOpenSection={openJournalSection} part="intro" /></Page>
                <Page side="right" frameKind="story"><BookSectionIndex type="journal" sections={journalIndexSlice.items} totalCount={sections.length} startIndex={journalIndexSlice.startIndex} pageNumber={resolvedJournalIndexPage + 1} pageTotal={journalIndexPageTotal} onOpenSection={openJournalSection} part="list" /></Page>
              </div>
            ) : <Page scrollable frameKind="story"><BookSectionIndex type="journal" sections={journalIndexSlice.items} totalCount={sections.length} startIndex={journalIndexSlice.startIndex} pageNumber={resolvedJournalIndexPage + 1} pageTotal={journalIndexPageTotal} onOpenSection={openJournalSection} /></Page>
          ) : surface === 'archive-index' ? (
            mode === 'desktop' ? (
              <div className="spread babylon-spread book-section-index-spread">
                <Page side="left" frameKind={archiveKind}><BookSectionIndex type="archive" kind={archiveKind} entities={archiveIndexSlice.items} totalCount={archiveEntities.length} startIndex={archiveIndexSlice.startIndex} pageNumber={resolvedArchiveIndexPage + 1} pageTotal={archiveIndexPageTotal} onOpenEntity={openCategoryEntry} part="intro" /></Page>
                <Page side="right" frameKind={archiveKind}><BookSectionIndex type="archive" kind={archiveKind} entities={archiveIndexSlice.items} totalCount={archiveEntities.length} startIndex={archiveIndexSlice.startIndex} pageNumber={resolvedArchiveIndexPage + 1} pageTotal={archiveIndexPageTotal} onOpenEntity={openCategoryEntry} part="list" /></Page>
              </div>
            ) : <Page scrollable frameKind={archiveKind}><BookSectionIndex type="archive" kind={archiveKind} entities={archiveIndexSlice.items} totalCount={archiveEntities.length} startIndex={archiveIndexSlice.startIndex} pageNumber={resolvedArchiveIndexPage + 1} pageTotal={archiveIndexPageTotal} onOpenEntity={openCategoryEntry} /></Page>
          ) : mode === 'desktop' ? (
            <div className="spread babylon-spread">
              <Page side="left" paginated scrollable={paginationScale <= 0.42} frameKind="story">{frame ? <><header className="journal-date"><small>KAYIT {String(frame.order).padStart(2, '0')}</small><h1>{frame.title}</h1></header><ContentBlocks blocks={frame.leftBlocks} provider={provider} onReferenceOpen={openArchive} /><span className="folio">{journalIndex * 2 + 1}</span></> : <div className="journal-empty"><small>ARAŞTIRMA GÜNLÜĞÜ</small><h1>Henüz kayıt yok</h1><p>Studio’da onaylanan günlük kayıtları bu sayfalarda görünecek.</p></div>}</Page>
              <Page side="right" paginated scrollable={paginationScale <= 0.42} frameKind="story">{frame ? <><ContentBlocks blocks={frame.rightBlocks} provider={provider} onReferenceOpen={openArchive} /><span className="folio">{journalIndex * 2 + 2}</span></> : null}</Page>
            </div>
          ) : <Page paginated scrollable={paginationScale <= 0.42} frameKind="story">{frame ? <><header className="journal-date"><small>KAYIT {String(frame.order).padStart(2, '0')}</small><h1>{frame.title}</h1></header><ContentBlocks blocks={frame.pageBlocks} provider={provider} onReferenceOpen={openArchive} /></> : <div className="journal-empty"><small>ARAŞTIRMA GÜNLÜĞÜ</small><h1>Henüz kayıt yok</h1></div>}</Page>}
          <CategoryBookmarks onSelect={selectCategory} />
        </div>
      ) : null}
      {bookOpen && !archiveEntityId && surface === 'contents' ? <PageTurnMarkers canGoBack={false} canGoForward={sections.length > 0} turning={turning} onForward={openJournalFromContents} ariaLabel="İçindekiler" forwardLabel="Ana Hikâye içindekilerine geç" /> : null}
      {bookOpen && !archiveEntityId && surface === 'journal-index' ? <PageTurnMarkers canGoBack canGoForward={sections.length > 0} turning={turning} onBack={() => moveJournalIndexPage(-1)} onForward={() => moveJournalIndexPage(1)} ariaLabel="Ana Hikâye içindekileri" backLabel={resolvedJournalIndexPage > 0 ? 'Önceki bölüm listesine dön' : 'Ana içindekilere dön'} forwardLabel={resolvedJournalIndexPage < journalIndexPageTotal - 1 ? 'Sonraki bölüm listesine geç' : 'Bu listedeki ilk hikâye bölümünü aç'} /> : null}
      {bookOpen && !archiveEntityId && surface === 'journal' ? <PageTurnMarkers canGoBack={frames.length > 0} canGoForward={journalIndex < frames.length - 1} turning={turning} onBack={() => move(-1)} onForward={() => move(1)} backLabel={journalIndex === 0 ? 'Ana Hikâye içindekilerine dön' : 'Önceki günlük sayfasına dön'} forwardLabel="Sonraki günlük sayfasına geç" /> : null}
      {bookOpen && !archiveEntityId && surface === 'archive-index' ? <PageTurnMarkers canGoBack canGoForward={archiveEntities.length > 0} turning={turning} onBack={() => moveArchiveIndexPage(-1)} onForward={() => moveArchiveIndexPage(1)} ariaLabel={`${CATEGORY_LABELS[archiveKind] ?? 'Kategori'} içindekileri`} backLabel={resolvedArchiveIndexPage > 0 ? 'Önceki kayıt listesine dön' : 'Önceki bölüme dön'} forwardLabel={resolvedArchiveIndexPage < archiveIndexPageTotal - 1 ? 'Sonraki kayıt listesine geç' : 'Bu listedeki ilk kategori kaydını aç'} /> : null}
      {bookOpen && archiveEntityId && archiveKind ? <PageTurnMarkers canGoBack={resolvedArchiveFrameIndex > 0 || archiveIndex >= 0} canGoForward={resolvedArchiveFrameIndex < archiveFrames.length - 1 || (archiveIndex >= 0 && archiveIndex < archiveEntities.length - 1)} turning={turning} onBack={() => moveArchive(-1)} onForward={() => moveArchive(1)} ariaLabel="Arşiv kategori sayfaları" backLabel={resolvedArchiveFrameIndex > 0 ? 'Önceki dosya sayfasına dön' : archiveIndex === 0 ? `${CATEGORY_LABELS[archiveKind] ?? 'Kategori'} içindekilerine dön` : 'Önceki kategori kaydına dön'} forwardLabel={resolvedArchiveFrameIndex < archiveFrames.length - 1 ? 'Dosyanın sonraki sayfasına geç' : 'Sonraki kategori kaydına geç'} /> : null}
      {bookOpen && archiveEntityId && !archiveKind && archiveFrames.length > 1 ? <PageTurnMarkers canGoBack={resolvedArchiveFrameIndex > 0} canGoForward={resolvedArchiveFrameIndex < archiveFrames.length - 1} turning={turning} onBack={() => moveArchive(-1)} onForward={() => moveArchive(1)} ariaLabel="Araştırma dosyası sayfaları" backLabel="Önceki dosya sayfasına dön" forwardLabel="Dosyanın sonraki sayfasına geç" /> : null}
      {bookOpen && archiveEntityId ? <button type="button" className={`journal-return-bookmark${returningToContents ? ' is-contents-return' : ''}${returningToArchiveIndex ? ' is-list-return' : ''}`} onClick={returnFromArchive} disabled={turning} aria-label={returnTitle} title={returnTitle}><span className="journal-return-mark" aria-hidden="true">↶</span><b>{returnText}</b></button> : null}
      {bookOpen ? <button type="button" className="babylon-clasp-action" onClick={closeBook} disabled={turning} aria-label="Kitabı kapat"><span className="book-clasp-emblem" aria-hidden="true" /></button> : null}
    </div>
  );
}
