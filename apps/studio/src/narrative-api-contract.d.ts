type StudioNarrativeRunState = "prepared" | "applied" | "stale" | "discarded";
type StudioNarrativeRevisionState = "draft" | "approved" | "published" | "superseded" | "discarded";

type StudioNarrativeSpan =
  | { type: "text" | "emphasis"; text: string }
  | { type: "reference"; entityId: string; label: string };

type StudioNarrativeBlock =
  | { type: "paragraph"; spans: StudioNarrativeSpan[] }
  | { type: "figure"; assetId: string; role: "scene" | "portrait" | "location" | "artifact" | "supporting"; entityId?: string; alt: string; caption: string };

type StudioNarrativeMedia = {
  assetId: string;
  role: "scene" | "portrait" | "location" | "artifact" | "supporting";
  entityId?: string;
  alt: string;
  caption: string;
};

type StudioNarrativeSectionRevision = {
  id: number;
  sectionKey: string;
  runId: number;
  revisionNo: number;
  position: number;
  title: string;
  body: string;
  blocks: StudioNarrativeBlock[];
  entityReferences: Array<{ entityId: string; kind: string; label: string }>;
  sourceKeys: string[];
  sourceVideoIds: string[];
  media: StudioNarrativeMedia[];
  retire: boolean;
  state: StudioNarrativeRevisionState;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
};

type StudioNarrativeRun = {
  id: number;
  state: StudioNarrativeRunState;
  baselineRunId: number | null;
  universeFingerprint: string;
  inputFingerprint: string;
  input: Record<string, unknown>;
  model: string;
  createdAt: string;
  appliedAt: string | null;
  discardedAt: string | null;
};

type StudioNarrativeSourceDescriptor = {
  sourceType: "node" | "relation";
  sourceKey: string;
  sourceVideoIds: string[];
  entityId?: string;
  kind?: string;
  name?: string;
  aliases?: string[];
  summary?: string;
  payload?: Record<string, unknown>;
  fromKey?: string;
  toKey?: string;
  label?: string;
};

type StudioNarrativeAiRequest = {
  contractVersion: number;
  run: { id: number; baselineRunId: number | null; inputFingerprint: string; universeFingerprint: string };
  rules: {
    language: string;
    factualOnly: boolean;
    preserveChronology: boolean;
    preservePublishedNarrativeMemory: boolean;
    inventionAllowed: boolean;
    physicalPaginationAllowed: boolean;
    referenceRule: string;
    revisionRule: string;
  };
  input: {
    baselineNarrative: StudioNarrativeSectionRevision[];
    changes: Array<Record<string, unknown>>;
    removed: Array<{ sourceType: string; sourceKey: string }>;
    contextSources: StudioNarrativeSourceDescriptor[];
    allowedSources: StudioNarrativeSourceDescriptor[];
    sourceVideos: Array<{ videoId: string; title: string; publishedAt: string | null }>;
  };
  responseContract: Record<string, unknown>;
};

type StudioNarrativeRunDetail = {
  run: StudioNarrativeRun;
  drafts: StudioNarrativeSectionRevision[];
  request: StudioNarrativeAiRequest | null;
};

type StudioNarrativeStatus = {
  latestAppliedRun: StudioNarrativeRun | null;
  workingRun: StudioNarrativeRunDetail | null;
  memory: StudioNarrativeSectionRevision[];
  counts: { prepared: number; stale: number; applied: number; discarded: number; sections: number; activeSections: number };
  next: { hasChanges: boolean; baselineRunId: number | null; changes: number; removed: number };
};

type StudioNarrativeGeneration = {
  provider: string;
  configuredModel: string;
  model: string;
  fallbackUsed: boolean;
  repaired: boolean;
  repairModel: string;
  repairFallbackUsed: boolean;
  debugFile: string;
};

type StudioNarrativeGeneratedDraft = StudioNarrativeRunDetail & { generation: StudioNarrativeGeneration };

type StudioNarrativeBridge = {
  narrativeStatus(): Promise<StudioNarrativeStatus>;
  narrativePrepare(input?: { model?: string }): Promise<StudioNarrativeRunDetail>;
  narrativeGetRun(runId: number): Promise<StudioNarrativeRunDetail | null>;
  narrativeBuildRequest(runId: number): Promise<StudioNarrativeAiRequest>;
  narrativeSaveDraftResponse(input: { runId: number; response: unknown }): Promise<{ run: StudioNarrativeRun; contractVersion: number; drafts: StudioNarrativeSectionRevision[] }>;
  narrativeGenerateDraft(input: { runId: number }): Promise<StudioNarrativeGeneratedDraft>;
  narrativeApply(runId: number): Promise<{ run: StudioNarrativeRun; memory: StudioNarrativeSectionRevision[]; status: StudioNarrativeStatus }>;
  narrativeDiscard(runId: number): Promise<{ run: StudioNarrativeRun; status: StudioNarrativeStatus }>;
};
