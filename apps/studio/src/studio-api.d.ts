type StudioPersistedItem = {
  key: string;
  id: string;
  kind: "video" | "character" | "event" | "file";
  title: string;
  meta: string;
  summary: string;
  status: "published" | "draft";
};

type StudioPersistedRelation = {
  id: string;
  fromKey: string;
  toKey: string;
  label: string;
  note?: string | null;
  source: "base" | "local";
};

type StudioDatabaseState = { items: StudioPersistedItem[]; relations: StudioPersistedRelation[] };
type StudioDatabaseInfo = { engine: string; file: string; itemCount: number; relationCount: number };
type StudioBulkResult = { ok: true; action: "publish" | "draft" | "delete"; requested: number; affected: number; affectedRelations: number; missing: number };

type StudioYoutubePreview = { provider: "youtube"; videoId: string; url: string; title: string; channel: string; thumbnailUrl: string };
type StudioYoutubeImportResult = { imported: boolean; reason?: "already_exists"; item: StudioPersistedItem; source: Omit<StudioYoutubePreview, "title"> };
type StudioYoutubeChannel = { id: string; url: string; title: string; handle: string; lastSyncedAt: string | null; lastFullSyncedAt: string | null; videoCount: number };
type StudioYoutubeCatalogVideo = {
  videoId: string; channelId: string; title: string; publishedAt: string; durationSeconds: number | null; url: string; thumbnailUrl: string; thumbnailFile: string;
  availability: string; liveStatus: string; subtitleStatus: "manual" | "automatic" | "none" | "unknown" | "";
  subtitleLanguages: string[]; automaticCaptionLanguages: string[];
  contentKey: string | null; editorialStatus: "published" | "draft" | null; hasTranscript: boolean; thumbnailCached: boolean;
};
type StudioYoutubeCatalogStats = { total: number; imported: number; transcripts: number; pendingImport: number };
type StudioYoutubeSyncResult = {
  ok: true; mode: "recent" | "full"; tool: StudioTranscriptToolStatus; channel: StudioYoutubeChannel;
  newCount: number; updatedCount: number; removedCount: number; cachedCount: number; archivedThumbnailCount: number;
  detailStats: { requested: number; completed: number; unavailable: number; skipped: number };
} | { ok: false; canceled: true };
type StudioYoutubeSyncProgress = {
  phase: "preparing" | "catalog" | "scanning" | "thumbnails" | "saving" | "complete" | "canceling" | "canceled";
  processed: number; total: number; percent: number; currentTitle: string;
};

type StudioTranscript = { contentKey: string; videoId?: string; source: "youtube" | "manual"; language: string; text: string; updatedAt: string; characterCount: number; wordCount: number };
type StudioTranscriptToolStatus = { available: boolean; version: string; error?: string };
type StudioYtDlpStatus = {
  available: boolean;
  version: string;
  source: "managed" | "system" | "none";
  path: string;
  error: string;
  platform: string;
  supported: boolean;
  latestVersion: string;
  updateAvailable: boolean;
  autoCheck: boolean;
  autoUpdate: boolean;
  metadataLanguage: string;
  subtitleLanguages: string[];
  thumbnailSize: "small" | "standard" | "large";
  lastCheckedAt: string;
  lastUpdatedAt: string;
  lastError: string;
  phase: "idle" | "checking" | "downloading" | "installing" | "complete" | "error";
  message: string;
};

