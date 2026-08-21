import React from 'react';

const kindMeta = {
  character: { label: 'KİŞİ DOSYASI', prefix: 'KŞ' },
  location: { label: 'MEKÂN KAYDI', prefix: 'MK' },
  object: { label: 'OBJE ENVANTERİ', prefix: 'OB' },
};

function EntityImage({ entity, provider }) {
  const asset = entity.visual?.assetId ? provider.getAsset(entity.visual.assetId) : null;
  return asset?.url ? (
    <span className="archive-photo-mount">
      <img src={asset.url} alt={asset.alt || entity.name} />
    </span>
  ) : <div className="missing-asset">Görsel hazırlanıyor</div>;
}

function Details({ entity, details = entity.details }) {
  return (
    <dl className="archive-details">
      {(details ?? []).map((detail, index) => (
        <div key={`${entity.entityId}-${detail.label ?? index}`}>
          <dt>{detail.label ?? `Not ${index + 1}`}</dt>
          <dd>{detail.value ?? detail.text ?? ''}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordHeader({ entity }) {
  const meta = kindMeta[entity.kind] ?? { label: 'ARAŞTIRMA KAYDI', prefix: 'AR' };
  const code = `${meta.prefix}-${String(entity.entityId).slice(-8).toUpperCase()}`;
  return <header className="archive-record-header"><span>{meta.label}</span><small>{code}</small></header>;
}

function RecordCard({ entity, provider, frameClass, details = entity.details, showDetails = true }) {
  return (
    <article className={`archive-card ${entity.kind}-card`}>
      <RecordHeader entity={entity} />
      <div className={frameClass}><EntityImage entity={entity} provider={provider} /></div>
      <h2>{entity.name}</h2>
      <p className="archive-summary">{entity.summary}</p>
      {showDetails && details?.length ? <Details entity={entity} details={details} /> : null}
      <footer className="archive-record-footer">BirDeSenGör Evreni · Araştırma Arşivi</footer>
    </article>
  );
}

export function CharacterCard(props) { return <RecordCard {...props} frameClass="portrait-frame" />; }
export function LocationCard(props) { return <RecordCard {...props} frameClass="location-frame" />; }
export function ObjectCard(props) { return <RecordCard {...props} frameClass="artifact-frame" />; }

export function ArchiveCard({ entity, provider, details, showDetails = true }) {
  if (!entity) return <div className="archive-empty">Kayıt bulunamadı.</div>;
  const props = { entity, provider, details, showDetails };
  if (entity.kind === 'character') return <CharacterCard {...props} />;
  if (entity.kind === 'location') return <LocationCard {...props} />;
  if (entity.kind === 'object') return <ObjectCard {...props} />;
  return <RecordCard {...props} frameClass="portrait-frame" />;
}

export function ArchiveNotesPage({ page, provider, onRelated }) {
  const entity = page?.entity;
  if (!entity) return null;
  const items = page.items ?? [];

  return (
    <article className="archive-notes-page">
      <header className="archive-record-header">
        <span>ARAŞTIRMA NOTLARI</span>
        <small>{page.recordPageNumber} / {page.recordPageTotal}</small>
      </header>
      <small className="archive-notes-eyebrow">DOSYA DEVAMI</small>
      <h2>{entity.name}</h2>
      <div className="archive-note-ledger">
        {items.map((item) => {
          if (item.type === 'detail') {
            return <div className="archive-note-row" key={item.key}><b>{item.label}</b><p>{item.text}</p></div>;
          }
          const relation = item.relation;
          const otherId = relation.fromEntityId === entity.entityId ? relation.toEntityId : relation.fromEntityId;
          const other = provider.getEntity(otherId);
          return (
            <button type="button" className="relation-link archive-note-relation" key={item.key} onClick={() => onRelated(otherId)}>
              <b>{relation.label}</b><span>{other?.name ?? otherId}</span>
            </button>
          );
        })}
        {!items.length ? <p className="archive-notes-empty">Bu dosyaya eklenmiş başka not veya bağlantı bulunmuyor.</p> : null}
      </div>
      <footer className="archive-record-footer">BirDeSenGör Evreni · Araştırma Arşivi</footer>
    </article>
  );
}
