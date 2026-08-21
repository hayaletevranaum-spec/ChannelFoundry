import { useEffect, useState } from "react";

function sidebarMessage(status: StudioYtDlpStatus) {
  if (["checking", "downloading", "installing"].includes(status.phase)) return status.message || "yt-dlp işleniyor…";
  if (status.phase === "error" || status.lastError) return status.lastError || status.message || "yt-dlp işlemi başarısız";
  if (status.updateAvailable) return `${status.latestVersion} güncellemesi hazır`;
  if (status.autoUpdate) return status.version ? `Otomatik güncel · ${status.version}` : "Otomatik kurulum bekliyor";
  if (status.autoCheck) return status.version ? `Güncel · ${status.version}` : "Otomatik denetim açık";
  return status.message;
}

export default function YtDlpSidebarStatus() {
  const bridge = window.birdesengorStudio;
  const [status, setStatus] = useState<StudioYtDlpStatus | null>(null);

  const refresh = async () => {
    if (bridge) setStatus(await bridge.ytDlpStatus());
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
    return bridge?.onYtDlpChanged?.(() => { void refresh().catch(() => undefined); });
  }, []);

  const active = status && ["checking", "downloading", "installing"].includes(status.phase);
  if (!bridge || !status || (!status.autoCheck && !status.autoUpdate && !active)) return null;
  const failed = status.phase === "error" || Boolean(status.lastError);
  const tone = failed ? "error" : status.updateAvailable ? "warning" : active ? "working" : "ready";
  return <button className={`ytdlp-sidebar-status ${tone}`} type="button" title="yt-dlp ayarlarını aç" onClick={() => void bridge.navigate("Ayarlar")}>
    <span className="ytdlp-sidebar-dot"/>
    <span><small>YT-DLP</small><strong>{sidebarMessage(status)}</strong></span>
  </button>;
}
