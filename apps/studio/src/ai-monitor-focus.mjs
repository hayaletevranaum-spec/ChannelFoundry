export function selectAiMonitorFocus(input = {}) {
  const mergeState = String(input.mergeState ?? "");
  const videoRemaining = Math.max(0, Number(input.videoRemaining) || 0);
  if (mergeState === "waiting" || mergeState === "running") return "universe";
  if (videoRemaining > 0) return "video";
  return "idle";
}
