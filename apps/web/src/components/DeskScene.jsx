import React from 'react';
import { BabylonBookShell } from '../3d/BabylonBookShell.jsx';
import { CommunityNotebook } from './CommunityNotebook.jsx';
import { YoutubeCameraArchive } from './YoutubeCameraArchive.jsx';

export function DeskScene({ provider, communityProvider, atmosphereActive = false }) {
  const roomPlateUrl = `${import.meta.env.BASE_URL}scene/research-room-plate-unlit.png`;
  const publicNotebookUrl = `${import.meta.env.BASE_URL}scene/closed-public.png`;
  const apparitionUrl = `${import.meta.env.BASE_URL}scene/metaphysical-apparition-v1.png`;

  function openCommunityNotebook() {
    document.querySelector('.community-notebook-launcher')?.click();
  }

  return (
    <main className="room-scene">
      <img
        className="research-room-plate"
        src={roomPlateUrl}
        alt="Araştırmacının çalışma odası"
        draggable="false"
      />
      <div className={`desk-atmosphere${atmosphereActive ? ' is-ritual-active' : ''}`} aria-hidden="true">
        <img className="desk-apparition" src={apparitionUrl} alt="" draggable="false" decoding="async" />
        <span className="desk-candle-glow" />
        <span className="desk-candle-flame"><i /></span>
        <span className="desk-incense-smoke">
          <i /><i /><i />
        </span>
      </div>
      <YoutubeCameraArchive />
      <button
        type="button"
        className="community-notebook-object"
        aria-label="Masa üzerindeki Topluluk Not Defteri'ni aç"
        title="Topluluk Not Defteri"
        onClick={openCommunityNotebook}
      >
        <img src={publicNotebookUrl} alt="" draggable="false" />
      </button>
      <CommunityNotebook provider={communityProvider} />
      <BabylonBookShell provider={provider} />
    </main>
  );
}
