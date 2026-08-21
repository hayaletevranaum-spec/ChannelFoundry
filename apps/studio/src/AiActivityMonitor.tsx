import { useCallback, useEffect, useRef, useState } from "react";
import AiActivityOverlay from "./AiActivityOverlay";
import { useAiWorkbenchStatus, type AiWorkbenchNoticeTone } from "./AiWorkbenchStatus";
import { selectAiMonitorFocus } from "./ai-monitor-focus.mjs";
import "./ai-activity-monitor.css";

type ActivityMode = "idle" | "video" | "universe" | "visual" | "error";

type ActivitySnapshot = {
  mode: ActivityMode;
  title: string;
  detail: string;
  model: string;
  progress: number;
  active: boolean;
  completed: number;
  total: number;
  errors: number;
};

type Props = {
  pipelineError?: string | null;
  summary: {
    errors: number;
    queue: number;
    review: number;
    approved: number;
  };
};

const idleSnapshot: ActivitySnapshot = {
  mode: "idle",
  title: "AI hazır",
  detail: "Video çözümleme, Evrene İşleme veya görsel üretimi başladığında ilerleme burada görünür.",
  model: "",
  progress: 0,
  active: false,
  completed: 0,
  total: 0,
  errors: 0,
};

function number(value: number) {
  return new Intl.NumberFormat("tr-TR").format(Math.max(0, value));
}

function short(value: string, max = 82) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function noticeTitle(tone: AiWorkbenchNoticeTone) {
  if (tone === "success") return "İşlem tamamlandı";
  if (tone === "error") return "İşlem tamamlanamadı";
  return "İşlem bilgisi";
}

function activeModel(config: StudioAiConfig) {
  return config.model || (config.provider === "codex-cli" ? "Codex CLI · varsayılan" : "");
}

