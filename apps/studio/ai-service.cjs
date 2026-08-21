const config = require("./ai-config.cjs");
const client = require("./ai-client.cjs");
const content = require("./ai-content.cjs");
const analysisContent = require("./ai-analysis-content.cjs");
const image = require("./ai-image.cjs");
const quickstart = require("./gemini-quickstart.cjs");
const cli = require("./ai-cli.cjs");

// Stable public facade for Electron IPC and existing verification scripts.
module.exports = {
  DEFAULT_CONFIG: config.DEFAULT_CONFIG,
  getConfig: config.getConfig,
  getSecret: config.getSecret,
  saveConfig: config.saveConfig,
  listModels: client.listModels,
  listImageModels: image.listImageModels,
  testConnection: client.testConnection,
  cliStatus: cli.status,
  suggestContent: content.suggestContent,
  analyzeTranscript: analysisContent.analyzeTranscript,
  detectImageCapability: image.detectImageCapability,
  generateImage: image.generateImage,
  normalizeEndpoint: config.normalizeEndpoint,
  normalizeTimeoutSeconds: config.normalizeTimeoutSeconds,
  parseAssistantJson: client.parseAssistantJson,
  compactTranscript: content.compactTranscript,
  parseGoogleAiStudioQuickstart: quickstart.parseGoogleAiStudioQuickstart,
  visualProfile: content.visualProfile,
};