type StudioAiProvider = "ollama" | "openai-compatible" | "codex-cli";
type StudioAiImageMode = "auto" | "enabled" | "disabled";
type StudioAiImageProvider = "openai-compatible" | "cloudflare-workers-ai" | "codex-cli";
type StudioCodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type StudioCodexReasoningOption = { reasoningEffort: StudioCodexReasoningEffort; description: string };
type StudioAiModelCatalogEntry = {
  id: string;
  text: boolean;
  image: boolean;
  label: string;
  description?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: StudioCodexReasoningOption[];
  defaultReasoningEffort?: StudioCodexReasoningEffort | "";
};
type StudioGoogleQuickstart = { endpoint: string; model: string; apiKey: string };
type StudioAiModelCatalogRequest = {
  provider?: StudioAiProvider;
  endpoint?: string;
  apiKey?: string;
  timeoutSeconds?: number;
};
type StudioAiImageModelCatalogRequest = StudioAiModelCatalogRequest & {
  imageProvider?: StudioAiImageProvider;
  imageEndpoint?: string;
  imageApiKey?: string;
};
type StudioAiConfig = {
  provider: StudioAiProvider;
  endpoint: string;
  model: string;
  reasoningEffort: StudioCodexReasoningEffort | "";
  fallbackModel: string;
  configured: boolean;
  apiKeyConfigured: boolean;
  image: {
    mode: StudioAiImageMode;
    provider: StudioAiImageProvider;
    endpoint: string;
    model: string;
    configured: boolean;
    apiKeyConfigured: boolean;
  };
};
type StudioAiImageCapability = { supported: boolean; detected: boolean; mode: StudioAiImageMode; provider: StudioAiImageProvider; model: string; controllerModel?: string; reason: string };
type StudioAiCliStatus = {
  provider: "codex-cli";
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  version: string;
  command: string;
  detail: string;
};

type StudioAiRelationSuggestion = { key: string; label: string; reason: string };
type StudioAiSuggestion = { title: string; summary: string; relations: StudioAiRelationSuggestion[]; config: StudioAiConfig };

type StudioVisualDefinition = {
  description: string;
  attributes: string[];
  atmosphere: string;
  prompt: string;
  negativePrompt: string;
};
type StudioAiAnalysisCharacter = { name: string; aliases: string[]; role: string; details: string[]; visual: StudioVisualDefinition };
type StudioAiAnalysisNamedVisual = { name: string; details: string[]; visual: StudioVisualDefinition };
type StudioAiAnalysisScene = { name: string; description: string; visual: StudioVisualDefinition };
type StudioAiAnalysisResult = {
  videoId: string;
  model: string;
  title: string;
  summary: string;
  topics: string[];
  storyBeats: string[];
  storyHints: string[];
  coverVisual: StudioVisualDefinition;
  characters: StudioAiAnalysisCharacter[];
  locations: StudioAiAnalysisNamedVisual[];
  objects: StudioAiAnalysisNamedVisual[];
  scenes: StudioAiAnalysisScene[];
  updatedAt: string;
};
type StudioAiAnalysisVideo = {
  videoId: string; title: string; publishedAt: string; durationSeconds: number | null; thumbnailUrl: string; thumbnailFile: string; contentKey: string | null;
  hasTranscript: boolean; hasAnalysis: boolean; jobState: "" | "waiting" | "running" | "done" | "error"; jobError: string; attempts: number; analysisModel: string; analysisUpdatedAt: string;
};
type StudioAiAnalysisStats = { transcripts: number; analyzed: number; waiting: number; running: number; errors: number };
type StudioAiActivityState = "running" | "done" | "error" | "canceled";
type StudioAiActivityMessage = {
  role: "system" | "user" | "assistant" | "model";
  content: string;
  characters: number;
  truncated: boolean;
};
type StudioAiActivityEvent = {
  id: string;
  at: string;
  type: "status" | "request" | "response" | "error";
  tone?: "info" | "success" | "error";
  requestId?: string;
  label?: string;
  stage?: string;
  attempt?: "primary" | "fallback" | "repair";
  provider?: string;
  model?: string;
  messages?: StudioAiActivityMessage[];
  settings?: { temperature: number | null; maxTokens: number | null; json: boolean; reasoningEffort: StudioCodexReasoningEffort | "" };
  content?: string;
  characters?: number;
  truncated?: boolean;
  finishReason?: string;
  durationMs?: number;
  code?: string;
  message?: string;
};
type StudioAiActivitySession = {
  id: string;
  key: string;
  kind: "analysis" | "universe";
  title: string;
  subject: string;
  state: StudioAiActivityState;
  provider: string;
  configuredModel: string;
  model: string;
  fallbackUsed: boolean;
  stage: string;
  detail: string;
  requestCount: number;
  responseCount: number;
  errorCount: number;
  omittedEventCount: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  durationMs: number;
  context: Record<string, unknown>;
};
type StudioAiActivitySnapshot = {
  activeSessionId: string | null;
  activeModel: string;
  latestModel: string;
  sessions: StudioAiActivitySession[];
  selectedSession: (StudioAiActivitySession & { events: StudioAiActivityEvent[] }) | null;
};

