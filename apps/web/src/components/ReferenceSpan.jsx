import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveHoverCardPosition } from './hover-card-position.js';

const kindLabels = { character: 'Kişi kaydı', location: 'Mekân kaydı', object: 'Obje kaydı', event: 'Olay kaydı', story: 'Anlatı kaydı' };
const kindMarks = { character: 'K', location: 'M', object: 'O', event: 'V', story: 'H' };

export function ReferenceSpan({ span, provider, onOpen }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  const tooltipId = useId();
  const card = provider.getEntityCard(span.entityId);

  useLayoutEffect(() => {
    if (!visible || !cardRef.current || !triggerRef.current) return undefined;
    let animationFrame = 0;

    const placeCard = () => {
      animationFrame = 0;
      const anchorRect = triggerRef.current?.getBoundingClientRect();
      const previewRect = cardRef.current?.getBoundingClientRect();
      if (!anchorRect || !previewRect) return;
      const visualViewport = window.visualViewport;
      const nextPosition = resolveHoverCardPosition(anchorRect, previewRect, {
        left: visualViewport?.offsetLeft ?? 0,
        top: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      });
      setPosition((current) => (
        current?.left === nextPosition.left
        && current?.top === nextPosition.top
        && current?.placement === nextPosition.placement
          ? current
          : nextPosition
      ));
    };
    const schedulePlacement = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(placeCard);
    };

    placeCard();
    window.addEventListener('resize', schedulePlacement);
    window.addEventListener('scroll', schedulePlacement, true);
    window.visualViewport?.addEventListener('resize', schedulePlacement);
    window.visualViewport?.addEventListener('scroll', schedulePlacement);
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', schedulePlacement);
      window.removeEventListener('scroll', schedulePlacement, true);
      window.visualViewport?.removeEventListener('resize', schedulePlacement);
      window.visualViewport?.removeEventListener('scroll', schedulePlacement);
    };
  }, [span.entityId, visible]);

  const showCard = () => {
    if (!visible) setPosition(null);
    setVisible(true);
  };
  const hideCard = () => setVisible(false);
  const hasImage = Boolean(card?.asset?.url);
  const portal = visible && card && typeof document !== 'undefined' ? createPortal(
    <span
      ref={cardRef}
      id={tooltipId}
      className={`hover-card kind-${card.kind} ${hasImage ? 'has-image' : 'is-text-only'}${position ? ' is-positioned' : ''}`}
      data-placement={position?.placement}
      role="tooltip"
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined}
    >
      {hasImage ? <span className="hover-card-image-mount"><img src={card.asset.url} alt="" /></span> : null}
      <span className="hover-card-copy">
        <span className="hover-card-eyebrow">
          <small>ARŞİV NOTU · {kindLabels[card.kind] ?? card.kind}</small>
          <i aria-hidden="true">{kindMarks[card.kind] ?? 'A'}</i>
        </span>
        <strong>{card.name}</strong>
        <span className="hover-card-summary">{card.summary}</span>
        <b>Kayıt sayfasını aç →</b>
      </span>
    </span>,
    document.body,
  ) : null;

  return (
    <span className="reference-wrap" onMouseEnter={showCard} onMouseLeave={hideCard}>
      <button ref={triggerRef} className="inline-reference" type="button" onClick={onOpen} onFocus={showCard} onBlur={hideCard} aria-describedby={visible && card ? tooltipId : undefined}>{span.label}</button>
      {portal}
    </span>
  );
}
