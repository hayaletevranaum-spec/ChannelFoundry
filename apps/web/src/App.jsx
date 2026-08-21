import React, { useEffect, useState } from 'react';
import { loadContentProvider } from './content/index.js';
import { communityProvider } from './community/index.js';
import { DeskScene } from './components/DeskScene.jsx';

const CRITICAL_SCENE_ASSETS = [
  'scene/research-room-plate-unlit.png',
  'scene/closed-journal-v2.png',
  'scene/journal-cover-alchemy-v1.webp',
  'scene/community-cover-leather-v1.webp',
  'scene/handheld-camcorder-v2.png',
  'scene/closed-public.png',
];

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      decoded.catch(() => undefined).then(() => resolve(src));
    };
    image.onerror = () => reject(new Error(`Kritik sahne görseli yüklenemedi: ${src}`));
    image.src = src;
  });
}

export function App() {
  const [provider, setProvider] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [bootPhase, setBootPhase] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    setProvider(null);
    setError('');
    setBootPhase('loading');

    const assetUrls = CRITICAL_SCENE_ASSETS.map((asset) => `${import.meta.env.BASE_URL}${asset}`);
    Promise.all([
      loadContentProvider(),
      Promise.all(assetUrls.map(preloadImage)),
    ]).then(([nextProvider]) => {
      if (cancelled) return;
      setProvider(nextProvider);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setBootPhase('done');
        return;
      }

      // Keep the eyelids closed while the fully decoded scene mounts and paints.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (!cancelled) setBootPhase('revealing');
        });
      });
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setBootPhase('error');
    });

    return () => {
      cancelled = true;
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [attempt]);

  const bootVisible = bootPhase !== 'done';

  return <>
    {provider ? (
      <DeskScene
        provider={provider}
        communityProvider={communityProvider}
        atmosphereActive={bootPhase === 'done'}
      />
    ) : null}
    {bootVisible ? (
      <div
        className={`scene-boot-overlay scene-boot-${bootPhase}`}
        role={error ? 'alert' : 'presentation'}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && bootPhase === 'revealing' && event.animationName === 'sceneBootOverlayReveal') {
            setBootPhase('done');
          }
        }}
      >
        <span className="scene-boot-preview" aria-hidden="true" />
        <span className="scene-boot-eyelid scene-boot-eyelid-top" aria-hidden="true" />
        <span className="scene-boot-eyelid scene-boot-eyelid-bottom" aria-hidden="true" />
        {error ? (
          <section className="scene-boot-error">
            <small>BİRDESENGÖR EVRENİ</small>
            <h1>Sahne açılamadı</h1>
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>Yeniden dene</button>
          </section>
        ) : null}
      </div>
    ) : null}
  </>;
}
