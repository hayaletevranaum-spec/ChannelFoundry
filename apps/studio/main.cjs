const { app, BrowserWindow, Menu, safeStorage } = require("electron");
const path = require("node:path");
const { configureElectronDataPaths } = require("./studio-data-paths.cjs");

configureElectronDataPaths(app);

const aiAnalysis = require("./ai-analysis.cjs");
const universeMerge = require("./universe-merge.cjs");
const communityAdmin = require("./community-admin.cjs");
const webConnection = require("./web-connection.cjs");
const ytDlpManager = require("./ytdlp-manager.cjs");
const runtime = require("./studio-runtime.cjs");
const { registerStudioIpc } = require("./studio-ipc.cjs");
const { registerAnalysisEditorialIpc } = require("./analysis-editorial-ipc.cjs");
const { registerUniverseMaintenanceIpc } = require("./universe-maintenance-ipc.cjs");

function windowPreferences() {
  return {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function loadRenderer(window) {
  const devServerUrl = process.env.BIRDESENGOR_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
    return;
  }
  window.loadFile(path.join(__dirname, "dist", "index.html"));
}

function createWindow() {
  const studioIcon = path.join(__dirname, "..", "..", "logo.png");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#0b0d11",
    title: "BirDeSenGör Studio",
    icon: studioIcon,
    autoHideMenuBar: true,
    webPreferences: windowPreferences(),
  });
  runtime.setMainWindow(window);
  window.setMenuBarVisibility(false);
  window.maximize();
  window.on("closed", () => runtime.setMainWindow(null));
  loadRenderer(window);
  return window;
}

app.whenReady().then(() => {
  webConnection.configure(app.getPath("userData"));
  communityAdmin.configureCredentialStorage(app.getPath("userData"), safeStorage);
  ytDlpManager.configure(app.getPath("userData"), runtime.notifyYtDlpChanged);
  void communityAdmin.connectStored();
  registerStudioIpc();
  registerAnalysisEditorialIpc();
  registerUniverseMaintenanceIpc();
  runtime.database();
  aiAnalysis.resetInterrupted(runtime.database());
  universeMerge.resetInterrupted(runtime.database());
  Menu.setApplicationMenu(null);
  createWindow();
  ytDlpManager.startAutomaticTasks();
  setTimeout(() => { void runtime.processAnalysisQueue(); }, 1800);
  setTimeout(() => { void runtime.processUniverseQueue(); }, 2400);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
