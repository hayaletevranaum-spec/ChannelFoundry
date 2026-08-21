const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webConnection = require("./web-connection.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-web-connection-"));
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
    url: "https://example.com/birdesengor/",
    youtubeChannelUrl: "https://www.youtube.com/@Example/videos",
  });
  assert.equal(saved.url, "https://example.com/birdesengor");
  assert.equal(saved.youtubeChannelUrl, "https://www.youtube.com/@Example");
  assert.equal(saved.endpoints.community, "https://example.com/birdesengor/api/community/");
  assert.equal(saved.endpoints.studio, "https://example.com/birdesengor/api/studio/");
  assert.equal(saved.endpoints.visual, "https://example.com/birdesengor/api/studio/visual.php");
  assert.equal(saved.endpoints.publicContent, "https://example.com/birdesengor/content/universe.json");
  assert.equal(fs.statSync(path.join(root, "web-connection.json")).mode & 0o777, 0o600);
  console.log("custom web connection configuration ready");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
