const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webConnection = require("./web-connection.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-web-connection-"));
try {
  webConnection.configure(root);
  assert.equal(webConnection.getConfig().url, webConnection.DEFAULT_WEB_URL);
  assert.equal(webConnection.normalizeWebUrl("example.com/"), "https://example.com");
  assert.equal(webConnection.normalizeWebUrl("http://localhost:5173/preview/"), "http://localhost:5173/preview");
  assert.throws(() => webConnection.normalizeWebUrl("http://example.com"), /HTTPS/);
  assert.throws(() => webConnection.normalizeWebUrl("file:///tmp/site"), /HTTP/);
  assert.equal(webConnection.normalizeYoutubeChannelUrl("youtube.com/@Example/videos"), "https://www.youtube.com/@Example");
  assert.throws(() => webConnection.normalizeYoutubeChannelUrl("https://example.com/@Example"), /YouTube/);

  const saved = webConnection.saveConfig({
    url: "https://example.com/channel-foundry/",
    youtubeChannelUrl: "https://www.youtube.com/@Example/videos",
  });
  assert.equal(saved.url, "https://example.com/channel-foundry");
  assert.equal(saved.youtubeChannelUrl, "https://www.youtube.com/@Example");
  assert.equal(saved.endpoints.community, "https://example.com/channel-foundry/api/community/");
  assert.equal(saved.endpoints.studio, "https://example.com/channel-foundry/api/studio/");
  assert.equal(saved.endpoints.publicationAsset, "https://example.com/channel-foundry/api/studio/asset.php");
  assert.equal(saved.endpoints.publication, "https://example.com/channel-foundry/content/publication.json");
  assert.equal(webConnection.youtubeChannelUrl(), "https://www.youtube.com/@Example");
  // production default boş olmalı
  assert.equal(webConnection.DEFAULT_YOUTUBE_CHANNEL_URL, "");
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "channel-foundry-web-connection-empty-"));
  try {
    webConnection.configure(emptyRoot);
    assert.equal(webConnection.youtubeChannelUrl(), "");
    assert.equal(webConnection.getConfig().youtubeChannelUrl, "");
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    webConnection.configure(root);
  }
  assert.equal(fs.statSync(path.join(root, "web-connection.json")).mode & 0o777, 0o600);
  console.log("custom web connection configuration ready");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
