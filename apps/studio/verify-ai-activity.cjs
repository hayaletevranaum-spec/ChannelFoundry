const assert = require("node:assert/strict");
const activity = require("./ai-activity.cjs");

activity._resetForTests();
assert.deepEqual(activity.snapshot(), {
  activeSessionId: null,
  activeModel: "",
  latestModel: "",
  sessions: [],
  selectedSession: null,
});

const session = activity.startSession({
  kind: "analysis",
  key: "analysis:test-video:1",
  title: "Video çözümleme",
  subject: "Test videosu",
  provider: "openai-compatible",
  configuredModel: "model-alias-latest",
  context: { videoId: "test-video" },
});
const request = activity.beginRequest({ sessionId: session.id, label: "Transkripti çözümle" }, {
  provider: "openai-compatible",
  model: "model-alias-latest",
  messages: [
    { role: "system", content: "Yalnız JSON döndür." },
    { role: "user", content: "Test transkripti" },
  ],
  maxTokens: 1200,
  temperature: 0.1,
  json: true,
  reasoningEffort: "high",
});
activity.completeRequest(request, {
  model: "model-version-2026-08-01",
  finishReason: "stop",
  content: '{"title":"Test"}',
});

let live = activity.snapshot({ sessionId: session.id, includeEvents: true });
assert.equal(live.activeSessionId, session.id);
assert.equal(live.activeModel, "model-version-2026-08-01");
assert.equal(live.selectedSession.model, "model-version-2026-08-01");
assert.equal(live.selectedSession.requestCount, 1);
assert.equal(live.selectedSession.responseCount, 1);
assert.equal(live.selectedSession.events.find((event) => event.type === "request").messages[1].content, "Test transkripti");
assert.equal(live.selectedSession.events.find((event) => event.type === "request").settings.reasoningEffort, "high");
assert.equal(live.selectedSession.events.find((event) => event.type === "response").content, '{"title":"Test"}');

activity.finishSession(session.id, { state: "done", detail: "Yerel anlatı dosyası kaydedildi." });
const completed = activity.snapshot({ sessionId: session.id, includeEvents: true });
assert.equal(completed.activeSessionId, null);
assert.equal(completed.latestModel, "model-version-2026-08-01");
assert.equal(completed.selectedSession.state, "done");
assert.equal(completed.selectedSession.events.at(-1).tone, "success");

const failed = activity.startSession({ kind: "universe", key: "universe:9", subject: "9 kaynak video" });
const failedRequest = activity.beginRequest({ sessionId: failed.id, attempt: "fallback" }, {
  provider: "openai-compatible",
  model: "fallback-model",
  messages: [{ role: "user", content: "Birleştir" }],
});
const error = Object.assign(new Error("quota exceeded"), { code: "AI_QUOTA" });
activity.failRequest(failedRequest, error);
activity.finishSession(failed.id, { state: "error", detail: error.message });
const failedSnapshot = activity.snapshot({ sessionId: failed.id, includeEvents: true });
assert.equal(failedSnapshot.selectedSession.fallbackUsed, true);
assert.equal(failedSnapshot.selectedSession.errorCount, 1);
assert.equal(failedSnapshot.selectedSession.events.some((event) => event.code === "AI_QUOTA"), true);

const visual = activity.startSession({
  kind: "visual",
  key: "visual:test-object:1",
  subject: "Düğümlü kitap",
  provider: "codex-cli",
  configuredModel: "gpt-5.6-luna",
  stage: "Görsel hazırlanıyor",
});
assert.equal(visual.kind, "visual");
assert.equal(visual.title, "Görsel üretimi");
const visualRequest = activity.beginRequest({ sessionId: visual.id, label: "Görsel üretim isteği", stage: "Görsel üretiliyor" }, {
  provider: "codex-cli",
  model: "gpt-5.6-luna",
  messages: [{ role: "user", content: "Gizemli, yazısız bir kitap üret." }],
});
activity.completeRequest(visualRequest, {
  model: "gpt-5.6-luna",
  finishReason: "completed",
  content: "Görsel üretildi ve Studio görsel arşivine kaydedildi.",
});
activity.finishSession(visual.id, { state: "done", model: "gpt-5.6-luna", detail: "Düğümlü kitap görseli hazır." });
const visualSnapshot = activity.snapshot({ sessionId: visual.id, includeEvents: true });
assert.equal(visualSnapshot.selectedSession.kind, "visual");
assert.equal(visualSnapshot.selectedSession.state, "done");
assert.equal(visualSnapshot.selectedSession.requestCount, 1);
assert.equal(visualSnapshot.selectedSession.responseCount, 1);
assert.equal(visualSnapshot.selectedSession.events.find((event) => event.type === "request").messages[0].content, "Gizemli, yazısız bir kitap üret.");
assert.equal(visualSnapshot.selectedSession.events.find((event) => event.type === "response").content.includes("Studio görsel arşivine"), true);

import("./src/ai-monitor-focus.mjs").then(({ selectAiMonitorFocus }) => {
  assert.equal(selectAiMonitorFocus({ mergeState: "error", videoRemaining: 1 }), "video", "Aktif video kuyruğu geçmiş Evren Birleştirme hatasının önüne geçmeli");
  assert.equal(selectAiMonitorFocus({ mergeState: "error", videoRemaining: 0 }), "idle", "Geçmiş hata, kuyruk boşken global işlem bildirimi olarak tekrarlanmamalı");
  assert.equal(selectAiMonitorFocus({ mergeState: "running", videoRemaining: 1 }), "universe");
  assert.equal(selectAiMonitorFocus({ mergeState: "done", videoRemaining: 0 }), "idle");
  console.log("AI activity sessions, visual generation, live process priority, real model versions, messages, responses and errors ready");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