type StudioUniverseDetail = { text: string; sourceVideoIds: string[] };
type StudioUniverseStory = {
  name: string; aliases: string[]; summary: string; sourceVideoIds: string[]; sequence: StudioUniverseDetail[];
  characterNames: string[]; locationNames: string[]; objectNames: string[]; visual: StudioVisualDefinition;
};
type StudioUniverseEntity = {
  name: string; aliases: string[]; summary: string; sourceVideoIds: string[]; storyNames: string[]; details: StudioUniverseDetail[]; visual: StudioVisualDefinition;
  roles?: string[];
};
type StudioUniverseEvent = {
  name: string; summary: string; sourceVideoIds: string[]; storyNames: string[]; characterNames: string[]; locationNames: string[]; visual: StudioVisualDefinition;
};
type StudioUniverseRelation = {
  fromType: "story" | "character" | "event" | "location" | "object"; fromName: string;
  toType: "story" | "character" | "event" | "location" | "object"; toName: string; label: string; sourceVideoIds: string[];
};
type StudioUniverse = {
  stories: StudioUniverseStory[];
  characters: StudioUniverseEntity[];
  events: StudioUniverseEvent[];
  locations: StudioUniverseEntity[];
  objects: StudioUniverseEntity[];
  relations: StudioUniverseRelation[];
};
type StudioUniverseMergeRun = {
  id: number; state: "waiting" | "running" | "done" | "error"; model: string; analysisCount: number; error: string;
  createdAt: string; updatedAt: string; finishedAt: string | null; totalChunks: number; doneChunks: number; errorChunks: number; level: number;
};
type StudioUniversePendingSource = { videoId: string; title: string; publishedAt: string };
type StudioUniverseIngestStatus = {
  pending: number; newSources: number; changedSources: number; eligible: number; processed: number; withdrawals: number;
  awaitingApplyRunId: number | null; batchLimit: number; nextSources: StudioUniversePendingSource[];
  backlog: { drafts: number; revisions: number; total: number };
};
type StudioUniverseMergeStatus = { availableAnalyses: number; ingest?: StudioUniverseIngestStatus; run: StudioUniverseMergeRun | null };
type StudioUniverseMergeResult = {
  id: number; state: StudioUniverseMergeRun["state"]; model: string; analysisCount: number; createdAt: string; finishedAt: string | null;
  universe: StudioUniverse; complete: boolean; sourceCoverage: { expected: number; actual: number; missing: string[] };
};

type StudioUniverseWorkspaceState = "draft" | "approved";
type StudioUniverseWorkspaceNode = {
  key: string;
  runId: number;
  kind: "story" | "character" | "event" | "location" | "object";
  name: string;
  summary: string;
  aliases: string[];
  sourceVideoIds: string[];
  payload: StudioUniverseStory | StudioUniverseEntity | StudioUniverseEvent | Record<string, unknown>;
  state: StudioUniverseWorkspaceState;
  updatedAt: string;
};
type StudioUniverseWorkspaceStatus = {
  latestImport: null | { runId: number; analysisCount: number; model: string; nodeCount: number; relationCount: number; importedAt: string };
  counts: {
    total: number; draft: number; approved: number; stories: number; characters: number; events: number; locations: number; objects: number;
    relations: number; approvedRelations: number;
  };
};
type StudioUniverseWorkspaceApplyResult = StudioUniverseWorkspaceStatus & {
  ok: true; runId: number; created: number; updated: number; approvedProtected: number;
  relationCreated: number; relationUpdated: number; relationSkipped: number;
};
type StudioUniverseWorkspaceStateResult = StudioUniverseWorkspaceStatus & {
  ok: true; state: StudioUniverseWorkspaceState; requested: number; affected: number; missing: number;
};

