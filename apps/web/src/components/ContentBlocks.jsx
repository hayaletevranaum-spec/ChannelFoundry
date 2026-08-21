import React from 'react';
import { ReferenceSpan } from './ReferenceSpan.jsx';

export function ContentBlocks({ blocks, provider, onReferenceOpen }) {
  return (blocks ?? []).map((block, index) => {
    if (block.type === 'paragraph') {
      return <p className="journal-paragraph" key={`p-${index}`}>{(block.spans ?? []).map((span, spanIndex) => {
        if (span.type === 'reference') return <ReferenceSpan key={`${span.entityId}-${spanIndex}`} span={span} provider={provider} onOpen={() => onReferenceOpen(span.entityId)} />;
        if (span.type === 'emphasis') return <em key={`e-${spanIndex}`}>{span.text}</em>;
        return <React.Fragment key={`t-${spanIndex}`}>{span.text}</React.Fragment>;
      })}</p>;
    }
    if (block.type === 'heading') return <h2 className="journal-heading" key={`h-${index}`}>{block.text}</h2>;
    if (block.type === 'figure') {
      const asset = provider.getAsset(block.assetId);
      return <figure className={`journal-figure role-${block.role ?? asset?.role ?? 'supporting'}`} key={`f-${block.assetId}-${index}`}>{asset?.url ? <img src={asset.url} alt={block.alt || asset.alt || ''} /> : <div className="missing-asset">Görsel hazırlanıyor</div>}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    }
    return null;
  });
}
