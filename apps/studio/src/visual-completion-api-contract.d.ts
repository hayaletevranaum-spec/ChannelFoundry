type StudioVisualCompletionSceneState = "pending" | "ready" | "skipped";

type StudioVisualCompletionSeed = {
  description: string;
  attributes: string[];
  atmosphere: string;
  prompt: string;
  negativePrompt: string;
};

type StudioVisualProfileMetadata = Omit<StudioVisualProfile, "imageDataUrl">;

type StudioVisualCompletionScene = {
  sectionKey: string;
  revisionId: number;
  revisionNo: number;
  position: number;
  title: string;
  body: string;
  sourceKeys: string[];
  sourceVideoIds: string[];
  entityReferences: Array<{ entityId: string; kind: string; label: string }>;
  role: "scene";
  profileKey: string;
  assetId: string;
  state: StudioVisualCompletionSceneState;
  seed: StudioVisualCompletionSeed;
  profile: StudioVisualProfileMetadata | null;
};

type StudioVisualCompletionEntity = {
  entityId: string;
  kind: string;
  label: string;
  sectionKeys: string[];
  role: "scene" | "portrait" | "location" | "artifact" | "supporting";
  profileKey: string;
  assetId: string;
  seed: StudioVisualCompletionSeed;
  profile: StudioVisualProfileMetadata | null;
  hasImage: boolean;
};

type StudioVisualCompletionStatus = {
  sections: StudioVisualCompletionScene[];
  entities: StudioVisualCompletionEntity[];
  counts: {
    sections: number;
    sceneReady: number;
    sceneSkipped: number;
    scenePending: number;
    entities: number;
    entityReady: number;
    entityMissing: number;
  };
  complete: boolean;
};

type StudioVisualCompletionBridge = {
  visualCompletionStatus(): Promise<StudioVisualCompletionStatus>;
  visualCompletionSetSceneState(input: {
    sectionKey: string;
    revisionId: number;
    state: "pending" | "skipped";
  }): Promise<StudioVisualCompletionStatus>;
};
