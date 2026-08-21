const visualCompletion = require("./visual-completion-store.cjs");

function registerVisualCompletionIpc(ipcMain, runtime) {
  if (!ipcMain?.handle) throw new Error("Görsel Tamamlama IPC için ipcMain.handle gerekli.");
  if (!runtime?.database) throw new Error("Görsel Tamamlama IPC için Studio runtime database erişimi gerekli.");
  const db = () => runtime.database();

  ipcMain.handle("studio:visual-completion-status", () => visualCompletion.status(db()));
  ipcMain.handle("studio:visual-completion-set-scene-state", (_event, input) => {
    const result = visualCompletion.setSceneState(db(), input);
    runtime.refreshMainWindow?.();
    return result;
  });
}

module.exports = { registerVisualCompletionIpc };
