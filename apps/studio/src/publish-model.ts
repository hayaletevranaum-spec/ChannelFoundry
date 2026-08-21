export type ItemKind = "video" | "character" | "event" | "file";
export type PublishKind = ItemKind | StudioUniverseWorkspaceNode["kind"];
export type ItemStatus = "published" | "draft";

export type PublishItem = {
  key: string;
  id: string;
  kind: ItemKind;
  title: string;
  meta: string;
  summary: string;
  status: ItemStatus;
  relatedCount: number;
};

export type PublishRelation = {
  id: string;
  fromKey: string;
  toKey: string;
  label: string;
};

export type ThemePublicationReadiness = {
  narrativeSections: number;
  narrativeChangesPending: boolean;
  visualComplete: boolean;
  readyForTheme: boolean;
};

export type PublicationInfo = {
  generatedAt: string;
  file: string;
  publicationId: string;
  contentFingerprint: string;
  sectionCount: number;
  entityCount: number;
  relationCount: number;
  assetCount: number;
  itemCount?: number;
};

export type ThemePublicationExport = PublicationInfo & {
  assetsDirectory: string;
  readiness: ThemePublicationReadiness;
};

export type LivePublicationInfo = {
  generatedAt: string;
  publicationId: string;
  contentFingerprint: string;
  sectionCount: number;
  entityCount: number;
  relationCount: number;
  assetCount: number;
  bytes: number;
  sha256: string;
  verified: boolean;
  publicUrl: string;
};

export type PublicationPreview = {
  baselineAvailable: boolean;
  generatedAt: string;
  publicationId: string;
  contentFingerprint: string;
  changed: boolean;
  counts: { sections: number; entities: number; relations: number; assets: number };
  readiness: ThemePublicationReadiness;
  baseline: null | {
    source: "live";
    file: string;
    generatedAt: string;
    publicationId: string;
    contentFingerprint: string;
  };
};

export const kindLabels: Record<PublishKind, string> = {
  video: "Kayıt",
  story: "Hikâye",
  character: "Karakter",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
  file: "Dosya",
};

export const kindShort: Record<PublishKind, string> = {
  video: "KY",
  story: "HK",
  character: "KR",
  event: "OL",
  location: "MK",
  object: "NS",
  file: "DS",
};

export const kindOrder: PublishKind[] = ["video", "story", "character", "event", "location", "object", "file"];

export function formatExportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function publishErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
