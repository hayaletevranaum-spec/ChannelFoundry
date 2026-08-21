import React from 'react';

const CATEGORY_ROWS = Object.freeze([
  { kind: 'character', label: 'Kişiler', glyph: 'K' },
  { kind: 'location', label: 'Mekânlar', glyph: 'M' },
  { kind: 'object', label: 'Objeler', glyph: 'O' },
]);

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function BookContents({ sections, provider, onOpenJournal, onOpenCategory, part = 'full' }) {
  const journalCount = Array.isArray(sections) ? sections.length : 0;
  const categories = CATEGORY_ROWS.map((row) => ({
    ...row,
    count: provider.getEntitiesByKind(row.kind).length,
  }));

  const showIntro = part !== 'list';
  const showList = part !== 'intro';

  return (
    <div className={`book-contents book-contents-${part}`}>
      {showIntro ? (
        <header className="book-contents-intro">
          <small>BİRDESENGÖR EVRENİ</small>
          <h1>İçindekiler</h1>
          <p>Ana hikâyeyi kronolojik olarak oku veya araştırma arşivindeki bir kategoriye doğrudan geç.</p>
          <span aria-hidden="true" className="book-contents-rule" />
        </header>
      ) : null}

      {showList ? (
        <div className="book-contents-list">
          <button
            type="button"
            className="book-contents-entry book-contents-entry-story"
            onClick={onOpenJournal}
            disabled={!journalCount}
          >
            <span className="book-contents-glyph" aria-hidden="true">H</span>
            <span className="book-contents-copy">
              <small>ANA ANLATI</small>
              <strong>Ana Hikâye</strong>
              <em>{journalCount ? countLabel(journalCount, 'bölüm', 'bölüm') : 'Henüz bölüm yok'}</em>
            </span>
            <span className="book-contents-arrow" aria-hidden="true">›</span>
          </button>

          {categories.map((category) => (
            <button
              type="button"
              className={`book-contents-entry book-contents-entry-${category.kind}`}
              key={category.kind}
              onClick={() => onOpenCategory(category.kind)}
              disabled={!category.count}
            >
              <span className="book-contents-glyph" aria-hidden="true">{category.glyph}</span>
              <span className="book-contents-copy">
                <small>ARAŞTIRMA ARŞİVİ</small>
                <strong>{category.label}</strong>
                <em>{category.count ? countLabel(category.count, 'kayıt', 'kayıt') : 'Henüz kayıt yok'}</em>
              </span>
              <span className="book-contents-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
