export type ContentKind =
  | "video"
  | "character"
  | "event"
  | "timeline"
  | "relation"
  | "file"
  | "forum";

export type ContentStatus = "draft" | "published";

export interface ContentRef {
  id: string;
  kind: ContentKind;
  title: string;
}

export interface PublicVisualProfile {
  description: string;
  attributes: string[];
  atmosphere: string;
  imageUrl?: string;
}

export interface VideoSource {
  provider: "youtube";
  videoId: string;
  url: string;
  channel: string;
  thumbnailUrl: string;
}

export interface VideoRecord {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  status: ContentStatus;
  related: ContentRef[];
  source?: VideoSource;
  visual?: PublicVisualProfile;
}

export interface CharacterRecord {
  id: string;
  name: string;
  role: string;
  summary: string;
  status: ContentStatus;
  related: ContentRef[];
  visual?: PublicVisualProfile;
}

export interface EventRecord {
  id: string;
  title: string;
  dateLabel: string;
  summary: string;
  status: ContentStatus;
  related: ContentRef[];
  visual?: PublicVisualProfile;
}

export interface RelationRecord {
  id: string;
  from: ContentRef;
  to: ContentRef;
  label: string;
  note?: string;
}

export interface FileRecord {
  id: string;
  title: string;
  description: string;
  status: ContentStatus;
  related: ContentRef[];
  context?: string;
  visual?: PublicVisualProfile;
}

export type EditorialUniverseKind = "story" | "character" | "event" | "location" | "object";

export interface EditorialUniverseDetail {
  text: string;
  sourceVideoIds: string[];
}

export interface EditorialUniverseNode {
  id: string;
  kind: EditorialUniverseKind;
  name: string;
  aliases: string[];
  summary: string;
  sourceVideoIds: string[];
  status: "published";
  visual?: PublicVisualProfile;
  roles?: string[];
  storyNames?: string[];
  characterNames?: string[];
  locationNames?: string[];
  objectNames?: string[];
  sequence?: EditorialUniverseDetail[];
  details?: EditorialUniverseDetail[];
}

export interface EditorialUniverseRelation {
  id: string;
  fromId: string;
  fromKind: EditorialUniverseKind;
  fromName: string;
  toId: string;
  toKind: EditorialUniverseKind;
  toName: string;
  label: string;
  sourceVideoIds: string[];
}

export interface PublicEditorialUniverse {
  nodes: EditorialUniverseNode[];
  relations: EditorialUniverseRelation[];
  counts: {
    nodes: number;
    relations: number;
    stories: number;
    characters: number;
    events: number;
    locations: number;
    objects: number;
  };
}

export interface PublicSupportRecord {
  id: string;
  name: string;
  videoId: string;
  videoTitle: string;
  videoPublishedAt: string;
  videoUrl: string;
}

export interface PublicSupportArchive {
  notebook: PublicSupportRecord[];
  contributors: PublicSupportRecord[];
  counts: {
    notebook: number;
    contributors: number;
  };
}

export interface UniverseFixture {
  videos: VideoRecord[];
  characters: CharacterRecord[];
  events: EventRecord[];
  relations: RelationRecord[];
  files: FileRecord[];
  editorial?: PublicEditorialUniverse;
  support?: PublicSupportArchive;
}

export interface PublicUniverseSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  counts: {
    items: number;
    relations: number;
  };
  universe: UniverseFixture;
}

// Runtime başlangıç verisi bilinçli olarak boştur.
// Gerçek içerik yalnız Studio SQLite -> public snapshot hattından gelir.
// Bu nesne web runtime tarafından yerinde güncellendiği için const olarak korunur.
export const fixtureUniverse: UniverseFixture = {
  videos: [],
  characters: [],
  events: [],
  relations: [],
  files: [],
};
