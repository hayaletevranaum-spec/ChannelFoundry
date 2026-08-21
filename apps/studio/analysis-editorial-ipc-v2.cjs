const { ipcMain } = require("electron");
const aiAnalysis = require("./ai-analysis.cjs");
const support = require("./ai-support-records.cjs");
const runtime = require("./studio-runtime.cjs");

function registerAnalysisEditorialIpc() {
  ipcMain.handle("studio:ai-analysis-editorial", (_event, videoId) => aiAnalysis.editorialPackage(runtime.database(), videoId));
  ipcMain.handle("studio:ai-analysis-editorial-save", (_event, input) => {
    const result = aiAnalysis.editorialSave(runtime.database(), input);
    runtime.refreshMainWindow();
    return result;
  });
  ipcMain.handle("studio:ai-analysis-support-records", () => support.supportRecords(runtime.database()));
}

module.exports = { registerAnalysisEditorialIpc };