export default function AiActivityMonitor({ pipelineError, summary }: Props) {
  const bridge = window.birdesengorStudio;
  const status = useAiWorkbenchStatus();
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>(idleSnapshot);
  const [activitySnapshot, setActivitySnapshot] = useState<StudioAiActivitySnapshot | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const videoBaseline = useRef(0);
  const openOverlay = useCallback(() => setOverlayOpen(true), []);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  useEffect(() => {
    if (!status?.notice) return;
    const timeout = window.setTimeout(status.clear, status.notice.tone === "error" ? 12000 : 7000);
    return () => window.clearTimeout(timeout);
  }, [status?.notice, status?.clear]);

  useEffect(() => {
    if (!bridge) return;
    let canceled = false;

    const poll = async () => {
      try {
        const [videos, stats, universe, config, activity] = await Promise.all([
          bridge.aiAnalysisList(),
          bridge.aiAnalysisStats(),
          bridge.universeMergeStatus(),
          bridge.aiConfig(),
          bridge.aiActivitySnapshot(),
        ]);
        if (canceled) return;
        setActivitySnapshot(activity);

        const activeSession = activity.sessions.find((session) => session.id === activity.activeSessionId);
        const activeSessionModel = activeSession?.model || activeSession?.configuredModel || activity.activeModel;
        const activeSessionKind = String(activeSession?.kind ?? "");

        if (activeSessionKind === "visual") {
          videoBaseline.current = 0;
          setSnapshot({
            mode: "visual",
            title: "Görsel üretimi çalışıyor",
            detail: `${short(activeSession?.subject || "Görsel", 48)} · ${activeSession?.stage || "Görsel hazırlanıyor"}`,
            model: activeSessionModel || activeModel(config),
            progress: 35,
            active: true,
            completed: 0,
            total: 1,
            errors: activeSession?.errorCount || 0,
          });
          return;
        }

        const run = universe.run;
        const remaining = stats.waiting + stats.running;
        const focus = selectAiMonitorFocus({ mergeState: run?.state, videoRemaining: remaining });
        if (run && focus === "universe") {
          const total = Math.max(1, run.totalChunks);
          const completed = Math.min(total, run.doneChunks);
          setSnapshot({
            mode: "universe",
            title: run.state === "running" ? "Evrene İşleme çalışıyor" : "Evrene İşleme sırada",
            detail: `${completed}/${total} parça · seviye ${run.level + 1} · ${run.analysisCount} kaynak video`,
            model: activeSessionKind === "universe" ? activeSessionModel : run.model || activeModel(config),
            progress: Math.max(2, Math.round((completed / total) * 100)),
            active: true,
            completed,
            total,
            errors: run.errorChunks,
          });
          return;
        }

        if (focus === "video") {
          if (!videoBaseline.current || remaining > videoBaseline.current) videoBaseline.current = remaining;
          const running = videos.find((video) => video.jobState === "running");
          const total = Math.max(1, videoBaseline.current);
          const completed = Math.max(0, total - remaining);
          setSnapshot({
            mode: "video",
            title: running ? "Video çözümleme çalışıyor" : "Video çözümleme sırada",
            detail: running ? `${short(running.title)} · ${stats.waiting} bekliyor` : `${stats.waiting} video bekliyor`,
            model: activeSessionKind === "analysis" ? activeSessionModel : activeModel(config),
            progress: Math.max(2, Math.min(98, Math.round((completed / total) * 100))),
            active: true,
            completed,
            total,
            errors: stats.errors,
          });
          return;
        }

        videoBaseline.current = 0;
        setSnapshot({ ...idleSnapshot, model: activeModel(config), errors: stats.errors });
      } catch (error) {
        if (!canceled) setSnapshot({ ...idleSnapshot, mode: "error", title: "AI durum bilgisi okunamadı", detail: error instanceof Error ? error.message : String(error), errors: 1 });
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [bridge]);

  if (!bridge) return null;
  const pct = Math.max(0, Math.min(100, snapshot.progress));
  const snapshotError = snapshot.mode === "error" ? snapshot.detail : null;
  const persistentError = pipelineError || snapshotError;
  const notice = status?.notice;
  const tone = notice?.tone ?? (persistentError ? "error" : snapshot.mode);
  const title = snapshot.active
    ? snapshot.title
    : notice
      ? noticeTitle(notice.tone)
      : snapshotError
        ? snapshot.title
        : pipelineError
          ? "Studio işlemi tamamlanamadı"
          : snapshot.title;
  const detail = notice?.message || persistentError || snapshot.detail;

  return <><section className={`ai-activity panel ${tone}`} aria-label="AI Atölyesi durum ve mesaj alanı" onClick={openOverlay}>
    <div className="ai-activity-main">
      <div className="ai-activity-head">
        <div className="ai-activity-copy" role="status" aria-live="polite">
          <small>İŞLEM VE MESAJ DURUMU</small>
          <strong><i className={snapshot.active ? "pulse" : ""}/>{title}{snapshot.active && <b>{snapshot.mode === "visual" ? "çalışıyor" : `${pct}%`}</b>}</strong>
          <span className={notice?.tone ?? (persistentError ? "error" : "")}>{detail}</span>
        </div>
        <button type="button" className="ai-activity-model" onClick={(event) => { event.stopPropagation(); openOverlay(); }} aria-haspopup="dialog" aria-expanded={overlayOpen} title="AI çalışma günlüğünü aç">
          <span className="ai-activity-model-copy">
            <span className="ai-activity-model-label">AI günlüğünü aç</span>
            <small>{snapshot.model || "İstek ve cevap ayrıntıları"}</small>
          </span>
          <b aria-hidden="true">↗</b>
        </button>
      </div>

      <div className={`ai-activity-progress ${snapshot.active ? "active" : ""}`} role="progressbar" aria-label="AI işlem ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: snapshot.active ? `${pct}%` : notice?.tone === "success" ? "100%" : "0%" }}/>
      </div>

      {snapshot.active && <div className="ai-activity-counts">
        <span><b>{snapshot.completed}</b> tamamlandı</span>
        <span><b>{Math.max(0, snapshot.total - snapshot.completed)}</b> kalan</span>
        {snapshot.errors > 0 && <span className="error"><b>{snapshot.errors}</b> hata</span>}
      </div>}
    </div>

    <div className="ai-activity-summary" aria-label="AI Atölyesi özeti">
      <span className={summary.errors ? "error" : ""}><b>{number(summary.errors)}</b> hata</span>
      <span><b>{number(summary.queue)}</b> kuyruk</span>
      <span><b>{number(summary.review)}</b> inceleme</span>
      <span className="ready"><b>{number(summary.approved)}</b> onaylı</span>
    </div>
    <p className="ai-activity-helper">İstekler, mesajlar ve model cevaplarını görmek için tıkla.</p>
  </section><AiActivityOverlay open={overlayOpen} onClose={closeOverlay} initialSnapshot={activitySnapshot}/></>;
}
