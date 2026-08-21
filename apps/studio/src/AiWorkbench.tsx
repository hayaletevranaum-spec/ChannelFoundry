import { lazy, Suspense, useEffect, useState } from "react";
import AiActivityMonitor from "./AiActivityMonitor";
import { AiWorkbenchStatusProvider } from "./AiWorkbenchStatus";
import VideoAnalysisWorkbench from "./VideoAnalysisWorkbench";
import AnalysisCurationWorkbench from "./AnalysisCurationWorkbench";
import IncrementalUniverseWorkbench from "./IncrementalUniverseWorkbench";
import EditorialReviewWorkspace from "./EditorialReviewWorkspace";
import "./universe-workbench.css";

const NarrativeWorkbench = lazy(() => import("./NarrativeWorkbench"));
const VisualCompletionWorkbench = lazy(() => import("./VisualCompletionWorkbench"));

type WorkbenchMode = "videos" | "curation" | "universe" | "review" | "narrative" | "visuals";
type ReviewMode = "records" | "revisions";
type EditorialStats = StudioAiAnalysisStats & { editorialPending?: number; curated?: number; excluded?: number };
type WorkspaceCountsWithRevisions = StudioUniverseWorkspaceStatus["counts"] & { pendingRevisions?: number };
type UniverseMergeWithIngest = StudioUniverseMergeStatus & {
  ingest?: {
    pending?: number;
    processed?: number;
    awaitingApplyRunId?: number | null;
    backlog?: { total?: number };
  };
};
type WorkbenchBridge = NonNullable<typeof window.birdesengorStudio> & StudioNarrativeBridge & StudioVisualCompletionBridge;

function number(value: number) { return new Intl.NumberFormat("tr-TR").format(Math.max(0, value)); }

