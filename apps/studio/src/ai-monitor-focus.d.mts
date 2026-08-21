export type AiMonitorFocus = "idle" | "video" | "universe";

export function selectAiMonitorFocus(input?: {
  mergeState?: string | null;
  videoRemaining?: number;
}): AiMonitorFocus;
