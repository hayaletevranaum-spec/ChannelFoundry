const narrativeService = require("./narrative-service.cjs");
const narrativeGeneration = require("./narrative-ai-generation.cjs");
const { registerVisualCompletionIpc } = require("./visual-completion-ipc.cjs");

function registerNarrativeIpc(ipcMain, runtime) {
  if (!ipcMain?.handle) throw new Error("Narrative IPC için ipcMain.handle gerekli.");
  if (!runtime?.database) throw new Error("Narrative IPC için Studio runtime database erişimi gerekli.");
  const db = () => runtime.database();
  const mutate = (callback) => {
    const result = callback();
    runtime.refreshMainWindow?.();
    return result;
  };
  const mutateAsync = async (callback) => {
    const result = await callback();
    runtime.refreshMainWindow?.();
    return result;
  };

  ipcMain.handle("studio:narrative-status", () => narrativeService.status(db()));
  ipcMain.handle("studio:narrative-prepare", (_event, input) => mutate(() => narrativeService.prepare(db(), input)));
  ipcMain.handle("studio:narrative-run", (_event, runId) => narrativeService.getRun(db(), runId));
  ipcMain.handle("studio:narrative-request", (_event, runId) => narrativeService.buildRequest(db(), runId));
  ipcMain.handle("studio:narrative-save-draft-response", (_event, input) => mutate(() => narrativeService.saveDraftResponse(db(), input)));
  ipcMain.handle("studio:narrative-generate-draft", (_event, input) => mutateAsync(() => {
    const database = db();
    return narrativeGeneration.generateDraft(narrativeGeneration.userDataPathFromDb(database), database, input);
  }));
  ipcMain.handle("studio:narrative-apply", (_event, runId) => mutate(() => narrativeService.apply(db(), runId)));
  ipcMain.handle("studio:narrative-discard", (_event, runId) => mutate(() => narrativeService.discard(db(), runId)));

  // The deterministic narrative IPC verifier uses a minimal runtime without visual generation.
  // Real Studio runtime exposes generateVisualImage, so the next editorial stage registers there
  // without widening the provider-independent narrative-only test surface.
  if (typeof runtime.generateVisualImage === "function") registerVisualCompletionIpc(ipcMain, runtime);
}

module.exports = { registerNarrativeIpc };
