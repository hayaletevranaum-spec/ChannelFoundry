const { app, ipcMain } = require("electron");
const runtime = require("./studio-runtime.cjs");
const maintenance = require("./universe-maintenance.cjs");

function registerUniverseMaintenanceIpc() {
  ipcMain.handle("studio:universe-maintenance-status", () => maintenance.status(runtime.database()));
  ipcMain.handle("studio:universe-maintenance-reset", (_event, input) => {
    const result = maintenance.reset(runtime.database(), app.getPath("userData"), input);
    runtime.refreshMainWindow();
    return result;
  });
}

module.exports = { registerUniverseMaintenanceIpc };
