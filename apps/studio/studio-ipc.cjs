const { app, ipcMain, shell } = require("electron");
const communityAdmin = require("./community-admin.cjs");
const { applyBulkOperation } = require("./bulk-operations.cjs");
const youtubeImporter = require("./youtube-import.cjs");
const youtubeCatalog = require("./youtube-catalog.cjs");
const aiService = require("./ai-service.cjs");
const aiAnalysis = require("./ai-analysis.cjs");
const aiActivity = require("./ai-activity.cjs");
const universeMerge = require("./universe-merge.cjs");
const universeWorkspace = require("./universe-workspace.cjs");
const { registerNarrativeIpc } = require("./narrative-ipc.cjs");
const transcriptService = require("./transcript-service.cjs");
const visualProfiles = require("./visual-profiles.cjs");
const webConnection = require("./web-connection.cjs");
const ytDlpManager = require("./ytdlp-manager.cjs");
const runtime = require("./studio-runtime.cjs");
const {
  bootstrap, loadState, upsertItem, deleteItem, insertRelation, deleteRelation,
  getPublicationInfo, getDatabaseInfo,
} = require("./storage.cjs");

let youtubeSyncOperation = null;

function sendYoutubeSyncProgress(sender, progress) {
  if (!sender || sender.isDestroyed()) return;
  const processed = Math.max(0, Number(progress?.processed) || 0);
  const total = Math.max(0, Number(progress?.total) || 0);
  sender.send("studio:youtube-catalog-progress", {
    phase: String(progress?.phase || "preparing"),
    processed,
    total,
    percent: total ? Math.min(100, Math.round(processed / total * 100)) : 0,
    currentTitle: String(progress?.currentTitle || ""),
  });
}

