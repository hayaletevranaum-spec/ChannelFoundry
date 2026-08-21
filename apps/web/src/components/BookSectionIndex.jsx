import React from 'react';

const CATEGORY_META = Object.freeze({
  character: { label: 'Kişiler', kicker: 'ARAŞTIRMA ARŞİVİ', glyph: 'K', description: 'Evren içinde adı geçen kişilerin dosya başlıkları.' },
  location: { label: 'Mekânlar', kicker: 'ARAŞTIRMA ARŞİVİ', glyph: 'M', description: 'Araştırmalarda geçen mekânların dosya başlıkları.' },
  object: { label: 'Objeler', kicker: 'ARAŞTIRMA ARŞİVİ', glyph: 'O', description: 'İz bırakan nesne ve emanetlerin dosya başlıkları.' },
});

function indexLabel(index) {
  return String(index + 1).padStart(2, '0');
}

export function BookSectionIndex({
  type = 'journal',
  kind = null,
  sections = [],
  entities = [],
  onOpenSection,
  onOpenEntity,
  part = 'full',
  startIndex = 0,
  totalCount = null,
  pageNumber = 1,
  pageTotal = 1,
}) {
  const journal = type === 'journal';
  const meta = journal
    ? { label: 'Ana Hikâye', kicker: 'ANA ANLATI', glyph: 'H', description: 'Ana hikâyedeki bölüm başlıkları kronolojik sırayla.' }
    : (CATEGORY_META[kind] ?? { label: 'Arşiv', kicker: 'ARAŞTIRMA ARŞİVİ', glyph: 'A', description: 'Arşiv kayıtları.' });
  const items = journal ? sections : entities;
  const publishedCount = Number.isFinite(totalCount) ? totalCount : items.length;
  const showIntro = part !== 'list';
  const showList = part !== 'intro';
  const dense = items.length > 6;

  return (
    <div className={`book-section-index book-section-index-${part}${dense ? ' is-dense' : ''}`}>
      {showIntro ? (
        <header className="book-section-index-intro">
          <small>{meta.kicker}</small>
          <span className="book-section-index-seal" aria-hidden="true">{meta.glyph}</span>
          <h1>{meta.label}</h1>
          <p>{meta.description}</p>
          <em>{publishedCount} {journal ? 'bölüm' : 'kayıt'}</em>
          {pageTotal > 1 ? <b className="book-section-index-page">SAYFA {pageNumber} / {pageTotal}</b> : null}
          <span aria-hidden="true" className="book-contents-rule" />
        </header>
      ) : null}

      {showList ? (
        <div className="book-section-index-list">
          {items.map((item, index) => {
            const absoluteIndex = startIndex + index;
            const key = journal ? item.sectionId : item.entityId;
            const title = journal ? item.title : item.name;
            const subtitle = journal
              ? `Bölüm ${indexLabel(absoluteIndex)}`
              : `Dosya ${indexLabel(absoluteIndex)}`;
            return (
              <button
                type="button"
                className="book-section-index-entry"
                key={key}
                onClick={() => journal ? onOpenSection?.(item.sectionId) : onOpenEntity?.(item.entityId)}
              >
                <span className="book-section-index-number" aria-hidden="true">{indexLabel(absoluteIndex)}</span>
                <span className="book-section-index-copy">
                  <small>{subtitle}</small>
                  <strong>{title}</strong>
                </span>
                <span className="book-section-index-arrow" aria-hidden="true">›</span>
              </button>
            );
          })}
          {!items.length ? <p className="book-section-index-empty">Bu bölümde henüz yayınlanmış kayıt yok.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
