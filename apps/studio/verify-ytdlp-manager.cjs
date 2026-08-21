const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const manager = require("./ytdlp-manager.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-ytdlp-settings-"));

(async () => {
  try {
    manager.configure(root, () => undefined);
    assert.deepEqual(manager.mediaOptions(), {
      metadataLanguage: "tr",
      subtitleLanguages: ["tr", "en"],
      thumbnailSize: "standard",
    });
    await manager.saveOptions({
      metadataLanguage: "original",
      subtitleLanguages: ["de", "tr", "de"],
      thumbnailSize: "large",
    });
    assert.deepEqual(manager.mediaOptions(), {
      metadataLanguage: "original",
      subtitleLanguages: ["de", "tr"],
      thumbnailSize: "large",
    });
    await manager.saveOptions({ metadataLanguage: "invalid language", subtitleLanguages: ["*"], thumbnailSize: "giant" });
    assert.deepEqual(manager.mediaOptions(), {
      metadataLanguage: "tr",
      subtitleLanguages: ["tr", "en"],
      thumbnailSize: "standard",
    });
    console.log("yt-dlp media preferences ready");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
