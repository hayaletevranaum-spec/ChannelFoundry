import React, { useEffect, useRef } from 'react';
import { createBookEngine } from './createBookEngine.js';

export function BabylonBookViewport({ onReady, onLayout, mode = 'desktop', bookVariant = 'journal' }) {
  const canvasRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const api = createBookEngine(canvas, { presentationMode: mode, bookVariant, onLayout });
    let disposed = false;
    let settleFrame = 0;
    const renderScene = () => {
      if (!disposed) api.scene.render();
    };
    const settleScene = (frameCount, resize = false) => {
      cancelAnimationFrame(settleFrame);
      let remainingFrames = frameCount;
      const renderSettledFrame = () => {
        if (disposed) return;
        if (resize) api.engine.resize();
        renderScene();
        remainingFrames -= 1;
        if (remainingFrames > 0) settleFrame = requestAnimationFrame(renderSettledFrame);
      };
      settleFrame = requestAnimationFrame(renderSettledFrame);
    };

    api.engine.stopRenderLoop();
    renderScene();
    settleScene(5, true);

    const runAnimated = async (operation) => {
      cancelAnimationFrame(settleFrame);
      renderScene();
      api.engine.runRenderLoop(renderScene);
      try {
        return await operation();
      } finally {
        api.engine.stopRenderLoop(renderScene);
        renderScene();
        // React commits the midpoint/final page state immediately around the
        // animation promise. Repaint a few post-commit frames so an unpreserved
        // WebGL buffer can never be composited as a transparent book.
        settleScene(3);
      }
    };

    const optimizedApi = {
      ...api,
      open: (...args) => runAnimated(() => api.open(...args)),
      close: (...args) => runAnimated(() => api.close(...args)),
      turnPage: (...args) => runAnimated(() => api.turnPage(...args)),
      setPresentationMode(nextMode) {
        api.setPresentationMode(nextMode);
        renderScene();
      },
      resize() {
        api.resize();
        renderScene();
      },
      dispose() {
        disposed = true;
        cancelAnimationFrame(settleFrame);
        api.engine.stopRenderLoop(renderScene);
        api.dispose();
      },
    };

    apiRef.current = optimizedApi;
    onReady?.(optimizedApi);
    return () => {
      onReady?.(null);
      apiRef.current = null;
      optimizedApi.dispose();
    };
  }, [bookVariant, onLayout, onReady]);

  useEffect(() => { apiRef.current?.setPresentationMode(mode); }, [mode]);

  return <canvas ref={canvasRef} className="babylon-book-canvas" aria-hidden="true" />;
}