function registerContentHandlers() {
  ipcMain.handle("studio:bootstrap", (_event, payload) => bootstrap(runtime.database(), payload));
  ipcMain.handle("studio:load-state", () => loadState(runtime.database()));
  ipcMain.handle("studio:save-item", (_event, item) => upsertItem(runtime.database(), item));
  ipcMain.handle("studio:delete-item", (_event, key) => deleteItem(runtime.database(), key));
  ipcMain.handle("studio:add-relation", (_event, relation) => insertRelation(runtime.database(), relation));
  ipcMain.handle("studio:delete-relation", (_event, id) => deleteRelation(runtime.database(), id));
  ipcMain.handle("studio:refresh-main", () => { runtime.refreshMainWindow(); return true; });
  ipcMain.handle("studio:navigate", (_event, section) => runtime.navigateMainWindow(section));
  ipcMain.handle("studio:bulk-apply", (_event, input) => {
    const result = applyBulkOperation(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
}

function registerSourceHandlers() {
  ipcMain.handle("studio:open-external-url", async (_event, value) => {
    let target;
    try {
      target = new URL(String(value || ""));
    } catch {
      throw new Error("Geçerli bir YouTube bağlantısı bulunamadı.");
    }
    const allowedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
    if (target.protocol !== "https:" || !allowedHosts.has(target.hostname.toLowerCase())) {
      throw new Error("Yalnızca güvenli YouTube bağlantıları açılabilir.");
    }
    await shell.openExternal(target.toString());
    return true;
  });
  ipcMain.handle("studio:youtube-inspect", (_event, input) => youtubeImporter.inspectYoutube(input));
  ipcMain.handle("studio:youtube-import", async (_event, input) => {
    const result = await youtubeImporter.importYoutube(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:youtube-catalog-status", () => youtubeCatalog.ytDlpStatus());
  ipcMain.handle("studio:ytdlp-status", () => ytDlpManager.status());
  ipcMain.handle("studio:ytdlp-save-options", (_event, input) => ytDlpManager.saveOptions(input));
  ipcMain.handle("studio:ytdlp-check", () => ytDlpManager.checkForUpdates({ allowAutoUpdate: false }));
  ipcMain.handle("studio:ytdlp-install", () => ytDlpManager.installOrUpdate());
  ipcMain.handle("studio:youtube-catalog-channels", () => youtubeCatalog.listChannels(runtime.database()));
  ipcMain.handle("studio:youtube-catalog-videos", (_event, input) => youtubeCatalog.listVideos(runtime.database(), input));
  ipcMain.handle("studio:youtube-catalog-stats", () => youtubeCatalog.catalogStats(runtime.database()));
  ipcMain.handle("studio:youtube-catalog-sync", async (event, input) => {
    if (youtubeSyncOperation) throw new Error("Başka bir kanal senkronizasyonu zaten çalışıyor.");
    const controller = new AbortController();
    youtubeSyncOperation = { controller, sender: event.sender };
    try {
      const result = await youtubeCatalog.syncChannel(runtime.database(), app.getPath("userData"), {
        mode: input?.mode,
        url: webConnection.youtubeChannelUrl(),
        excludeShorts: input?.excludeShorts !== false,
        excludeLive: input?.excludeLive !== false,
        excludeMembersOnly: input?.excludeMembersOnly !== false,
        signal: controller.signal,
        onProgress: (progress) => sendYoutubeSyncProgress(event.sender, progress),
      });
      sendYoutubeSyncProgress(event.sender, { phase: "complete", processed: result.updatedCount, total: result.updatedCount });
      runtime.refreshMainWindow();
      return result;
    } catch (error) {
      if (controller.signal.aborted || error?.code === "BIRDESENGOR_SYNC_CANCELLED") {
        sendYoutubeSyncProgress(event.sender, { phase: "canceled", processed: 0, total: 0 });
        return { ok: false, canceled: true };
      }
      throw error;
    } finally {
      youtubeSyncOperation = null;
    }
  });
  ipcMain.handle("studio:youtube-catalog-cancel", () => {
    if (!youtubeSyncOperation) return { canceled: false };
    sendYoutubeSyncProgress(youtubeSyncOperation.sender, { phase: "canceling", processed: 0, total: 0 });
    youtubeSyncOperation.controller.abort();
    return { canceled: true };
  });
  ipcMain.handle("studio:youtube-catalog-import", (_event, input) => {
    const result = youtubeCatalog.importCatalogVideo(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:transcript-get", (_event, contentKey) => transcriptService.getTranscript(runtime.database(), contentKey));
  ipcMain.handle("studio:transcript-save", (_event, input) => transcriptService.saveTranscript(runtime.database(), input));
  ipcMain.handle("studio:transcript-delete", (_event, contentKey) => transcriptService.deleteTranscript(runtime.database(), contentKey));
  ipcMain.handle("studio:transcript-tool-status", () => transcriptService.ytDlpStatus());
  ipcMain.handle("studio:transcript-fetch-youtube", (_event, input) => transcriptService.fetchYoutubeTranscript(runtime.database(), input));
}

function registerAiHandlers() {
  ipcMain.handle("studio:ai-config", () => aiService.getConfig(app.getPath("userData")));
  ipcMain.handle("studio:ai-cli-status", () => aiService.cliStatus());
  ipcMain.handle("studio:ai-reveal-key", (_event, kind) => aiService.getSecret(app.getPath("userData"), kind === "image" ? "image" : "text"));
  ipcMain.handle("studio:ai-parse-google-quickstart", (_event, value) => aiService.parseGoogleAiStudioQuickstart(value));
  ipcMain.handle("studio:ai-save-config", (_event, input) => {
    const saved = aiService.saveConfig(app.getPath("userData"), input);
    runtime.refreshMainWindow();
    if (saved.configured) void runtime.processAnalysisQueue();
    return saved;
  });
  ipcMain.handle("studio:ai-models", (_event, input) => aiService.listModels(app.getPath("userData"), input));
  ipcMain.handle("studio:ai-image-models", (_event, input) => aiService.listImageModels(app.getPath("userData"), input));
  ipcMain.handle("studio:ai-test", () => aiService.testConnection(app.getPath("userData")));
  ipcMain.handle("studio:ai-image-capability", () => aiService.detectImageCapability(app.getPath("userData")));
  ipcMain.handle("studio:ai-suggest", (_event, input) => aiService.suggestContent(app.getPath("userData"), input));
  ipcMain.handle("studio:ai-analysis-list", () => aiAnalysis.list(runtime.database()));
  ipcMain.handle("studio:ai-analysis-stats", () => aiAnalysis.stats(runtime.database()));
  ipcMain.handle("studio:ai-analysis-result", (_event, videoId) => aiAnalysis.getResult(runtime.database(), videoId));
  ipcMain.handle("studio:ai-analysis-enqueue", (_event, input) => {
    const result = aiAnalysis.enqueue(runtime.database(), input);
    runtime.refreshMainWindow();
    void runtime.processAnalysisQueue();
    return result;
  });
  ipcMain.handle("studio:ai-analysis-resume", () => runtime.processAnalysisQueue());
  ipcMain.handle("studio:ai-analysis-cancel", () => runtime.cancelAnalysisQueue());
  ipcMain.handle("studio:ai-activity-snapshot", (_event, input) => aiActivity.snapshot(input));
  ipcMain.handle("studio:open-ai-workbench", () => runtime.navigateMainWindow("AI Atölyesi"));
  ipcMain.handle("studio:universe-merge-status", () => universeMerge.status(runtime.database()));
  ipcMain.handle("studio:universe-merge-result", (_event, runId) => universeMerge.latestResult(runtime.database(), runId));
  ipcMain.handle("studio:universe-merge-start", (_event, input) => {
    const result = universeMerge.start(runtime.database(), app.getPath("userData"), input);
    runtime.refreshMainWindow();
    void runtime.processUniverseQueue();
    return result;
  });
  ipcMain.handle("studio:universe-merge-resume", () => runtime.processUniverseQueue());
  ipcMain.handle("studio:universe-merge-cancel", () => runtime.cancelUniverseQueue());
}

function registerEditorialHandlers() {
  ipcMain.handle("studio:universe-workspace-status", () => universeWorkspace.status(runtime.database()));
  ipcMain.handle("studio:universe-workspace-list", (_event, input) => universeWorkspace.listNodes(runtime.database(), input));
  ipcMain.handle("studio:universe-workspace-relations", (_event, input) => universeWorkspace.listRelations(runtime.database(), input));
  ipcMain.handle("studio:universe-workspace-apply", (_event, runId) => {
    const result = universeWorkspace.applyRun(runtime.database(), runId);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:universe-workspace-set-state", (_event, input) => {
    const result = universeWorkspace.setNodeState(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:universe-workspace-update", (_event, input) => {
    const result = universeWorkspace.updateNode(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:visual-profile-get", (_event, entityKey) => visualProfiles.get(runtime.database(), entityKey));
  ipcMain.handle("studio:visual-profile-save", (_event, input) => {
    const result = visualProfiles.save(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:visual-image-pick", (_event, input) => runtime.pickVisualImage(input));
  ipcMain.handle("studio:visual-image-generate", (_event, input) => runtime.generateVisualImage(input));
  ipcMain.handle("studio:visual-image-clear", (_event, entityKey) => {
    const result = visualProfiles.clearImage(runtime.database(), entityKey);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:visual-image-show", (_event, entityKey) => {
    const profile = visualProfiles.get(runtime.database(), entityKey);
    if (!profile?.imagePath) return false;
    shell.showItemInFolder(profile.imagePath);
    return true;
  });
}

function registerPublishingHandlers() {
  ipcMain.handle("studio:web-connection-config", () => webConnection.getConfig());
  ipcMain.handle("studio:web-connection-test", (_event, input) => webConnection.testConnection(input));
  ipcMain.handle("studio:web-connection-save", (_event, input) => {
    const result = webConnection.saveConfig(input);
    communityAdmin.resetConnection();
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:export-public-snapshot", () => runtime.createPublicExport());
  ipcMain.handle("studio:publish-public-snapshot", () => runtime.publishPublicExport());
  ipcMain.handle("studio:publication-preview", () => runtime.publicationPreview());
  ipcMain.handle("studio:publication-info", () => getPublicationInfo(runtime.database()));
  ipcMain.handle("studio:show-public-export", () => runtime.showPublicExport());
  ipcMain.handle("studio:database-info", () => getDatabaseInfo(runtime.database(), app.getPath("userData")));
  ipcMain.handle("studio:community-session", () => communityAdmin.connectStored());
  ipcMain.handle("studio:community-admin-connect", () => communityAdmin.connectStored({ force: true }));
  ipcMain.handle("studio:community-admin-save", (_event, input) => communityAdmin.saveCredentials(input));
  ipcMain.handle("studio:community-admin-clear", () => communityAdmin.clearCredentials());
  ipcMain.handle("studio:community-users", () => communityAdmin.users());
  ipcMain.handle("studio:community-set-research", (_event, input) => communityAdmin.setResearchAccess(input));
  ipcMain.handle("studio:community-set-status", (_event, input) => communityAdmin.setStatus(input));
}

function registerStudioIpc() {
  registerContentHandlers();
  registerSourceHandlers();
  registerAiHandlers();
  registerEditorialHandlers();
  registerNarrativeIpc(ipcMain, runtime);
  registerPublishingHandlers();
}

module.exports = { registerStudioIpc };
