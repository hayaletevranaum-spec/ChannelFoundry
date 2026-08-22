import { useEffect, useState } from "react";

const languages = [
  ["tr", "Türkçe"], ["en", "İngilizce"], ["de", "Almanca"], ["fr", "Fransızca"],
  ["es", "İspanyolca"], ["ar", "Arapça"], ["ru", "Rusça"],
] as const;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string) {
  if (!value) return "Henüz denetlenmedi";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function sourceLabel(status: StudioYtDlpStatus) {
  if (!status.available) return "Kurulu değil";
  return status.source === "managed" ? "Studio tarafından yönetiliyor" : "Sistem kurulumu";
}

export default function YtDlpSettings() {
  const bridge = window.channelFoundryStudio;
  const [status, setStatus] = useState<StudioYtDlpStatus | null>(null);
  const [action, setAction] = useState<"options" | "check" | "install" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    if (!bridge) return;
    setStatus(await bridge.ytDlpStatus());
  };

  useEffect(() => {
    void refresh().catch((reason) => setError(errorText(reason)));
    return bridge?.onYtDlpChanged?.(() => { void refresh().catch(() => undefined); });
  }, []);

  const saveOptions = async (autoCheck: boolean, autoUpdate: boolean) => {
    if (!bridge) return;
    setAction("options");
    setError("");
    setNotice("");
    try {
      setStatus(await bridge.ytDlpSaveOptions({ autoCheck, autoUpdate }));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setAction("");
    }
  };

  const saveMediaOptions = async (next: Partial<Pick<StudioYtDlpStatus, "metadataLanguage" | "subtitleLanguages" | "thumbnailSize">>) => {
    if (!bridge || !status) return;
    setAction("options");
    setError("");
    setNotice("");
    try {
      const updated = await bridge.ytDlpSaveOptions({
        metadataLanguage: next.metadataLanguage ?? status.metadataLanguage,
        subtitleLanguages: next.subtitleLanguages ?? status.subtitleLanguages,
        thumbnailSize: next.thumbnailSize ?? status.thumbnailSize,
      });
      setStatus(updated);
      setNotice("İçerik tercihleri kaydedildi. Başlık ve thumbnail değişiklikleri sonraki kanal senkronizasyonunda uygulanır.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setAction("");
    }
  };

  const run = async (kind: "check" | "install") => {
    if (!bridge) return;
    setAction(kind);
    setError("");
    setNotice("");
    try {
      setStatus(kind === "check" ? await bridge.ytDlpCheck() : await bridge.ytDlpInstall());
    } catch (reason) {
      setError(errorText(reason));
      await refresh().catch(() => undefined);
    } finally {
      setAction("");
    }
  };

  if (!bridge) return null;
  const phaseBusy = status ? ["checking", "downloading", "installing"].includes(status.phase) : false;
  const busy = Boolean(action) || phaseBusy;
  const installLabel = !status?.available ? "yt-dlp kur" : status.updateAvailable ? "Güncelle" : "Sürümü yenile";
  const stateLabel = status?.phase === "error" || status?.lastError
    ? "İşlem hatası"
    : status?.updateAvailable
      ? "Güncelleme hazır"
      : status?.available
        ? "Kullanıma hazır"
        : "Kurulum gerekli";
  const subtitleLanguages = status?.subtitleLanguages?.length ? status.subtitleLanguages : ["tr", "en"];
  const primarySubtitle = subtitleLanguages[0] || "tr";
  const fallbackSubtitle = subtitleLanguages[1] || "";

  return <section className="panel ytdlp-settings">
    <header className="ytdlp-settings-head">
      <div><small>YOUTUBE ARAÇLARI</small><h2>yt-dlp yönetimi</h2></div>
      <span className={`ytdlp-state ${status?.phase === "error" || status?.lastError ? "error" : status?.updateAvailable ? "warning" : status?.available ? "ready" : ""}`}>
        <span className="local-dot"/>{stateLabel}
      </span>
    </header>
    <p>Video kataloğu ve altyazı işlemlerinde kullanılan aracı Windows veya Linux üzerinde Studio içinden kurup günceller.</p>

    <div className="ytdlp-facts">
      <div><span>Platform</span><strong>{status?.platform || "Algılanıyor…"}</strong></div>
      <div><span>Kurulum</span><strong>{status ? sourceLabel(status) : "Algılanıyor…"}</strong></div>
      <div><span>Mevcut sürüm</span><strong>{status?.version || "—"}</strong></div>
      <div><span>Son sürüm</span><strong>{status?.latestVersion || "Denetlenmedi"}</strong></div>
      <div className="wide"><span>Son denetim</span><strong>{formatDate(status?.lastCheckedAt || "")}</strong></div>
    </div>

    <fieldset className="ytdlp-media-group" disabled={busy || !status}>
      <legend>İÇERİK TERCİHLERİ</legend>
      <label>
        <span>Video başlığı / metadata dili<small>YouTube’da Türkçe çeviri varsa katalogda Türkçe başlık kullanılır.</small></span>
        <select value={status?.metadataLanguage || "tr"} onChange={(event) => void saveMediaOptions({ metadataLanguage: event.target.value })}>
          <option value="tr">Türkçe</option>
          <option value="original">Videonun özgün dili</option>
          {languages.filter(([code]) => code !== "tr").map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Thumbnail boyutu<small>Büyük görsel bulunamazsa Studio bir alt boyuta güvenli biçimde döner.</small></span>
        <select value={status?.thumbnailSize || "standard"} onChange={(event) => void saveMediaOptions({ thumbnailSize: event.target.value as StudioYtDlpStatus["thumbnailSize"] })}>
          <option value="small">Kompakt · 320×180</option>
          <option value="standard">Standart · 480×360</option>
          <option value="large">Büyük · 1280×720’ye kadar</option>
        </select>
      </label>
      <label>
        <span>Öncelikli altyazı dili<small>Manuel altyazı önce, otomatik altyazı ikinci aşamada aranır.</small></span>
        <select value={primarySubtitle} onChange={(event) => void saveMediaOptions({ subtitleLanguages: [event.target.value, fallbackSubtitle].filter(Boolean) })}>
          {languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Yedek altyazı dili<small>Öncelikli dil bulunamadığında bu dil denenir.</small></span>
        <select value={fallbackSubtitle} onChange={(event) => void saveMediaOptions({ subtitleLanguages: [primarySubtitle, event.target.value].filter(Boolean) })}>
          <option value="">Yedek dil kullanma</option>
          {languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
    </fieldset>

    <fieldset className="ytdlp-option-group" disabled={busy || !status?.supported}>
      <legend>OTOMASYON</legend>
      <label>
        <input type="checkbox" checked={Boolean(status?.autoCheck)} onChange={(event) => void saveOptions(event.target.checked, event.target.checked ? Boolean(status?.autoUpdate) : false)}/>
        <span><strong>Otomatik güncelleme kontrolü</strong><small>Studio açıldığında ve günlük aralıkla yeni sürümü denetler.</small></span>
      </label>
      <label>
        <input type="checkbox" checked={Boolean(status?.autoUpdate)} onChange={(event) => void saveOptions(event.target.checked || Boolean(status?.autoCheck), event.target.checked)}/>
        <span><strong>Otomatik güncelle</strong><small>Yeni sürüm bulunduğunda doğrulayıp yerel araç klasörüne kurar.</small></span>
      </label>
    </fieldset>

    {(status?.message || error || notice || status?.lastError) && <div className={`ytdlp-notice ${error || status?.phase === "error" || status?.lastError ? "error" : ""}`}>
      {error || notice || status?.message || status?.lastError}
    </div>}
    {status && !status.supported && <div className="ytdlp-notice error">Yönetilen kurulum bu platformda desteklenmiyor. Windows ile Linux x64/arm64 desteklenir.</div>}

    <div className="ytdlp-actions">
      <button className="secondary-button" type="button" disabled={busy || !status?.supported} onClick={() => void run("check")}>
        {action === "check" || status?.phase === "checking" ? "Denetleniyor…" : "Güncellemeyi denetle"}
      </button>
      <button className="primary-button" type="button" disabled={busy || !status?.supported} onClick={() => void run("install")}>
        {action === "install" || status?.phase === "downloading" || status?.phase === "installing" ? "Kuruluyor…" : installLabel}
      </button>
    </div>
    <p className="ytdlp-footnote">Kurulum sistem dizinlerini değiştirmez; araç Studio’nun yerel veri alanında tutulur ve resmî SHA-256 özetiyle doğrulanır.</p>
  </section>;
}