export default function AiWorkbench({ pipelineError = null }: { pipelineError?: string | null }) {
  const bridge = window.birdesengorStudio as WorkbenchBridge | undefined;
  const [mode, setMode] = useState<WorkbenchMode>("videos");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("records");
  const [stats, setStats] = useState<EditorialStats>({ transcripts: 0, analyzed: 0, waiting: 0, running: 0, errors: 0 });
  const [merge, setMerge] = useState<UniverseMergeWithIngest | null>(null);
  const [workspace, setWorkspace] = useState<StudioUniverseWorkspaceStatus | null>(null);
  const [narrative, setNarrative] = useState<StudioNarrativeStatus | null>(null);
  const [visuals, setVisuals] = useState<StudioVisualCompletionStatus | null>(null);

  const loadSummary = async () => {
    if (!bridge) return;
    const [nextStats, nextMerge, nextWorkspace, nextNarrative, nextVisuals] = await Promise.all([
      bridge.aiAnalysisStats(),
      bridge.universeMergeStatus(),
      bridge.universeWorkspaceStatus(),
      bridge.narrativeStatus(),
      bridge.visualCompletionStatus(),
    ]);
    setStats(nextStats as EditorialStats);
    setMerge(nextMerge as UniverseMergeWithIngest);
    setWorkspace(nextWorkspace);
    setNarrative(nextNarrative);
    setVisuals(nextVisuals);
  };

  useEffect(() => {
    void loadSummary().catch(() => undefined);
    return bridge?.onDataChanged?.(() => { void loadSummary().catch(() => undefined); });
  }, []);

  const openReview = (next: ReviewMode) => { setReviewMode(next); setMode("review"); };
  const videoQueue = stats.waiting + stats.running;
  const editorialPending = stats.editorialPending ?? 0;
  const curated = stats.curated ?? 0;
  const mergeState = merge?.run?.state ?? "idle";
  const pendingSources = merge?.ingest?.pending ?? merge?.availableAnalyses ?? 0;
  const processedSources = merge?.ingest?.processed ?? 0;
  const awaitingApply = Boolean(merge?.ingest?.awaitingApplyRunId);
  const editorialBacklog = merge?.ingest?.backlog?.total ?? 0;
  const workspaceCounts = workspace?.counts as WorkspaceCountsWithRevisions | undefined;
  const reviewCount = workspaceCounts?.draft ?? 0;
  const revisionCount = workspaceCounts?.pendingRevisions ?? 0;
  const approvedCount = workspaceCounts?.approved ?? 0;
  const universeWaiting = ["waiting", "running"].includes(mergeState) || pendingSources > 0 || awaitingApply || editorialBacklog > 0;
  const narrativeChanges = (narrative?.next.changes ?? 0) + (narrative?.next.removed ?? 0);
  const narrativeState = narrative?.workingRun?.run.state ?? "";
  const narrativeDrafts = narrative?.workingRun?.drafts.length ?? 0;
  const narrativeActive = narrative?.counts.activeSections ?? 0;
  const narrativeReviewCount = narrativeState === "prepared" ? narrativeDrafts : 0;
  const visualPending = visuals?.counts.scenePending ?? 0;
  const visualReady = (visuals?.counts.sceneReady ?? 0) + (visuals?.counts.sceneSkipped ?? 0);
  const visualSections = visuals?.counts.sections ?? 0;

  return <AiWorkbenchStatusProvider><div className="ai-workbench-shell ai-production-workbench">
    <AiActivityMonitor pipelineError={pipelineError} summary={{ errors: stats.errors, queue: videoQueue, review: editorialPending + reviewCount + revisionCount + narrativeReviewCount, approved: approvedCount }}/>
    <nav className="ai-stage-rail" aria-label="AI Atölyesi üretim aşamaları">
      <button className={mode === "videos" ? "active" : ""} onClick={() => setMode("videos")}><span>01</span><div><small>VİDEO</small><strong>Çözümleme</strong><p>{number(stats.analyzed)} tamam · {number(videoQueue)} kuyruk</p></div><i className={stats.errors ? "error" : videoQueue ? "waiting" : stats.analyzed ? "done" : "quiet"}/></button>
      <button className={mode === "curation" ? "active" : ""} onClick={() => setMode("curation")}><span>02</span><div><small>EDİTORYAL</small><strong>Ayıklama</strong><p>{number(editorialPending)} bekliyor · {number(curated)} ayıklandı</p></div><i className={editorialPending ? "waiting" : curated ? "done" : "quiet"}/></button>
      <button className={mode === "universe" ? "active" : ""} onClick={() => setMode("universe")}><span>03</span><div><small>EVREN</small><strong>Evrene İşleme</strong><p>{number(pendingSources)} yeni kaynak · {number(processedSources)} işlenmiş</p></div><i className={mergeState === "error" ? "error" : universeWaiting ? "waiting" : processedSources ? "done" : "quiet"}/></button>
      <button className={mode === "review" ? "active" : ""} onClick={() => openReview("records")}><span>04</span><div><small>EVREN</small><strong>İnceleme</strong><p>{number(reviewCount)} yeni kayıt · {number(revisionCount)} revizyon</p></div><i className={reviewCount + revisionCount ? "waiting" : approvedCount ? "done" : "quiet"}/></button>
      <button className={mode === "narrative" ? "active" : ""} onClick={() => setMode("narrative")}><span>05</span><div><small>ANLATI</small><strong>Hikâyeleştir</strong><p>{narrativeState === "stale" ? "Evren değişti · yeniden hazırla" : narrativeDrafts ? `${number(narrativeDrafts)} taslak incelemede` : narrativeChanges ? `${number(narrativeChanges)} değişiklik bekliyor` : `${number(narrativeActive)} bölüm güncel`}</p></div><i className={narrativeState === "stale" ? "error" : narrativeState === "prepared" || narrativeChanges ? "waiting" : narrativeActive ? "done" : "quiet"}/></button>
      <button className={mode === "visuals" ? "active" : ""} onClick={() => setMode("visuals")}><span>06</span><div><small>GÖRSEL</small><strong>Tamamlama</strong><p>{visualSections ? visualPending ? `${number(visualPending)} sahne bekliyor` : `${number(visualReady)} sahne kararı hazır` : "Onaylı anlatı bekleniyor"}</p></div><i className={visualPending ? "waiting" : visualSections ? "done" : "quiet"}/></button>
    </nav>
    <div className="ai-stage-content">
      <Suspense fallback={<div className="panel universe-empty"><span>{mode === "visuals" ? "06 · GÖRSEL TAMAMLAMA" : "05 · HİKÂYELEŞTİR"}</span><h3>Çalışma alanı hazırlanıyor…</h3></div>}>
        {mode === "videos" ? <VideoAnalysisWorkbench/> : mode === "curation" ? <AnalysisCurationWorkbench/> : mode === "universe" ? <IncrementalUniverseWorkbench/> : mode === "review" ? <EditorialReviewWorkspace initialMode={reviewMode} onReadyForUniverse={() => setMode("universe")}/> : mode === "narrative" ? <NarrativeWorkbench/> : <VisualCompletionWorkbench/>}
      </Suspense>
    </div>
  </div></AiWorkbenchStatusProvider>;
}
