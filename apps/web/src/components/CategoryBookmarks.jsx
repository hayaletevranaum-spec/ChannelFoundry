import React from 'react';

const bookmarks = [
  { kind: 'character', label: 'Kişiler', glyph: 'K' },
  { kind: 'location', label: 'Mekânlar', glyph: 'M' },
  { kind: 'object', label: 'Objeler', glyph: 'O' },
];

export function CategoryBookmarks({ onSelect }) {
  return (
    <nav className="category-bookmarks" aria-label="Arşiv ayraçları">
      {bookmarks.map((bookmark) => (
        <button className={`bookmark bookmark-${bookmark.kind}`} type="button" key={bookmark.kind} onClick={() => onSelect(bookmark.kind)} title={bookmark.label}>
          <span aria-hidden="true">{bookmark.glyph}</span><b>{bookmark.label}</b>
        </button>
      ))}
    </nav>
  );
}
