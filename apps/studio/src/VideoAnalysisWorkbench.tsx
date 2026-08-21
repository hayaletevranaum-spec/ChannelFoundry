import { useEffect, useMemo, useRef, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import {
  ANALYSIS_PAGE_SIZE as PAGE_SIZE,
  analysisErrorText as errorText,
  analysisStateLabel as stateLabel,
  formatVideoDate as formatDate,
  formatVideoDuration as formatDuration,
  type AnalysisFilter,
} from "./video-analysis-utils";

function youtubeVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export default function VideoAnalysisWorkbench() {
  const bridge = window.birdesengorStudio;
  const notify = useAiWorkbenchNotice();
  const [videos, setVideos] = useState<StudioAiAnalysisVideo[]>([]);
  const [stats, setStats] = useState<StudioAiAnalysisStats>({ transcripts: 0, analyzed: 0, waiting: 0, running: 0, errors: 0 });
  const [config, setConfig] = useState<StudioAiConfig | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AnalysisFilter>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [result, setResult] = useState<StudioAiAnalysisResult | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [listView, setListView] = useState<"list" | "grid">("list");
  const [dateSortDirection, setDateSortDirection] = useState<"asc" | "desc">("desc");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const selectPageRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!bridge) return;
    const [nextVideos, nextStats, nextConfig] = await Promise.all([
      bridge.aiAnalysisList(),
      bridge.aiAnalysisStats(),
      bridge.aiConfig(),
    ]);
    setVideos(nextVideos);
    setStats(nextStats);
    setConfig(nextConfig);
  };

  useEffect(() => {
    void load().catch((reason) => notify(errorText(reason), "error"));
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  useEffect(() => {
    if (!bridge || !activeVideoId) { setResult(null); return; }
    let canceled = false;
    void bridge.aiAnalysisResult(activeVideoId)
      .then((nextResult) => { if (!canceled) setResult(nextResult); })
      .catch(() => { if (!canceled) setResult(null); });
    return () => { canceled = true; };
  }, [bridge, activeVideoId, videos.find((video) => video.videoId === activeVideoId)?.analysisUpdatedAt]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    return videos.filter((video) => {
      if (term && !`${video.title} ${video.videoId}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      if (filter === "pending" && (video.hasAnalysis || video.jobState === "waiting" || video.jobState === "running")) return false;
      if (filter === "ready" && !video.hasAnalysis) return false;
      if (filter === "queued" && !["waiting", "running"].includes(video.jobState)) return false;
      if (filter === "error" && video.jobState !== "error") return false;
      return true;
    }).map((video, index) => ({ video, index })).sort((left, right) => {
      const dateComparison = left.video.publishedAt.localeCompare(right.video.publishedAt);
      if (dateComparison !== 0) return dateSortDirection === "asc" ? dateComparison : -dateComparison;
      return left.index - right.index;
    }).map(({ video }) => video);
  }, [videos, query, filter, dateSortDirection]);

  useEffect(() => { setPage(1); }, [query, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  const activeVideo = visible.find((video) => video.videoId === activeVideoId) ?? null;

  useEffect(() => {
    setActiveVideoId((current) => current && visible.some((video) => video.videoId === current)
      ? current
      : visible[0]?.videoId ?? null);
  }, [visible]);

  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  const selectedPageCount = visible.filter((video) => selected.has(video.videoId)).length;
  const pageSelected = Boolean(visible.length) && selectedPageCount === visible.length;

  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = selectedPageCount > 0 && !pageSelected;
  }, [selectedPageCount, pageSelected]);

  const toggle = (videoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      return next;
    });
  };

  const togglePage = () => {
    const visibleIds = new Set(visible.map((video) => video.videoId));
    setSelected((current) => pageSelected
      ? new Set([...current].filter((videoId) => !visibleIds.has(videoId)))
      : new Set([...current, ...visibleIds]));
  };

  const enqueue = async (force = false) => {
    if (!bridge || !selected.size || !config?.configured) return;
    const ids = [...selected];
    if (!confirm(`${ids.length} video yerel AI hikâye çözümleme kuyruğuna eklensin mi? Model tek tek çalışacak; Studio kapatılırsa kuyruk SQLite'ta korunur.`)) return;
    setBusy(true);
    try {
      const queued = await bridge.aiAnalysisEnqueue({ videoIds: ids, force });
      setSelected(new Set());
      await load();
      notify(`${queued.accepted} video AI kuyruğuna alındı${queued.skipped ? ` · ${queued.skipped} uygun olmayan kayıt atlandı` : ""}.`, "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const enqueueVideo = async (video: StudioAiAnalysisVideo) => {
    if (!bridge || !config?.configured || busy || video.hasAnalysis || ["waiting", "running", "done"].includes(video.jobState)) return;
    setBusy(true);
    try {
      const queued = await bridge.aiAnalysisEnqueue({ videoIds: [video.videoId], force: video.jobState === "error" });
      await load();
      notify(queued.accepted
        ? `“${video.title}” AI çözümleme kuyruğuna alındı.`
        : `“${video.title}” AI kuyruğuna eklenemedi.`, queued.accepted ? "success" : "error");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const openYoutubeVideo = async (video: StudioAiAnalysisVideo) => {
    if (!bridge) return;
    try {
      await bridge.openExternalUrl(youtubeVideoUrl(video.videoId));
    } catch (reason) {
      notify(`YouTube videosu açılamadı · ${errorText(reason)}`, "error");
    }
  };

  const stopAnalysis = async () => {
    if (!bridge || stopping || !(stats.waiting + stats.running)) return;
    setStopping(true);
    try {
      const canceled = await bridge.aiAnalysisCancel();
      await load();
      notify(`${canceled.canceled} çözümleme işi durduruldu. Videolar yeniden seçilebilir.`, "success");
    } catch (reason) {
      notify(`Çözümleme durdurulamadı · ${errorText(reason)}`, "error");
    } finally {
      setStopping(false);
    }
  };

  if (!bridge) return <div className="ai-workshop-page"><div className="ai-empty-state"><h2>AI Atölyesi Electron Studio içinde kullanılabilir.</h2></div></div>;

  const queueActive = stats.waiting + stats.running > 0;

  return <div className="ai-workshop-page">
    <div className="ai-workshop-metrics">
      <Metric label="Transkript hazır" value={stats.transcripts} note="AI için kaynak"/>
      <Metric label="Çözümleme hazır" value={stats.analyzed} note="video anlatı dosyası"/>
      <Metric label="Kuyruk" value={stats.waiting + stats.running} note={stats.running ? "model çalışıyor" : "bekleyen işler"}/>
      <Metric label="Hata" value={stats.errors} note="yeniden denenebilir"/>
    </div>

    <div className="ai-workshop-layout">
      <section className="ai-source-list panel">
        <div className="ai-source-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Transkriptli videolarda ara…"/><select value={filter} onChange={(event) => setFilter(event.target.value as AnalysisFilter)}><option value="pending">Çözümleme bekleyen</option><option value="ready">Çözümleme hazır</option><option value="queued">Kuyrukta</option><option value="error">Hata</option><option value="all">Tümü</option></select></div>
        <div className="ai-analysis-selection-toolbar">
          <div className="ai-analysis-selection-actions">
            <button className="text-button" disabled={!selected.size || busy} onClick={() => setSelected(new Set())}>Seçimi temizle</button>
            {selected.size > 0 && <span>{selected.size} video seçili</span>}
          </div>
          <div className="ai-analysis-display-controls" aria-label="Çözümleme listesi görünümü">
            <button type="button" className={listView === "list" ? "active" : ""} aria-pressed={listView === "list"} onClick={() => setListView("list")}>Liste</button>
            <button type="button" className={listView === "grid" ? "active" : ""} aria-pressed={listView === "grid"} onClick={() => setListView("grid")}>Kartlar</button>
          </div>
          <div className="ai-analysis-page-controls">
            <label><span>Sayfada</span><select aria-label="Sayfada gösterilecek video adedi" value={pageSize} disabled={busy} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25 kayıt</option><option value={50}>50 kayıt</option><option value={100}>100 kayıt</option><option value={200}>200 kayıt</option></select></label>
            <div className="ai-analysis-pagination"><button aria-label="Önceki sayfa" disabled={page <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><span>{page} / {pageCount}</span><button aria-label="Sonraki sayfa" disabled={page >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>→</button></div>
          </div>
          <button className={`primary-button ai-analysis-submit${queueActive ? " stop" : ""}`} disabled={queueActive ? stopping : !selected.size || !config?.configured || busy} onClick={() => queueActive ? void stopAnalysis() : void enqueue(filter === "error")}>{queueActive ? stopping ? "Durduruluyor…" : "Çözümlemeyi durdur" : filter === "error" ? "Seçilenleri tekrar çözümle" : "Seçilenleri çözümle"}</button>
        </div>
        {listView === "list" && <div className="ai-source-table-head">
          <span><input ref={selectPageRef} type="checkbox" aria-label="Bu sayfadaki videoları seç" title="Bu sayfadaki videoları seç" disabled={!visible.length || busy} checked={pageSelected} onChange={togglePage}/></span>
          <span>VİDEO</span>
          <button type="button" className="active" onClick={() => { setDateSortDirection((current) => current === "desc" ? "asc" : "desc"); setPage(1); }} aria-label="Tarih sütununu sırala"><span>TARİH</span><b aria-hidden="true">{dateSortDirection === "desc" ? "↓" : "↑"}</b></button>
          <span>DURUM</span>
        </div>}
        {listView === "grid" && <div className="ai-source-card-head"><label><input ref={selectPageRef} type="checkbox" aria-label="Bu sayfadaki videoları seç" disabled={!visible.length || busy} checked={pageSelected} onChange={togglePage}/><span>Bu sayfadaki videolar</span></label><button type="button" onClick={() => { setDateSortDirection((current) => current === "desc" ? "asc" : "desc"); setPage(1); }}>Tarih {dateSortDirection === "desc" ? "↓" : "↑"}</button></div>}
        <div className={`ai-source-rows${listView === "grid" ? " grid-view" : ""}`}>{visible.map((video) => <article key={video.videoId} className={activeVideoId === video.videoId ? "active" : ""} onClick={() => setActiveVideoId(video.videoId)}>
          <input type="checkbox" checked={selected.has(video.videoId)} onClick={(event) => event.stopPropagation()} onChange={() => toggle(video.videoId)}/>
          <div className="ai-source-video-main"><img src={video.thumbnailUrl} alt="" loading="lazy"/><div><a href={youtubeVideoUrl(video.videoId)} title="YouTube'da aç" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openYoutubeVideo(video); }}>{video.title}</a><small>{video.videoId}</small>{video.jobState === "error" && <em title={video.jobError}>{video.jobError}</em>}</div></div>
          <span className="ai-source-date">{formatDate(video.publishedAt)}</span>
          {!video.hasAnalysis && !["waiting", "running"].includes(video.jobState)
            ? <button type="button" className="ai-analysis-row-action" disabled={busy || !config?.configured} title={config?.configured ? `“${video.title}” videosunu çözümle` : "AI yapılandırılmadı"} onClick={(event) => { event.stopPropagation(); void enqueueVideo(video); }}>{video.jobState === "error" ? "Tekrar çözümle" : "Çözümle"}</button>
            : <span className={`analysis-state ${video.jobState || (video.hasAnalysis ? "done" : "idle")}`}>{stateLabel(video)}</span>}
        </article>)}</div>
        {!visible.length && <div className="ai-list-empty">Bu filtrede video yok.</div>}
      </section>

      <section className="ai-review panel">
        {activeVideo ? <>
          <div className="ai-review-head"><div><small>VİDEO ANLATI DOSYASI</small><h3>{activeVideo.title}</h3><p>{formatDate(activeVideo.publishedAt)} · {formatDuration(activeVideo.durationSeconds)}</p></div><span className={`analysis-state ${activeVideo.jobState || (activeVideo.hasAnalysis ? "done" : "idle")}`}>{stateLabel(activeVideo)}</span></div>
          {result ? <div className="ai-review-body">
            <section className="ai-review-block primary"><small>WEB İÇERİK ÖZETİ</small><h4>{result.title}</h4><p>{result.summary || "Özet üretilmedi."}</p></section>
            <section className="ai-review-block"><small>HİKÂYE HATTI ADAYLARI</small><div className="ai-topic-chips">{result.storyHints.length ? result.storyHints.map((hint) => <span key={hint}>{hint}</span>) : <p>Bu videoda ayrı bir hikâye hattı etiketi çıkarılmadı.</p>}</div></section>
            <section className="ai-review-block"><small>HİKÂYE AKIŞI</small><ol>{result.storyBeats.length ? result.storyBeats.map((beat) => <li key={beat}>{beat}</li>) : <li>Belirgin hikâye parçası çıkarılmadı.</li>}</ol></section>
            <section className="ai-review-block"><small>KARAKTERLER VE BU VİDEODAKİ DETAYLARI</small><div className="ai-subject-list">{result.characters.length ? result.characters.map((character) => <article key={character.name}><div className="visual-entity-copy"><span>{character.aliases.length ? `Diğer adlar: ${character.aliases.join(", ")}` : "Karakter"}</span><strong>{character.name}</strong><p>{character.role || "Bu videodaki rolü ayrıca tanımlanmadı."}</p>{character.details.length > 0 && <ul className="ai-character-details">{character.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}</div></article>) : <p>Bu videoda kalıcı karakter adayı çıkarılmadı.</p>}</div></section>
            <section className="ai-review-block"><small>ÖNEMLİ SAHNELER / OLAYLAR</small><div className="ai-subject-list">{result.scenes.length ? result.scenes.map((scene) => <article key={`${scene.name}-${scene.description}`}><div className="visual-entity-copy"><span>Sahne adayı</span><strong>{scene.name || "Sahne"}</strong><p>{scene.description || "Bu sahne için ayrı açıklama üretilmedi."}</p></div></article>) : <p>Bu video için ayrı bir sahne çıkarılmadı.</p>}</div></section>
            <section className="ai-review-block"><small>MEKÂNLAR</small><div className="ai-subject-list">{result.locations.length ? result.locations.map((location) => <article key={location.name}><div className="visual-entity-copy"><span>Mekân adayı</span><strong>{location.name}</strong><p>{location.details.join(" ") || "Bu mekân için ayrı açıklama üretilmedi."}</p></div></article>) : <p>Önemli mekân çıkarılmadı.</p>}</div></section>
            <section className="ai-review-block"><small>ÖNEMLİ NESNE / SEMBOLLER</small><div className="ai-subject-list">{result.objects.length ? result.objects.map((object) => <article key={object.name}><div className="visual-entity-copy"><span>Nesne adayı</span><strong>{object.name}</strong><p>{object.details.join(" ") || "Bu nesne için ayrı açıklama üretilmedi."}</p></div></article>) : <p>Önemli nesne çıkarılmadı.</p>}</div></section>
            <section className="ai-review-block"><small>ANA TEMALAR</small><div className="ai-topic-chips">{result.topics.length ? result.topics.map((topic) => <span key={topic}>{topic}</span>) : <p>Belirgin tema çıkarılmadı.</p>}</div></section>
            <footer>Model: {result.model || "—"} · Son çözümleme: {result.updatedAt || "—"}</footer>
          </div> : <div className="ai-review-empty"><span>YEREL TRANSKRİPT HAZIR</span><h3>Bu video henüz hikâye çözümlemesinden geçmedi.</h3><p>Videoyu seçime ekleyip üstteki “Seçilenleri çözümle” işlemini başlat. Sonuçlar daha sonra evren birleştirme aşamasında diğer videolarla ilişkilendirilecek.</p>{activeVideo.jobState === "error" && <div className="ai-error-detail">{activeVideo.jobError}</div>}</div>}
        </> : <div className="ai-review-empty"><h3>İncelemek için bir video seç.</h3></div>}
      </section>
    </div>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="panel ai-workshop-metric"><span>{label}</span><strong>{new Intl.NumberFormat("tr-TR").format(value)}</strong><small>{note}</small></div>;
}
