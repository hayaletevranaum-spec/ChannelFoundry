const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const service = require("./transcript-service.cjs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE content_items (
    key TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL
  ) STRICT;
  INSERT INTO content_items (key, id, kind, title, status)
  VALUES ('video:test', 'test', 'video', 'Test Video', 'draft');
`);

const plain = service.vttToPlainText(`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nMerhaba &amp; hoş geldiniz.\n\n00:00:02.000 --> 00:00:04.000\n<c>Merhaba &amp; hoş geldiniz.</c>\nYeni satır.\n`);
assert.equal(plain, "Merhaba & hoş geldiniz.\nYeni satır.");

const manualArgs = service.subtitleAttemptArgs({
  outputTemplate: "/tmp/%(id)s.%(ext)s",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  automatic: false,
});
assert.ok(manualArgs.includes("--write-subs"));
assert.ok(!manualArgs.includes("--write-auto-subs"));
assert.equal(manualArgs[manualArgs.indexOf("--sub-langs") + 1], "tr,en");
assert.ok(!manualArgs.some((value) => String(value).includes("tr.*") || String(value).includes("en.*")));

const automaticArgs = service.subtitleAttemptArgs({
  outputTemplate: "/tmp/%(id)s.%(ext)s",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  automatic: true,
});
assert.ok(automaticArgs.includes("--write-auto-subs"));
assert.ok(!automaticArgs.includes("--write-subs"));
assert.equal(automaticArgs[automaticArgs.indexOf("--sub-langs") + 1], "tr,en");

const germanArgs = service.subtitleAttemptArgs({
  outputTemplate: "/tmp/%(id)s.%(ext)s",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  automatic: false,
  languages: ["de", "tr"],
});
assert.equal(germanArgs[germanArgs.indexOf("--sub-langs") + 1], "de,tr");
assert.equal(service.chooseSubtitleFile(["video.tr.vtt", "video.de.vtt"], ["de", "tr"]), "video.de.vtt");

const rateLimitMessage = service.subtitleFailureMessage([{ stderr: "HTTP Error 429: Too Many Requests", stdout: "", error: null }]);
assert.match(rateLimitMessage, /429/);

const saved = service.saveTranscript(db, {
  contentKey: "video:test",
  source: "manual",
  language: "tr",
  text: plain,
});
assert.equal(saved.wordCount, 6);
assert.equal(saved.source, "manual");
assert.equal(service.getTranscript(db, "video:test").text, plain);
assert.equal(service.deleteTranscript(db, "video:test").deleted, true);
assert.equal(service.getTranscript(db, "video:test"), null);

const sourceSaved = service.saveSourceTranscript(db, {
  videoId: "abcdefghijk",
  source: "youtube",
  language: "tr",
  text: "Kaynak arşivindeki video editoryal kayda dönüşmeden de altyazı saklayabilir.",
});
assert.equal(sourceSaved.videoId, "abcdefghijk");
assert.equal(sourceSaved.source, "youtube");
assert.equal(service.getTranscript(db, "abcdefghijk").videoId, "abcdefghijk");
assert.equal(service.deleteTranscript(db, "abcdefghijk").deleted, true);
assert.equal(service.getTranscript(db, "abcdefghijk"), null);

console.log("transcript archive contracts ready");
