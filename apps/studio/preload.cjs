const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("birdesengorStudio", {
  bootstrap: (payload) => ipcRenderer.invoke("studio:bootstrap", payload),
  loadState: () => ipcRenderer.invoke("studio:load-state"),
  saveItem: (item) => ipcRenderer.invoke("studio:save-item", item),
  deleteItem: (key) => ipcRenderer.invoke("studio:delete-item", key),
  addRelation: (relation) => ipcRenderer.invoke("studio:add-relation", relation),
  deleteRelation: (id) => ipcRenderer.invoke("studio:delete-relation", id),
  refreshMain: () => ipcRenderer.invoke("studio:refresh-main"),
  navigate: (section) => ipcRenderer.invoke("studio:navigate", section),
  onNavigate: (callback) => {
    const listener = (_event, section) => callback(section);
    ipcRenderer.on("studio:navigate", listener);
    return () => ipcRenderer.removeListener("studio:navigate", listener);
  },
  onDataChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("studio:data-changed", listener);
    return () => ipcRenderer.removeListener("studio:data-changed", listener);
  },
  bulkApply: (input) => ipcRenderer.invoke("studio:bulk-apply", input),
  openExternalUrl: (url) => ipcRenderer.invoke("studio:open-external-url", url),
  youtubeInspect: (input) => ipcRenderer.invoke("studio:youtube-inspect", input),
  youtubeImport: (input) => ipcRenderer.invoke("studio:youtube-import", input),
  youtubeCatalogStatus: () => ipcRenderer.invoke("studio:youtube-catalog-status"),
  ytDlpStatus: () => ipcRenderer.invoke("studio:ytdlp-status"),
  ytDlpSaveOptions: (input) => ipcRenderer.invoke("studio:ytdlp-save-options", input),
  ytDlpCheck: () => ipcRenderer.invoke("studio:ytdlp-check"),
  ytDlpInstall: () => ipcRenderer.invoke("studio:ytdlp-install"),
  onYtDlpChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("studio:ytdlp-changed", listener);
    return () => ipcRenderer.removeListener("studio:ytdlp-changed", listener);
  },
  youtubeCatalogChannels: () => ipcRenderer.invoke("studio:youtube-catalog-channels"),
  youtubeCatalogVideos: (input) => ipcRenderer.invoke("studio:youtube-catalog-videos", input),
  youtubeCatalogStats: () => ipcRenderer.invoke("studio:youtube-catalog-stats"),
  youtubeCatalogSync: (input) => ipcRenderer.invoke("studio:youtube-catalog-sync", input),
  youtubeCatalogCancel: () => ipcRenderer.invoke("studio:youtube-catalog-cancel"),
  onYoutubeCatalogProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("studio:youtube-catalog-progress", listener);
    return () => ipcRenderer.removeListener("studio:youtube-catalog-progress", listener);
  },
  youtubeCatalogImport: (input) => ipcRenderer.invoke("studio:youtube-catalog-import", input),
  transcriptGet: (contentKey) => ipcRenderer.invoke("studio:transcript-get", contentKey),
  transcriptSave: (input) => ipcRenderer.invoke("studio:transcript-save", input),
  transcriptDelete: (contentKey) => ipcRenderer.invoke("studio:transcript-delete", contentKey),
  transcriptToolStatus: () => ipcRenderer.invoke("studio:transcript-tool-status"),
  transcriptFetchYoutube: (input) => ipcRenderer.invoke("studio:transcript-fetch-youtube", input),
  aiConfig: () => ipcRenderer.invoke("studio:ai-config"),
  aiCliStatus: () => ipcRenderer.invoke("studio:ai-cli-status"),
  aiRevealKey: (kind) => ipcRenderer.invoke("studio:ai-reveal-key", kind),
  aiParseGoogleQuickstart: (value) => ipcRenderer.invoke("studio:ai-parse-google-quickstart", value),
  aiSaveConfig: (input) => ipcRenderer.invoke("studio:ai-save-config", input),
  aiModels: (input) => ipcRenderer.invoke("studio:ai-models", input),
  aiImageModels: (input) => ipcRenderer.invoke("studio:ai-image-models", input),
  aiTest: () => ipcRenderer.invoke("studio:ai-test"),
  aiImageCapability: () => ipcRenderer.invoke("studio:ai-image-capability"),
  aiSuggest: (input) => ipcRenderer.invoke("studio:ai-suggest", input),
  aiAnalysisList: () => ipcRenderer.invoke("studio:ai-analysis-list"),
  aiAnalysisStats: async () => {
    const [stats, videos] = await Promise.all([
      ipcRenderer.invoke("studio:ai-analysis-stats"),
      ipcRenderer.invoke("studio:ai-analysis-list"),
    ]);
    const analyzed = Array.isArray(videos) ? videos.filter((video) => video?.hasAnalysis) : [];
    return {
      ...stats,
      editorialPending: analyzed.filter((video) => !video.editorialState || video.editorialState === "pending").length,
      curated: analyzed.filter((video) => video.editorialState === "curated").length,
      excluded: analyzed.filter((video) => video.editorialState === "excluded").length,
    };
  },
  aiAnalysisResult: (videoId) => ipcRenderer.invoke("studio:ai-analysis-result", videoId),
  aiAnalysisEditorial: (videoId) => ipcRenderer.invoke("studio:ai-analysis-editorial", videoId),
  aiAnalysisEditorialSave: (input) => ipcRenderer.invoke("studio:ai-analysis-editorial-save", input),
  aiAnalysisSupportRecords: () => ipcRenderer.invoke("studio:ai-analysis-support-records"),
  aiAnalysisSupportSources: () => ipcRenderer.invoke("studio:ai-analysis-support-sources"),
  aiAnalysisSupportSave: (input) => ipcRenderer.invoke("studio:ai-analysis-support-save", input),
  aiAnalysisEnqueue: (input) => ipcRenderer.invoke("studio:ai-analysis-enqueue", input),
  aiAnalysisResume: () => ipcRenderer.invoke("studio:ai-analysis-resume"),
  aiAnalysisCancel: () => ipcRenderer.invoke("studio:ai-analysis-cancel"),
  aiActivitySnapshot: (input) => ipcRenderer.invoke("studio:ai-activity-snapshot", input),
  universeMergeStatus: () => ipcRenderer.invoke("studio:universe-merge-status"),
  universeMergeResult: (runId) => ipcRenderer.invoke("studio:universe-merge-result", runId),
  universeMergeStart: (input) => ipcRenderer.invoke("studio:universe-merge-start", input),
  universeMergeResume: () => ipcRenderer.invoke("studio:universe-merge-resume"),
  universeMergeCancel: () => ipcRenderer.invoke("studio:universe-merge-cancel"),
  universeMaintenanceStatus: () => ipcRenderer.invoke("studio:universe-maintenance-status"),
  universeMaintenanceReset: (input) => ipcRenderer.invoke("studio:universe-maintenance-reset", input),
  universeWorkspaceStatus: () => ipcRenderer.invoke("studio:universe-workspace-status"),
  universeWorkspaceList: (input) => ipcRenderer.invoke("studio:universe-workspace-list", input),
  universeWorkspaceRelations: (input) => ipcRenderer.invoke("studio:universe-workspace-relations", input),
  universeWorkspaceApply: (runId) => ipcRenderer.invoke("studio:universe-workspace-apply", runId),
  universeWorkspaceSetState: (input) => ipcRenderer.invoke("studio:universe-workspace-set-state", input),
  universeWorkspaceUpdate: (input) => ipcRenderer.invoke("studio:universe-workspace-update", input),
  narrativeStatus: () => ipcRenderer.invoke("studio:narrative-status"),
  narrativePrepare: (input) => ipcRenderer.invoke("studio:narrative-prepare", input),
  narrativeGetRun: (runId) => ipcRenderer.invoke("studio:narrative-run", runId),
  narrativeBuildRequest: (runId) => ipcRenderer.invoke("studio:narrative-request", runId),
  narrativeSaveDraftResponse: (input) => ipcRenderer.invoke("studio:narrative-save-draft-response", input),
  narrativeGenerateDraft: (input) => ipcRenderer.invoke("studio:narrative-generate-draft", input),
  narrativeApply: (runId) => ipcRenderer.invoke("studio:narrative-apply", runId),
  narrativeDiscard: (runId) => ipcRenderer.invoke("studio:narrative-discard", runId),
  visualCompletionStatus: () => ipcRenderer.invoke("studio:visual-completion-status"),
  visualCompletionSetSceneState: (input) => ipcRenderer.invoke("studio:visual-completion-set-scene-state", input),
  openAiWorkbench: () => ipcRenderer.invoke("studio:open-ai-workbench"),
  visualProfileGet: (entityKey) => ipcRenderer.invoke("studio:visual-profile-get", entityKey),
  visualProfileSave: (input) => ipcRenderer.invoke("studio:visual-profile-save", input),
  visualImagePick: (input) => ipcRenderer.invoke("studio:visual-image-pick", input),
  visualImageGenerate: (input) => ipcRenderer.invoke("studio:visual-image-generate", input),
  visualImageClear: (entityKey) => ipcRenderer.invoke("studio:visual-image-clear", entityKey),
  visualImageShow: (entityKey) => ipcRenderer.invoke("studio:visual-image-show", entityKey),
  webConnectionConfig: () => ipcRenderer.invoke("studio:web-connection-config"),
  webConnectionTest: (input) => ipcRenderer.invoke("studio:web-connection-test", input),
  webConnectionSave: (input) => ipcRenderer.invoke("studio:web-connection-save", input),
  exportPublicSnapshot: () => ipcRenderer.invoke("studio:export-public-snapshot"),
  publishPublicSnapshot: () => ipcRenderer.invoke("studio:publish-public-snapshot"),
  publicationPreview: () => ipcRenderer.invoke("studio:publication-preview"),
  getPublicationInfo: () => ipcRenderer.invoke("studio:publication-info"),
  showPublicExport: () => ipcRenderer.invoke("studio:show-public-export"),
  getDatabaseInfo: () => ipcRenderer.invoke("studio:database-info"),
  communitySession: () => ipcRenderer.invoke("studio:community-session"),
  communityAdminConnect: () => ipcRenderer.invoke("studio:community-admin-connect"),
  communityAdminSave: (input) => ipcRenderer.invoke("studio:community-admin-save", input),
  communityAdminClear: () => ipcRenderer.invoke("studio:community-admin-clear"),
  communityUsers: () => ipcRenderer.invoke("studio:community-users"),
  communitySetResearch: (input) => ipcRenderer.invoke("studio:community-set-research", input),
  communitySetStatus: (input) => ipcRenderer.invoke("studio:community-set-status", input),
});
