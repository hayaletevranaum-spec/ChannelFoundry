const { mergePayload } = require("./universe-ingest-ai.cjs");
const store = require("./universe-merge-store.cjs");
const universeIngest = require("./universe-ingest.cjs");
const aiActivity = require("./ai-activity.cjs");

function resultSources(db, runId) {
  const row = db.prepare("SELECT source_signature AS sourceSignature FROM universe_merge_runs WHERE id=?").get(Number(runId));
  const videoIds = [...new Set(String(row?.sourceSignature ?? "").split("|").map((value) => value.trim()).filter(Boolean))];
  let metadata = null;
  try {
    metadata = db.prepare("SELECT title, published_at AS publishedAt FROM youtube_videos WHERE video_id=?");
  } catch {}
  return videoIds.map((videoId) => {
    const entry = metadata?.get(videoId) ?? {};
    return { videoId, title: String(entry.title ?? ""), publishedAt: String(entry.publishedAt ?? "") };
  }).sort((left, right) => {
    if (!left.publishedAt && right.publishedAt) return 1;
    if (left.publishedAt && !right.publishedAt) return -1;
    return left.publishedAt.localeCompare(right.publishedAt) || left.videoId.localeCompare(right.videoId);
  });
}

function latestResult(db, runId = null) {
  const result = store.latestResult(db, runId);
  return result ? { ...result, sources: resultSources(db, result.id) } : null;
}

function importedRun(db, runId) {
  try {
    return Boolean(db.prepare("SELECT 1 AS ok FROM universe_workspace_imports WHERE run_id=?").get(Number(runId)));
  } catch {
    return false;
  }
}

function cancelLatest(db) {
  store.ensureSchema(db);
  const row = db.prepare("SELECT id, state FROM universe_merge_runs ORDER BY id DESC LIMIT 1").get();
  if (!row) return { canceled: 0, runId: null };
  const runId = Number(row.id);
  if (["waiting", "running"].includes(String(row.state))) return store.cancelActive(db);
  const ingest = db.prepare("SELECT state FROM universe_ingest_runs WHERE run_id=?").get(runId);
  if (ingest?.state === "applied" || importedRun(db, runId)) {
    throw new Error(`Çalışma #${runId} zaten 04 · İnceleme alanına aktarıldı. Uygulanmış Evren verisi bu ekrandan geri alınamaz.`);
  }
  if (!["done", "error"].includes(String(row.state))) return { canceled: 0, runId: null };
  let canceled = 0;
  db.exec("BEGIN IMMEDIATE;");
  try {
    universeIngest.discardRun(db, runId);
    db.prepare("DELETE FROM universe_merge_chunks WHERE run_id=?").run(runId);
    const removed = db.prepare("DELETE FROM universe_merge_runs WHERE id=? AND state IN ('done','error')").run(runId);
    canceled = Number(removed.changes);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { canceled, runId: canceled ? runId : null };
}

async function processNext(db, userDataPath, options = {}) {
  const job = store.claimNext(db);
  if (!job) return store.status(db);
  const run = store.status(db, job.runId).run;
  const activitySession = aiActivity.startSession({
    kind: "universe",
    key: `universe:${job.runId}`,
    title: `Evrene İşleme · Çalışma #${job.runId}`,
    subject: run ? `${run.analysisCount} seçilmiş kaynak video` : "Evren kaynakları",
    configuredModel: run?.model || "",
    stage: "Evrene işleme hazırlanıyor",
    message: run ? `${run.analysisCount} yeni veya değişmiş kaynak parçalara ayrıldı.` : "Evrene işleme çalışması hazırlanıyor.",
    context: { runId: job.runId, analysisCount: run?.analysisCount ?? 0 },
  });
  if (job.idle) {
    const next = store.advance(db, job.runId);
    if (!next.run || next.run.state === "done") aiActivity.finishSession(activitySession.id, {
      state: "done",
      model: next.run?.model,
      detail: "Evrene işleme sonucu tamamlandı ve editoryal çalışma alanına uygulanmaya hazır.",
    });
    else if (next.run.state === "error") aiActivity.finishSession(activitySession.id, {
      state: "error",
      detail: next.run.error || "Evrene işleme tamamlanamadı.",
    });
    return next;
  }
  const stage = `Seviye ${job.level + 1} · Parça ${job.batchIndex + 1}`;
  aiActivity.note(activitySession.id, "Seçilmiş hikâye, muhatap, olay, mekân ve nesne malzemeleri sırayla işlenecek.", { stage });
  try {
    const merged = await mergePayload(userDataPath, job.input, job.level, {
      signal: options.signal,
      activity: { sessionId: activitySession.id, stage },
    });
    store.completeChunk(db, job, merged);
    const next = store.advance(db, job.runId);
    if (!next.run || next.run.state === "done") aiActivity.finishSession(activitySession.id, {
      state: "done",
      model: merged.model,
      detail: "Tüm yeni kaynaklar işlendi; değişiklikler editoryal incelemeye hazır.",
    });
    else if (next.run.state === "error") aiActivity.finishSession(activitySession.id, {
      state: "error",
      model: merged.model,
      detail: next.run.error || "Evrene işleme tamamlanamadı.",
    });
    else aiActivity.note(activitySession.id, `${next.run.doneChunks}/${next.run.totalChunks} parça tamamlandı; sıradaki parça hazırlanıyor.`, {
      stage: "Parça tamamlandı",
      model: merged.model,
      tone: "success",
    });
    return next;
  } catch (error) {
    if (error?.code !== "AI_REQUEST_CANCELED") {
      store.failChunk(db, job, error);
      aiActivity.finishSession(activitySession.id, {
        state: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    } else {
      aiActivity.finishSession(activitySession.id, {
        state: "canceled",
        detail: "Evrene İşleme kullanıcı tarafından durduruldu.",
      });
    }
    throw error;
  }
}

module.exports = {
  ensureSchema: store.ensureSchema,
  cancelActive: cancelLatest,
  cancelLatest,
  resetInterrupted: store.resetInterrupted,
  start: store.start,
  status: store.status,
  latestResult,
  processNext,
};
