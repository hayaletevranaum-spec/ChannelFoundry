const { app, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const communityAdmin = require("./community-admin.cjs");
const youtubeCatalog = require("./youtube-catalog.cjs");
const aiService = require("./ai-service.cjs");
const aiAnalysis = require("./ai-analysis.cjs");
const aiActivity = require("./ai-activity.cjs");
const universeMerge = require("./universe-merge.cjs");
const universeWorkspace = require("./universe-workspace.cjs");
const transcriptService = require("./transcript-service.cjs");
const visualProfiles = require("./visual-profiles.cjs");
const publicationV2 = require("./publication-v2.cjs");
const {
  openStudioDatabase,
  exportPublicSnapshot,
  getPublicationInfo,
} = require("./storage.cjs");

let studioDatabase = null;
let mainWindow = null;
let analysisWorkerRunning = false;
let analysisWorkerStopRequested = false;
let analysisWorkerController = null;
let universeWorkerRunning = false;
let universeWorkerStopRequested = false;
let universeWorkerController = null;

function database() {
  if (!studioDatabase) {
    studioDatabase = openStudioDatabase(app.getPath("userData"));
    youtubeCatalog.ensureSchema(studioDatabase);
    transcriptService.ensureSchema(studioDatabase);
    aiAnalysis.ensureSchema(studioDatabase);
    universeMerge.ensureSchema(studioDatabase);
    universeWorkspace.ensureSchema(studioDatabase);
    visualProfiles.ensureSchema(studioDatabase);
  }
  return studioDatabase;
}

function setMainWindow(window) {
  mainWindow = window;
}

function writeSnapshotFile(file, snapshot) {
  const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function liveBaselineFile() {
  return path.join(app.getPath("userData"), "public-export", "publication-live-baseline.json");
}

function publicationPreview() {
  const built = publicationV2.buildPublicationV2(database());
  const baselineFile = liveBaselineFile();
  let previous = null;
  if (fs.existsSync(baselineFile)) {
    try { previous = JSON.parse(fs.readFileSync(baselineFile, "utf8")); } catch {}
  }
  const snapshot = built.snapshot;
  return {
    baselineAvailable: Boolean(previous?.schemaVersion === 2),
    generatedAt: snapshot.publication.generatedAt,
    publicationId: snapshot.publication.id,
    contentFingerprint: snapshot.publication.contentFingerprint,
    changed: previous?.publication?.contentFingerprint !== snapshot.publication.contentFingerprint,
    counts: {
      sections: snapshot.journal.sections.length,
      entities: snapshot.archive.entities.length,
      relations: snapshot.archive.relations.length,
      assets: snapshot.assets.length,
    },
    readiness: built.readiness,
    baseline: previous?.schemaVersion === 2 ? {
      source: "live",
      file: baselineFile,
      generatedAt: String(previous.publication?.generatedAt ?? ""),
      publicationId: String(previous.publication?.id ?? ""),
      contentFingerprint: String(previous.publication?.contentFingerprint ?? ""),
    } : null,
  };
}

function createPublicExport() {
  return exportPublicSnapshot(database(), app.getPath("userData"));
}

async function publishPublicExport() {
  const local = createPublicExport();
  if (!local.readiness?.readyForTheme) {
    throw new Error("Publication v2 henüz canlı yayına hazır değil. Önce 05 · Hikâyeleştir ve 06 · Görsel Tamamlama kapılarını tamamla.");
  }
  const snapshot = JSON.parse(fs.readFileSync(local.file, "utf8"));
  let uploadedAssets = 0;
  for (const asset of snapshot.assets ?? []) {
    const relative = String(asset?.url ?? "");
    if (!relative.startsWith("assets/")) throw new Error(`Publication asset URL geçersiz: ${relative}`);
    const filename = path.basename(relative);
    const file = path.join(local.assetsDirectory, filename);
    await communityAdmin.uploadPublicationAsset({ file, filename, sha256: asset.sha256 });
    uploadedAssets += 1;
  }
  const live = await communityAdmin.publishPublication(snapshot);
  writeSnapshotFile(liveBaselineFile(), snapshot);
  return { ...local, uploadedAssets, live };
}

function showPublicExport() {
  const info = getPublicationInfo(database());
  if (!info?.file) throw new Error("Henüz publication v2 paketi oluşturulmadı.");
  shell.showItemInFolder(info.file);
  return true;
}

function refreshMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("studio:data-changed");
}

function notifyYtDlpChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("studio:ytdlp-changed");
}

