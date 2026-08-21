export const ANALYSIS_PAGE_SIZE = 50;
export type AnalysisFilter = "all" | "pending" | "ready" | "queued" | "error";

export function analysisErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function formatVideoDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function formatVideoDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("tr-TR").format(date);
}

export function analysisStateLabel(video: StudioAiAnalysisVideo) {
  if (video.jobState === "running") return "Analiz ediliyor";
  if (video.jobState === "waiting") return "Bekliyor";
  if (video.jobState === "error") return "Hata";
  if (video.hasAnalysis) return "Analiz hazır";
  return "Hazır";
}
