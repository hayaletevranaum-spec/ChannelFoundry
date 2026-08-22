import { useState } from "react";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function YouTubeImport() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<StudioYoutubePreview | null>(null);
  const [busy, setBusy] = useState<"inspect" | "import" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspect = async () => {
    const bridge = window.channelFoundryStudio;
    if (!bridge) return setError("YouTube içe aktarma yalnız Electron Studio içinde kullanılabilir.");
    setBusy("inspect");
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.youtubeInspect({ url });
      setPreview(result);
    } catch (inspectError) {
      setPreview(null);
      setError(errorText(inspectError));
    } finally {
      setBusy(null);
    }
  };

  const importVideo = async () => {
    const bridge = window.channelFoundryStudio;
    if (!bridge) return setError("YouTube içe aktarma yalnız Electron Studio içinde kullanılabilir.");
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.youtubeImport({ url });
      setPreview({ ...result.source, title: result.item.title });
      if (result.imported) {
        setNotice(`“${result.item.title}” arşive Taslak olarak eklendi. Ana Studio penceresi yenilendi.`);
      } else {
        setNotice(`Bu YouTube videosu zaten arşivde: “${result.item.title}”.`);
      }
    } catch (importError) {
      setError(errorText(importError));
    } finally {
      setBusy(null);
    }
  };

  return <main className="youtube-tool">
    <header className="youtube-head">
      <div><small>OTOMASYON / YOUTUBE</small><h1>YouTube'dan içe aktar</h1><p>Bir video bağlantısını yapıştır. Studio başlık, kanal ve kaynak bilgisini alır; kayıt arşive Taslak olarak eklenir.</p></div>
      <span className="youtube-badge">API anahtarı yok</span>
    </header>

    <section className="youtube-panel youtube-form-panel">
      <label htmlFor="youtube-url">YouTube video bağlantısı</label>
      <div className="youtube-url-row">
        <input id="youtube-url" autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setPreview(null); setNotice(null); setError(null); }} placeholder="https://www.youtube.com/watch?v=…"/>
        <button onClick={() => void inspect()} disabled={!url.trim() || busy !== null}>{busy === "inspect" ? "Alınıyor…" : "Bilgiyi getir"}</button>
      </div>
      <p className="youtube-hint">youtube.com/watch, youtu.be, Shorts ve Live bağlantıları kabul edilir.</p>
    </section>

    {error && <div className="youtube-message error">{error}</div>}
    {notice && <div className="youtube-message success">{notice}</div>}

    {preview ? <section className="youtube-panel youtube-preview">
      <div className="youtube-thumb-wrap"><img src={preview.thumbnailUrl} alt="YouTube video küçük resmi"/></div>
      <div className="youtube-preview-copy">
        <small>YOUTUBE KAYNAĞI</small>
        <h2>{preview.title}</h2>
        <p>{preview.channel || "Kanal bilgisi yok"}</p>
        <dl>
          <div><dt>Video ID</dt><dd>{preview.videoId}</dd></div>
          <div><dt>Durum</dt><dd>Taslak olarak eklenecek</dd></div>
        </dl>
        <button className="youtube-import-button" onClick={() => void importVideo()} disabled={busy !== null}>{busy === "import" ? "İçe aktarılıyor…" : "Taslak olarak içe aktar"}</button>
      </div>
    </section> : <section className="youtube-empty">
      <span>01</span><div><strong>Bağlantıyı doğrula</strong><p>Önce video bilgisini getir; ardından arşive ekleme kararını ver.</p></div>
      <span>02</span><div><strong>Studio'da düzenle</strong><p>Özet, bağlam, ilişkiler ve yayın durumu yine senin kontrolünde kalır.</p></div>
    </section>}

    <footer className="youtube-foot">İçe aktarma yalnız yerel SQLite'ı değiştirir. Canlı web, Yayınla ekranından ayrıca yayınlanır.</footer>
  </main>;
}