function navigateMainWindow(section) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("studio:navigate", String(section));
  mainWindow.focus();
  return true;
}

function connectionLikeFailure(error) {
  if (/^AI_CLI_/.test(String(error?.code ?? ""))) return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /zaman aşım|fetch failed|ECONNREFUSED|AI isteği başarısız|Codex CLI|Önce Ayarlar|endpoint|bağlantı/i.test(text);
}

async function processAnalysisQueue() {
  if (analysisWorkerRunning) return { running: true };
  const initialConfig = aiService.getConfig(app.getPath("userData"));
  if (!initialConfig.configured) return { running: false, reason: "not_configured" };
  analysisWorkerRunning = true;
  analysisWorkerStopRequested = false;
  try {
    while (!analysisWorkerStopRequested) {
      const config = aiService.getConfig(app.getPath("userData"));
      if (!config.configured) break;
      const job = aiAnalysis.claimNext(database());
      if (!job) break;
      refreshMainWindow();
      const controller = new AbortController();
      analysisWorkerController = controller;
      let activitySession = null;
      try {
        const source = aiAnalysis.sourceContext(database(), job.videoId);
        activitySession = aiActivity.startSession({
          kind: "analysis",
          key: `analysis:${job.videoId}:${Date.now()}`,
          title: "Video çözümleme",
          subject: source.title || job.videoId,
          provider: config.provider,
          configuredModel: config.model || (config.provider === "codex-cli" ? "Codex CLI · varsayılan" : ""),
          stage: "Kaynak hazırlanıyor",
          message: `“${source.title || job.videoId}” için yerel transkript ve video bilgileri hazırlandı.`,
          context: { videoId: job.videoId },
        });
        const result = await aiService.analyzeTranscript(app.getPath("userData"), {
          ...source,
          signal: controller.signal,
          activity: { sessionId: activitySession.id },
        });
        if (analysisWorkerStopRequested || controller.signal.aborted) {
          aiActivity.finishSession(activitySession.id, {
            state: "canceled",
            model: result.config?.model,
            detail: "Video çözümleme sonucu kaydedilmeden işlem durduruldu.",
          });
          break;
        }
        aiAnalysis.complete(database(), job.videoId, result.config?.model ?? config.model, result);
        aiActivity.finishSession(activitySession.id, {
          state: "done",
          model: result.config?.model ?? config.model,
          detail: `“${source.title || job.videoId}” anlatı dosyası yerel çalışma alanına kaydedildi.`,
        });
        refreshMainWindow();
      } catch (error) {
        if (error?.code === "AI_REQUEST_CANCELED" || analysisWorkerStopRequested) {
          if (activitySession) aiActivity.finishSession(activitySession.id, {
            state: "canceled",
            detail: "Video çözümleme kullanıcı tarafından durduruldu.",
          });
          break;
        }
        if (activitySession) aiActivity.finishSession(activitySession.id, {
          state: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
        aiAnalysis.fail(database(), job.videoId, error);
        refreshMainWindow();
        if (connectionLikeFailure(error)) break;
      } finally {
        if (analysisWorkerController === controller) analysisWorkerController = null;
      }
      if (analysisWorkerStopRequested) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    analysisWorkerController = null;
    analysisWorkerRunning = false;
    refreshMainWindow();
  }
  return { running: false, stats: aiAnalysis.stats(database()) };
}

function cancelAnalysisQueue() {
  analysisWorkerStopRequested = true;
  analysisWorkerController?.abort();
  const result = aiAnalysis.cancelPending(database());
  refreshMainWindow();
  return { ...result, running: analysisWorkerRunning };
}

async function processUniverseQueue() {
  if (universeWorkerRunning) return { running: true, ...universeMerge.status(database()) };
  const config = aiService.getConfig(app.getPath("userData"));
  if (!config.configured) return { running: false, reason: "not_configured", ...universeMerge.status(database()) };
  universeWorkerRunning = true;
  universeWorkerStopRequested = false;
  try {
    while (!universeWorkerStopRequested) {
      const current = universeMerge.status(database());
      if (!current.run || !["waiting", "running"].includes(current.run.state)) break;
      const controller = new AbortController();
      universeWorkerController = controller;
      try {
        const next = await universeMerge.processNext(database(), app.getPath("userData"), { signal: controller.signal });
        refreshMainWindow();
        if (!next.run || ["done", "error"].includes(next.run.state)) break;
      } catch (error) {
        refreshMainWindow();
        if (error?.code === "AI_REQUEST_CANCELED" || universeWorkerStopRequested) break;
        break;
      } finally {
        if (universeWorkerController === controller) universeWorkerController = null;
      }
      if (universeWorkerStopRequested) break;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  } finally {
    universeWorkerController = null;
    universeWorkerRunning = false;
    refreshMainWindow();
    const pending = universeMerge.status(database());
    if (pending.run && ["waiting", "running"].includes(pending.run.state)) {
      setTimeout(() => { void processUniverseQueue(); }, 0);
    }
  }
  return { running: false, ...universeMerge.status(database()) };
}

function cancelUniverseQueue() {
  universeWorkerStopRequested = true;
  universeWorkerController?.abort();
  const result = universeMerge.cancelActive(database());
  refreshMainWindow();
  return { ...result, running: universeWorkerRunning, ...universeMerge.status(database()) };
}

async function pickVisualImage(input) {
  const options = {
    title: "Görsel seç",
    properties: ["openFile"],
    filters: [{ name: "Görseller", extensions: ["png", "jpg", "jpeg", "webp"] }],
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const profile = visualProfiles.attachFile(database(), app.getPath("userData"), {
    entityKey: input?.entityKey,
    entityType: input?.entityType,
    file: result.filePaths[0],
  });
  refreshMainWindow();
  return { canceled: false, profile };
}

async function generateVisualImage(input) {
  const profile = visualProfiles.save(database(), {
    entityKey: input?.entityKey,
    entityType: input?.entityType,
    source: input?.source ?? "ai",
    description: input?.description,
    attributes: input?.attributes,
    atmosphere: input?.atmosphere,
    prompt: input?.prompt,
    negativePrompt: input?.negativePrompt,
  });
  const config = aiService.getConfig(app.getPath("userData"));
  const subject = String(input?.subject ?? profile.entityKey).trim() || profile.entityKey;
  const provider = config.image?.provider || config.provider;
  const configuredModel = config.image?.model || config.model || (provider === "codex-cli" ? "Codex CLI · varsayılan" : "");
  const size = String(input?.size ?? "1024x1024");
  const activitySession = aiActivity.startSession({
    kind: "visual",
    key: `visual:${profile.entityKey}:${Date.now()}`,
    title: "Görsel üretimi",
    subject,
    provider,
    configuredModel,
    stage: "Görsel hazırlanıyor",
    message: `“${subject}” için görsel üretim isteği hazırlandı.`,
    context: { entityKey: profile.entityKey, entityType: profile.entityType, size },
  });
  const request = aiActivity.beginRequest({
    sessionId: activitySession.id,
    label: "Görsel üretim isteği",
    stage: "Görsel üretiliyor",
  }, {
    provider,
    model: configuredModel,
    messages: [{
      role: "user",
      content: profile.negativePrompt
        ? `${profile.prompt}\n\nKaçınılacak özellikler: ${profile.negativePrompt}`
        : profile.prompt,
    }],
    reasoningEffort: config.reasoningEffort || "",
  });

  try {
    const generated = await aiService.generateImage(app.getPath("userData"), {
      entityKey: profile.entityKey,
      prompt: profile.prompt,
      negativePrompt: profile.negativePrompt,
      size: input?.size,
    });
    const attached = visualProfiles.attachStoredFile(database(), profile.entityKey, {
      entityType: profile.entityType,
      file: generated.file,
      source: "generated",
      provider: generated.provider,
      model: generated.model,
    });
    const actualModel = generated.model || generated.controllerModel || configuredModel;
    aiActivity.completeRequest(request, {
      label: "Görsel üretildi",
      model: actualModel,
      finishReason: "completed",
      content: `“${subject}” için ${generated.size || size} görsel üretildi ve Studio görsel arşivine kaydedildi.`,
    });
    aiActivity.finishSession(activitySession.id, {
      state: "done",
      model: actualModel,
      detail: `“${subject}” görseli hazır.`,
    });
    refreshMainWindow();
    return { ok: true, profile: attached, generation: generated };
  } catch (error) {
    aiActivity.failRequest(request, error, { label: "Görsel üretimi başarısız" });
    aiActivity.finishSession(activitySession.id, {
      state: error?.code === "AI_REQUEST_CANCELED" ? "canceled" : "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

module.exports = {
  cancelAnalysisQueue,
  cancelUniverseQueue,
  createPublicExport,
  database,
  generateVisualImage,
  navigateMainWindow,
  notifyYtDlpChanged,
  pickVisualImage,
  processAnalysisQueue,
  processUniverseQueue,
  publicationPreview,
  publishPublicExport,
  refreshMainWindow,
  setMainWindow,
  showPublicExport,
};
