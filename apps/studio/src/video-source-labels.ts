import { useEffect, useMemo, useState } from "react";

type VideoCatalogBridge = Pick<NonNullable<typeof window.channelFoundryStudio>, "youtubeCatalogVideos" | "onDataChanged">;

export type StudioVideoSourceInfo = {
  videoId: string;
  title: string;
  publishedAt: string;
};

export const videoSourceFallbackTitle = "Başlığı bulunamayan kaynak video";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function videoSourceTitle(videoId: string, catalog: Map<string, StudioVideoSourceInfo>) {
  return clean(catalog.get(videoId)?.title) || videoSourceFallbackTitle;
}

export function videoSourceTitles(videoIds: string[], catalog: Map<string, StudioVideoSourceInfo>) {
  return videoIds.map((videoId) => videoSourceTitle(videoId, catalog));
}

export function useVideoSourceCatalog() {
  const bridge = window.channelFoundryStudio as VideoCatalogBridge | undefined;
  const [videos, setVideos] = useState<StudioYoutubeCatalogVideo[]>([]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const load = async () => {
      const rows = await bridge.youtubeCatalogVideos({});
      if (active) setVideos(Array.isArray(rows) ? rows : []);
    };
    void load().catch(() => { if (active) setVideos([]); });
    const stop = bridge.onDataChanged?.(() => { void load().catch(() => undefined); });
    return () => { active = false; stop?.(); };
  }, []);

  return useMemo(() => new Map(videos.map((video) => [video.videoId, {
    videoId: video.videoId,
    title: clean(video.title) || videoSourceFallbackTitle,
    publishedAt: clean(video.publishedAt),
  }])), [videos]);
}