type StudioVisualProfile = {
  entityKey: string;
  entityType: string;
  source: string;
  description: string;
  attributes: string[];
  atmosphere: string;
  prompt: string;
  negativePrompt: string;
  imagePath: string;
  imageSource: string;
  imageProvider: string;
  imageModel: string;
  imageDataUrl: string;
  updatedAt: string;
};
type StudioVisualProfileInput = {
  entityKey: string;
  entityType?: string;
  source?: string;
  description?: string;
  attributes?: string[];
  atmosphere?: string;
  prompt?: string;
  negativePrompt?: string;
};

type StudioPublicExportResult = { root: string; file: string; generatedAt: string; itemCount: number; relationCount: number; editorialNodeCount?: number; editorialRelationCount?: number };
type StudioLivePublication = { ok: true; published: true; generatedAt: string; itemCount: number; relationCount: number; bytes: number; sha256: string; verified: boolean; publicUrl: string; admin: { id: number; username: string } };
type StudioPublicPublishResult = StudioPublicExportResult & { live: StudioLivePublication };
type StudioPublicationInfo = { generatedAt: string; file: string; itemCount: number; relationCount: number };
type StudioWebConnectionConfig = {
  url: string;
  youtubeChannelUrl: string;
  defaultUrl: string;
  customized: boolean;
  environmentOverride: boolean;
  endpoints: { community: string; studio: string; visual: string; publicContent: string };
};
type StudioWebConnectionTest = {
  ok: true;
  url: string;
  pageStatus: number;
  studio: { ok: true; service: string; status: number };
  community: { ok: true; service: string; status: number };
  latencyMs: number;
  checkedAt: string;
};

type StudioCommunityAdmin = { id: number; username: string; displayName: string; role: "admin"; researchAccess: boolean };
type StudioCommunityUser = { id: number; username: string; displayName: string; role: "member" | "admin"; status: "active" | "suspended"; researchAccess: boolean; createdAt: string; lastLoginAt: string | null; threadCount: number; postCount: number };
type StudioCommunitySession = {
  connected: boolean; configured: boolean; connecting: boolean; endpoint: string; studioEndpoint?: string; username: string | null;
  lastError: string | null; secureStorageAvailable: boolean;
};

