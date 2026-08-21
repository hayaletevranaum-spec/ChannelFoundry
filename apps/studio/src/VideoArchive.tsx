import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_PAGE_SIZE = 50;

type DurationFilter = "all" | "0-10" | "10-30" | "30-60" | "60+";
type ArchiveFilter = "all" | "missing" | "ready";
type SortKey = "date" | "subtitle" | "archive";
type SortDirection = "asc" | "desc";
type CatalogView = "list" | "grid";
type SyncNotice = { text: string; tone: "active" | "success" | "canceled" | "error" };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatDate(value: string) {
  if (!value) return "Tarih bilinmiyor";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("tr-TR").format(date);
}

function weekday(value: string) {
  if (!value) return -1;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

function matchesDuration(value: number | null, filter: DurationFilter) {
  if (filter === "all") return true;
  if (value == null) return false;
  const minutes = value / 60;
  if (filter === "0-10") return minutes < 10;
  if (filter === "10-30") return minutes >= 10 && minutes < 30;
  if (filter === "30-60") return minutes >= 30 && minutes < 60;
  return minutes >= 60;
}

function subtitleRank(video: StudioYoutubeCatalogVideo) {
  if (video.hasTranscript) return 4;
  if (video.subtitleStatus === "manual") return 3;
  if (video.subtitleStatus === "automatic") return 2;
  if (video.subtitleStatus === "none") return 1;
  return 0;
}

function archiveRank(video: StudioYoutubeCatalogVideo) {
  return video.hasTranscript ? 1 : 0;
}

function subtitleLabel(video: StudioYoutubeCatalogVideo) {
  if (video.subtitleStatus === "manual") return "Manuel";
  if (video.subtitleStatus === "automatic") return "Otomatik";
  if (video.subtitleStatus === "none") return "Yok";
  return "—";
}

function youtubeVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressLabel(progress: StudioYoutubeSyncProgress | null) {
  if (!progress) return "";
  if (progress.phase === "preparing") return "Kanal taraması hazırlanıyor…";
  if (progress.phase === "catalog") return "Kanal video listesi denetleniyor…";
  if (progress.phase === "scanning") return progress.total
    ? `Tarih ve altyazılar taranıyor · ${progress.processed} / ${progress.total} video · %${progress.percent}`
    : `Tarih ve altyazılar taranıyor · ${progress.processed} video`;
  if (progress.phase === "thumbnails") return progress.total
    ? `Thumbnail cache hazırlanıyor · ${progress.processed} / ${progress.total} · %${progress.percent}`
    : "Thumbnail cache denetleniyor…";
  if (progress.phase === "saving") return "Katalog SQLite'a kaydediliyor…";
  if (progress.phase === "canceling") return "İşlem durduruluyor…";
  if (progress.phase === "canceled") return "Senkronizasyon iptal edildi.";
  return "Senkronizasyon tamamlandı.";
}

export default function VideoArchive() {
  const bridge = window.birdesengorStudio;
  const [tool, setTool] = useState<StudioTranscriptToolStatus | null>(null);
  const [channels, setChannels] = useState<StudioYoutubeChannel[]>([]);
  const [videos, setVideos] = useState<StudioYoutubeCatalogVideo[]>([]);
  const [stats, setStats] = useState<StudioYoutubeCatalogStats>({ total: 0, imported: 0, transcripts: 0, pendingImport: 0 });
  const [query, setQuery] = useState("");
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [excludeShorts, setExcludeShorts] = useState(true);
  const [excludeLive, setExcludeLive] = useState(true);
  const [excludeMembersOnly, setExcludeMembersOnly] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [catalogView, setCatalogView] = useState<CatalogView>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [busy, setBusy] = useState<"recent" | "full" | "archive-bulk" | string | null>(null);
  const [syncProgress, setSyncProgress] = useState<StudioYoutubeSyncProgress | null>(null);
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null);
  const [canceling, setCanceling] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!bridge) return;
    const [nextTool, nextChannels, nextVideos, nextStats] = await Promise.all([
      bridge.youtubeCatalogStatus(),
      bridge.youtubeCatalogChannels(),
      bridge.youtubeCatalogVideos({}),
      bridge.youtubeCatalogStats(),
    ]);
    setTool(nextTool);
    setChannels(nextChannels);
    setVideos(nextVideos);
    setStats(nextStats);
    setSelected((current) => new Set([...current].filter((videoId) => nextVideos.some((video) => video.videoId === videoId && !video.hasTranscript))));
  };

  useEffect(() => {
    void load().catch((reason) => setSyncNotice({ text: `Katalog yüklenemedi · ${errorText(reason)}`, tone: "error" }));
    const stopData = bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
    const stopProgress = bridge?.onYoutubeCatalogProgress?.((progress) => setSyncProgress(progress));
    return () => { stopData?.(); stopProgress?.(); };
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    const matches = videos.filter((video) => {
      if (term && !`${video.title} ${video.videoId}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      if (!matchesDuration(video.durationSeconds, duration)) return false;
      if (dateFrom && (!video.publishedAt || video.publishedAt < dateFrom)) return false;
      if (dateTo && (!video.publishedAt || video.publishedAt > dateTo)) return false;
      if (weekdays.size && !weekdays.has(weekday(video.publishedAt))) return false;
      if (archiveFilter === "missing" && video.hasTranscript) return false;
      if (archiveFilter === "ready" && !video.hasTranscript) return false;
      return true;
    });
    return matches.map((video, index) => ({ video, index })).sort((left, right) => {
      let comparison = 0;
      if (sortKey === "date") comparison = left.video.publishedAt.localeCompare(right.video.publishedAt);
      if (sortKey === "subtitle") comparison = subtitleRank(left.video) - subtitleRank(right.video);
      if (sortKey === "archive") comparison = archiveRank(left.video) - archiveRank(right.video);
      if (comparison === 0) comparison = right.video.publishedAt.localeCompare(left.video.publishedAt) || left.index - right.index;
      return sortDirection === "asc" ? comparison : -comparison;
    }).map(({ video }) => video);
  }, [videos, query, duration, archiveFilter, dateFrom, dateTo, weekdays, sortKey, sortDirection]);

  useEffect(() => { setPage(1); }, [query, duration, archiveFilter, dateFrom, dateTo, weekdays]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const filteredSelectable = filtered.filter((video) => !video.hasTranscript);
  const selectedResultCount = filteredSelectable.filter((video) => selected.has(video.videoId)).length;
  const allResultsSelected = Boolean(filteredSelectable.length) && selectedResultCount === filteredSelectable.length;
  const availableSubtitleCount = videos.filter((video) => video.subtitleStatus === "manual" || video.subtitleStatus === "automatic").length;
  const archivedTranscriptCount = videos.filter((video) => video.hasTranscript).length;
  const unarchivedTranscriptCount = Math.max(0, videos.length - archivedTranscriptCount);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedResultCount > 0 && !allResultsSelected;
  }, [selectedResultCount, allResultsSelected, catalogView]);

  const sync = async (mode: "recent" | "full") => {
    if (!bridge) return;
    if (mode === "full" && channels.length && !confirm("Tam senkronizasyon seçili kapsamdaki tüm videoların tarih ve altyazı bilgisini yeniden tarayacak, eksik thumbnail'leri yerel cache'e alacak. Ayrıntılı tarama biraz zaman alabilir. Devam edilsin mi?")) return;
    setBusy(mode);
    setCanceling(false);
    setSyncNotice(null);
    setSyncProgress({ phase: "preparing", processed: 0, total: 0, percent: 0, currentTitle: "" });
    try {
      const result = await bridge.youtubeCatalogSync({ mode, excludeShorts, excludeLive, excludeMembersOnly });
      if (!result.ok) {
        setSyncNotice({ text: "Senkronizasyon iptal edildi; mevcut katalog verileri korundu.", tone: "canceled" });
        return;
      }
      await load();
      const detailedReady = result.detailStats.skipped + result.detailStats.completed;
      setSyncNotice({
        text: `Senkronizasyon tamamlandı · ${result.newCount} yeni · ${result.updatedCount} katalog${result.removedCount ? ` · ${result.removedCount} kapsam dışı kaldırıldı` : ""} · ${detailedReady} ayrıntı hazır · ${result.detailStats.unavailable} erişilemedi · ${result.archivedThumbnailCount} thumbnail arşivde${result.cachedCount ? ` · ${result.cachedCount} yeni indirildi` : ""}.`,
        tone: "success",
      });
    } catch (reason) {
      setSyncNotice({ text: `Senkronizasyon tamamlanamadı · ${errorText(reason)}`, tone: "error" });
    } finally {
      setBusy(null);
      setCanceling(false);
      setSyncProgress(null);
    }
  };

  const cancelSync = async () => {
    if (!bridge || canceling || !["recent", "full"].includes(String(busy))) return;
    setCanceling(true);
    setSyncProgress((current) => ({ phase: "canceling", processed: current?.processed || 0, total: current?.total || 0, percent: current?.percent || 0, currentTitle: current?.currentTitle || "" }));
    try {
      await bridge.youtubeCatalogCancel();
    } catch (reason) {
      setSyncNotice({ text: `İşlem durdurulamadı · ${errorText(reason)}`, tone: "error" });
      setCanceling(false);
    }
  };

  const archiveVideo = async (video: StudioYoutubeCatalogVideo) => {
    if (!bridge || video.hasTranscript || busy) return;
    setBusy(video.videoId);
    setSyncNotice({ text: `“${video.title}” altyazısı arşivleniyor…`, tone: "active" });
    try {
      const result = await bridge.transcriptFetchYoutube({ videoId: video.videoId });
      await load();
      setSyncNotice({ text: `“${video.title}” altyazısı arşivlendi · ${result.wordCount.toLocaleString("tr-TR")} kelime.`, tone: "success" });
      await bridge.refreshMain().catch(() => undefined);
    } catch (reason) {
      setSyncNotice({ text: `Altyazı arşivlenemedi · ${errorText(reason)}`, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const openYoutubeVideo = async (video: StudioYoutubeCatalogVideo) => {
    if (!bridge) return;
    try {
      await bridge.openExternalUrl(youtubeVideoUrl(video.videoId));
    } catch (reason) {
      setSyncNotice({ text: `YouTube videosu açılamadı · ${errorText(reason)}`, tone: "error" });
    }
  };

  const toggleSelected = (videoId: string) => {
    if (busy) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      return next;
    });
  };

  const selectAllResults = () => {
    if (busy) return;
    const ids = filteredSelectable.map((video) => video.videoId);
    setSelected((current) => new Set([...current, ...ids]));
    setSyncNotice({ text: `${ids.length} sonuç seçildi.`, tone: "success" });
  };

  const toggleAllResults = () => {
    if (busy) return;
    if (!allResultsSelected) {
      selectAllResults();
      return;
    }
    const resultIds = new Set(filteredSelectable.map((video) => video.videoId));
    setSelected((current) => new Set([...current].filter((videoId) => !resultIds.has(videoId))));
  };

  const archiveSelected = async () => {
    if (!bridge || !selected.size || busy) return;
    const targets = videos.filter((video) => selected.has(video.videoId) && !video.hasTranscript);
    if (!targets.length) return;
    if (!confirm(`${targets.length} video için YouTube altyazısı sırayla arşivlensin mi? İşlem sırasında Studio açık kalmalı.`)) return;
    setBusy("archive-bulk");
    let completed = 0;
    let failed = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const video = targets[index];
        setSyncNotice({ text: `Altyazılar arşivleniyor · ${index + 1} / ${targets.length} · ${video.title}`, tone: "active" });
        try {
          await bridge.transcriptFetchYoutube({ videoId: video.videoId });
          completed += 1;
        } catch {
          failed += 1;
        }
        if (index < targets.length - 1) await wait(1400);
      }
      await load();
      setSelected(new Set());
      setSyncNotice({ text: `${completed} altyazı arşivlendi${failed ? ` · ${failed} video arşivlenemedi` : ""}.`, tone: failed ? "error" : "success" });
      await bridge.refreshMain().catch(() => undefined);
    } catch (reason) {
      setSyncNotice({ text: `Altyazı arşivleme kuyruğu tamamlanamadı · ${errorText(reason)}`, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((current) => current === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDirection("desc");
    }
    setPage(1);
  };

  const dayLabels = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const syncBusy = busy === "recent" || busy === "full";
  return <div className="video-archive-page">
    <section className="channel-sync panel">
      <div className="channel-sync-controls">
        <div className="channel-scan-options" aria-label="Kanal tarama kapsamı">
          <label><input type="checkbox" checked={excludeShorts} disabled={Boolean(busy)} onChange={(event) => setExcludeShorts(event.target.checked)}/><span>Shorts videolarını tarama</span></label>
          <label><input type="checkbox" checked={excludeLive} disabled={Boolean(busy)} onChange={(event) => setExcludeLive(event.target.checked)}/><span>Canlı yayınları tarama</span></label>
          <label><input type="checkbox" checked={excludeMembersOnly} disabled={Boolean(busy)} onChange={(event) => setExcludeMembersOnly(event.target.checked)}/><span>Üyelere özel videoları tarama</span></label>
        </div>
        <div className={`channel-sync-progress${syncBusy ? " active" : ""}${!syncBusy && syncNotice ? ` ${syncNotice.tone}` : ""}`} role="status" aria-live="polite">{progressLabel(syncProgress) || syncNotice?.text || ""}</div>
        <button className={`primary-button${syncBusy ? " channel-cancel-button" : ""}`} disabled={!tool?.available || (Boolean(busy) && !syncBusy) || canceling} onClick={() => syncBusy ? void cancelSync() : void sync("full")}>{syncBusy ? canceling ? "Durduruluyor…" : "İşlemi iptal et" : "Tam senkronizasyon"}</button>
      </div>
    </section>

    <div className="catalog-metrics">
      <Metric label="Kanal kataloğu" value={stats.total} note="kaynak havuzu"/>
      <Metric label="Altyazı mevcut" value={availableSubtitleCount} note="YouTube kaynağında"/>
      <Metric label="Arşivde" value={archivedTranscriptCount} note="yerel transkript"/>
      <Metric label="Arşivlenmemiş" value={unarchivedTranscriptCount} note="kanal kataloğunda"/>
    </div>

    <section className={`catalog-workspace panel${filtersVisible ? "" : " filters-hidden"}`}>
      {filtersVisible && <aside className="catalog-filters">
        <div className="filter-title"><small>FİLTRELER</small><strong>{filtered.length} sonuç</strong></div>
        <label><span>Başlıkta ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Video ara…"/></label>
        <label><span>Süre</span><select value={duration} onChange={(event) => setDuration(event.target.value as DurationFilter)}><option value="all">Tüm süreler</option><option value="0-10">0–10 dk</option><option value="10-30">10–30 dk</option><option value="30-60">30–60 dk</option><option value="60+">60+ dk</option></select></label>
        <label><span>Arşiv durumu</span><select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}><option value="all">Tümü</option><option value="missing">Arşivlenmemiş</option><option value="ready">Arşivde</option></select></label>
        <div className="date-filter"><span>Tarih aralığı</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></div>
        <div className="weekday-filter"><span>Haftanın günü</span><div>{dayLabels.map((label, day) => <button key={day} className={weekdays.has(day) ? "active" : ""} onClick={() => toggleWeekday(day)}>{label}</button>)}</div></div>
        <button className="text-button clear-filters" onClick={() => { setQuery(""); setDuration("all"); setArchiveFilter("all"); setDateFrom(""); setDateTo(""); setWeekdays(new Set()); }}>Filtreleri temizle</button>
      </aside>}

      <div className="catalog-table-wrap">
        <div className="catalog-selection-toolbar">
          <div className="catalog-selection-actions">
            <button className="secondary-button" disabled={Boolean(busy) || !filteredSelectable.length} onClick={selectAllResults}>Arşivlenmemişleri seç <small>{filteredSelectable.length}</small></button>
            <button className="text-button" disabled={Boolean(busy) || !selected.size} onClick={() => setSelected(new Set())}>Seçimi temizle</button>
            <span>{selected.size ? `${selected.size} video seçili` : "Seçim yapılmadı"}</span>
          </div>
          <div className="catalog-page-controls">
            <label><span>Sayfada</span><select aria-label="Sayfada gösterilecek kayıt adedi" value={pageSize} disabled={Boolean(busy)} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25 kayıt</option><option value={50}>50 kayıt</option><option value={100}>100 kayıt</option><option value={200}>200 kayıt</option></select></label>
            {pageCount > 1 && <div className="catalog-pagination catalog-pagination-toolbar"><button aria-label="Önceki sayfa" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><span>{page} / {pageCount}</span><button aria-label="Sonraki sayfa" disabled={page >= pageCount || Boolean(busy)} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>→</button></div>}
          </div>
          <div className="catalog-toolbar-right">
            <div className="catalog-display-controls" aria-label="Katalog görünümü">
              <button type="button" className={filtersVisible ? "active" : ""} aria-pressed={filtersVisible} onClick={() => setFiltersVisible((current) => !current)}>{filtersVisible ? "Filtreyi gizle" : "Filtreyi göster"}</button>
              <button type="button" className={catalogView === "list" ? "active" : ""} aria-pressed={catalogView === "list"} onClick={() => setCatalogView("list")}>Liste</button>
              <button type="button" className={catalogView === "grid" ? "active" : ""} aria-pressed={catalogView === "grid"} onClick={() => setCatalogView("grid")}>Kartlar</button>
            </div>
            <button className="primary-button" disabled={Boolean(busy) || !selected.size || !tool?.available} onClick={() => void archiveSelected()}>{busy === "archive-bulk" ? "Arşivleniyor…" : "Seçilen altyazıları arşivle"}</button>
          </div>
        </div>
        {catalogView === "list"
          ? <div className="catalog-table-head"><span className="catalog-check"><input ref={selectAllRef} type="checkbox" aria-label="Bütün arşivlenmemiş sonuçları seç" title="Bütün arşivlenmemiş sonuçları seç" disabled={Boolean(busy) || !filteredSelectable.length} checked={allResultsSelected} onChange={toggleAllResults}/></span><span>Video</span><SortButton label="Tarih" sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/><span>Süre</span><SortButton label="Altyazı" sortKey="subtitle" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/><SortButton label="Arşiv" sortKey="archive" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/></div>
          : <div className="catalog-card-head"><label><input ref={selectAllRef} type="checkbox" aria-label="Bütün arşivlenmemiş sonuçları seç" title="Bütün arşivlenmemiş sonuçları seç" disabled={Boolean(busy) || !filteredSelectable.length} checked={allResultsSelected} onChange={toggleAllResults}/><span>Bütün arşivlenmemiş sonuçlar</span></label><div><span>Sırala</span><SortButton label="Tarih" sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/><SortButton label="Altyazı" sortKey="subtitle" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/><SortButton label="Arşiv" sortKey="archive" activeKey={sortKey} direction={sortDirection} onSort={changeSort}/></div></div>}
        <div className={`catalog-rows${catalogView === "grid" ? " grid-view" : ""}`}>
          {visible.map((video) => <article className={`catalog-row ${selected.has(video.videoId) ? "selected" : ""}`} key={video.videoId}>
            <span className="catalog-check"><input type="checkbox" disabled={video.hasTranscript || Boolean(busy)} checked={selected.has(video.videoId)} onChange={() => toggleSelected(video.videoId)}/></span>
            <div className="catalog-video-main"><img src={video.thumbnailUrl} alt=""/><div><a href={youtubeVideoUrl(video.videoId)} title="YouTube'da aç" onClick={(event) => { event.preventDefault(); void openYoutubeVideo(video); }}>{video.title}</a><small>{video.videoId}{video.thumbnailCached ? " · thumbnail yerelde" : ""}</small></div></div>
            <span className="catalog-date">{formatDate(video.publishedAt)}</span>
            <span className="catalog-duration">{formatDuration(video.durationSeconds)}</span>
            <span className={`catalog-subtitle-state ${video.subtitleStatus === "manual" ? "catalog-state good" : video.subtitleStatus === "automatic" ? "catalog-state pending" : "catalog-state"}`} title={[...video.subtitleLanguages, ...video.automaticCaptionLanguages].join(", ")}>{subtitleLabel(video)}</span>
            {video.hasTranscript
              ? <span className="catalog-archive-state">Arşivde</span>
              : <button className="row-action catalog-archive-action" disabled={Boolean(busy) || !tool?.available} onClick={() => void archiveVideo(video)}>{busy === video.videoId ? "Arşivleniyor…" : "Altyazıyı arşivle"}</button>}
          </article>)}
          {!visible.length && <div className="catalog-empty"><strong>Bu filtrelerde video yok.</strong><span>Kanalı senkronize et veya filtreleri değiştir.</span></div>}
        </div>
      </div>
    </section>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="catalog-metric panel"><span>{label}</span><strong>{new Intl.NumberFormat("tr-TR").format(value)}</strong><small>{note}</small></div>;
}

function SortButton({ label, sortKey, activeKey, direction, onSort }: {
  label: string; sortKey: SortKey; activeKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return <button className={`catalog-sort-button${active ? " active" : ""}`} type="button" onClick={() => onSort(sortKey)} aria-label={`${label} sütununu sırala`}>
    <span>{label}</span><b aria-hidden="true">{active ? direction === "desc" ? "↓" : "↑" : "↕"}</b>
  </button>;
}