interface Window {
  birdesengorStudio?: {
    bootstrap(payload?: Partial<StudioDatabaseState>): Promise<{ seeded: boolean }>;
    loadState(): Promise<StudioDatabaseState>;
    saveItem(item: StudioPersistedItem): Promise<StudioPersistedItem>;
    deleteItem(key: string): Promise<{ deleted: boolean; key: string; relationCount: number }>;
    addRelation(relation: StudioPersistedRelation): Promise<StudioPersistedRelation & { inserted: boolean }>;
    deleteRelation(id: string): Promise<{ deleted: boolean; id: string }>;
    refreshMain(): Promise<boolean>;
    navigate(section: string): Promise<boolean>;
    onNavigate(callback: (section: string) => void): () => void;
    onDataChanged(callback: () => void): () => void;
    bulkApply(input: { action: "publish" | "draft" | "delete"; keys: string[] }): Promise<StudioBulkResult>;
    openExternalUrl(url: string): Promise<boolean>;
    youtubeInspect(input: { url: string }): Promise<StudioYoutubePreview>;
    youtubeImport(input: { url: string }): Promise<StudioYoutubeImportResult>;
    youtubeCatalogStatus(): Promise<StudioTranscriptToolStatus>;
    ytDlpStatus(): Promise<StudioYtDlpStatus>;
    ytDlpSaveOptions(input: {
      autoCheck?: boolean; autoUpdate?: boolean; metadataLanguage?: string;
      subtitleLanguages?: string[]; thumbnailSize?: StudioYtDlpStatus["thumbnailSize"];
    }): Promise<StudioYtDlpStatus>;
    ytDlpCheck(): Promise<StudioYtDlpStatus>;
    ytDlpInstall(): Promise<StudioYtDlpStatus>;
    onYtDlpChanged(callback: () => void): () => void;
    youtubeCatalogChannels(): Promise<StudioYoutubeChannel[]>;
    youtubeCatalogVideos(input?: { channelId?: string }): Promise<StudioYoutubeCatalogVideo[]>;
    youtubeCatalogStats(): Promise<StudioYoutubeCatalogStats>;
    youtubeCatalogSync(input: { mode: "recent" | "full"; excludeShorts?: boolean; excludeLive?: boolean; excludeMembersOnly?: boolean }): Promise<StudioYoutubeSyncResult>;
    youtubeCatalogCancel(): Promise<{ canceled: boolean }>;
    onYoutubeCatalogProgress(callback: (progress: StudioYoutubeSyncProgress) => void): () => void;
    youtubeCatalogImport(input: { videoId: string }): Promise<StudioYoutubeImportResult>;
    transcriptGet(contentKey: string): Promise<StudioTranscript | null>;
    transcriptSave(input: { contentKey: string; source?: "youtube" | "manual"; language?: string; text: string }): Promise<StudioTranscript>;
    transcriptDelete(contentKey: string): Promise<{ deleted: boolean; contentKey: string }>;
    transcriptToolStatus(): Promise<StudioTranscriptToolStatus>;
    transcriptFetchYoutube(input: { contentKey?: string; videoId?: string }): Promise<StudioTranscript & { ytDlpVersion: string; filename: string; captionType?: string }>;
    aiConfig(): Promise<StudioAiConfig>;
    aiCliStatus(): Promise<StudioAiCliStatus>;
    aiRevealKey(kind: "text" | "image"): Promise<string>;
    aiParseGoogleQuickstart(value: string): Promise<StudioGoogleQuickstart>;
    aiSaveConfig(input: {
      provider: StudioAiProvider; endpoint: string; model: string; reasoningEffort?: StudioCodexReasoningEffort | ""; fallbackModel?: string; apiKey?: string; clearApiKey?: boolean;
      imageMode?: StudioAiImageMode; imageProvider?: StudioAiImageProvider; imageEndpoint?: string; imageModel?: string; imageApiKey?: string; clearImageApiKey?: boolean;
    }): Promise<StudioAiConfig>;
    aiModels(input?: StudioAiModelCatalogRequest): Promise<{ models: StudioAiModelCatalogEntry[]; textModels: string[]; imageModels: string[]; defaultModel?: string; config: StudioAiConfig }>;
    aiImageModels(input?: StudioAiImageModelCatalogRequest): Promise<{ provider: StudioAiImageProvider; models: Array<{ id: string; label: string }>; imageModels: string[]; defaultModel?: string; config: StudioAiConfig }>;
    aiTest(): Promise<{ ok: true; reply: string; fallback: null | { model: string; reply: string }; config: StudioAiConfig }>;
    aiImageCapability(): Promise<StudioAiImageCapability>;
    aiSuggest(input: { selected: StudioPersistedItem; related: StudioPersistedItem[]; candidates: StudioPersistedItem[]; transcript?: string }): Promise<StudioAiSuggestion>;
    aiAnalysisList(): Promise<StudioAiAnalysisVideo[]>;
    aiAnalysisStats(): Promise<StudioAiAnalysisStats>;
    aiAnalysisResult(videoId: string): Promise<StudioAiAnalysisResult | null>;
    aiAnalysisEnqueue(input: { videoIds: string[]; force?: boolean }): Promise<{ ok: true; requested: number; accepted: number; skipped: number }>;
    aiAnalysisResume(): Promise<{ running: boolean; reason?: string; stats?: StudioAiAnalysisStats }>;
    aiAnalysisCancel(): Promise<{ running: boolean; canceled: number }>;
    aiActivitySnapshot(input?: { sessionId?: string; includeEvents?: boolean }): Promise<StudioAiActivitySnapshot>;
    universeMergeStatus(): Promise<StudioUniverseMergeStatus>;
    universeMergeResult(runId?: number): Promise<StudioUniverseMergeResult | null>;
    universeMergeStart(input?: { videoIds?: string[] }): Promise<StudioUniverseMergeStatus>;
    universeMergeResume(): Promise<{ running: boolean; reason?: string } & StudioUniverseMergeStatus>;
    universeMergeCancel(): Promise<{ running: boolean; canceled: number; runId: number | null } & StudioUniverseMergeStatus>;
    universeWorkspaceStatus(): Promise<StudioUniverseWorkspaceStatus>;
    universeWorkspaceList(input?: { kind?: StudioUniverseWorkspaceNode["kind"]; state?: StudioUniverseWorkspaceState }): Promise<StudioUniverseWorkspaceNode[]>;
    universeWorkspaceApply(runId?: number): Promise<StudioUniverseWorkspaceApplyResult>;
    universeWorkspaceSetState(input: { keys: string[]; state: StudioUniverseWorkspaceState }): Promise<StudioUniverseWorkspaceStateResult>;
    openAiWorkbench(): Promise<boolean>;
    visualProfileGet(entityKey: string): Promise<StudioVisualProfile | null>;
    visualProfileSave(input: StudioVisualProfileInput): Promise<StudioVisualProfile>;
    visualImagePick(input: { entityKey: string; entityType?: string }): Promise<{ canceled: boolean; profile?: StudioVisualProfile }>;
    visualImageGenerate(input: StudioVisualProfileInput & { size?: "1024x1024" | "1536x1024" | "1024x1536" }): Promise<{ ok: true; profile: StudioVisualProfile; generation: { file: string; provider: string; model: string; controllerModel?: string; size: string; capability: StudioAiImageCapability } }>;
    visualImageClear(entityKey: string): Promise<{ cleared: boolean; entityKey: string; profile?: StudioVisualProfile }>;
    visualImageShow(entityKey: string): Promise<boolean>;
    webConnectionConfig(): Promise<StudioWebConnectionConfig>;
    webConnectionTest(input: { url: string }): Promise<StudioWebConnectionTest>;
    webConnectionSave(input: { url: string; youtubeChannelUrl: string }): Promise<StudioWebConnectionConfig>;
    exportPublicSnapshot(): Promise<StudioPublicExportResult>;
    publishPublicSnapshot(): Promise<StudioPublicPublishResult>;
    getPublicationInfo(): Promise<StudioPublicationInfo | null>;
    showPublicExport(): Promise<boolean>;
    getDatabaseInfo(): Promise<StudioDatabaseInfo>;
    communitySession(): Promise<StudioCommunitySession>;
    communityAdminConnect(): Promise<StudioCommunitySession>;
    communityAdminSave(input: { username: string; password: string }): Promise<{ ok: true; admin: StudioCommunityAdmin; session: StudioCommunitySession }>;
    communityAdminClear(): Promise<{ ok: true; session: StudioCommunitySession }>;
    communityUsers(): Promise<{ ok: true; users: StudioCommunityUser[] }>;
    communitySetResearch(input: { userId: number; enabled: boolean }): Promise<{ ok: true; userId: number; researchAccess: boolean }>;
    communitySetStatus(input: { userId: number; status: "active" | "suspended" }): Promise<{ ok: true; userId: number; status: "active" | "suspended" }>;
  };
}
