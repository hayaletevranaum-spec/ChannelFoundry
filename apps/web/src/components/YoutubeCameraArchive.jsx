import React, { useEffect, useMemo, useRef, useState } from 'react';

const DAY_LABELS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DEFAULT_PAGE_SIZE = 10;

function formatDate(value, fallback = '') {
  if (!value) return fallback || 'Tarih bilinmiyor';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('tr-TR').format(date);
}

function formatDuration(seconds, fallback = '') {
  if (!Number.isFinite(seconds)) return fallback || '—';
  const value = Math.max(0, Number(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function weekday(value) {
  if (!value) return -1;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

function matchesDuration(seconds, filter) {
  if (filter === 'all') return true;
  if (!Number.isFinite(seconds)) return false;
  const minutes = Number(seconds) / 60;
  if (filter === '0-10') return minutes < 10;
  if (filter === '10-30') return minutes >= 10 && minutes < 30;
  if (filter === '30-60') return minutes >= 30 && minutes < 60;
  return minutes >= 60;
}

function publishedSummaryMap(publication) {
  const entries = Array.isArray(publication?.youtubeAnalysis?.videos) ? publication.youtubeAnalysis.videos : [];
  return new Map(entries.map((entry) => [
    String(entry?.videoId || '').trim(),
    String(entry?.summary || '').trim(),
  ]).filter(([videoId, summary]) => videoId && summary));
}

export function YoutubeCameraArchive() {
  const [phase, setPhase] = useState('closed');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState([]);
  const [meta, setMeta] = useState(null);
  const [query, setQuery] = useState('');
  const [duration, setDuration] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [weekdays, setWeekdays] = useState(new Set());
  const [showShorts, setShowShorts] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [sortKey, setSortKey] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [filtersVisible, setFiltersVisible] = useState(() => !window.matchMedia('(max-width: 720px)').matches);
  const launcherRef = useRef(null);
  const closeButtonRef = useRef(null);
  const restoreLauncherFocus = useRef(false);

  async function load({ force = false } = {}) {
    if (loading || (loaded && !force)) return;
    setLoading(true);
    setError('');
    try {
      const endpoint = new URL(`${import.meta.env.BASE_URL}api/youtube/`, window.location.href);
      endpoint.searchParams.set('max', '600');
      if (force) endpoint.searchParams.set('_', String(Date.now()));
      const publicationUrl = new URL(`${import.meta.env.BASE_URL}content/publication.json`, window.location.href);
      if (force) publicationUrl.searchParams.set('_', String(Date.now()));

      const [response, publicationResponse] = await Promise.all([
        fetch(endpoint, { headers: { Accept: 'application/json' }, cache: force ? 'reload' : 'default' }),
        fetch(publicationUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' }).catch(() => null),
      ]);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !Array.isArray(payload.videos)) throw new Error(payload?.message || `HTTP ${response.status}`);

      const publication = publicationResponse?.ok ? await publicationResponse.json().catch(() => null) : null;
      const summaries = publishedSummaryMap(publication);
      const nextVideos = payload.videos.map((video) => ({
        ...video,
        summary: summaries.get(String(video.videoId || '').trim()) || '',
      }));
      const analyzedCount = nextVideos.filter((video) => video.summary).length;

      setVideos(nextVideos);
      setMeta({ ...payload, analyzedCount });
      setLoaded(true);
      setPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  function openArchive() {
    if (phase !== 'closed') return;
    restoreLauncherFocus.current = true;
    setPhase('opening');
    void load();
  }

  function closeArchive() {
    setPhase((current) => current === 'closed' || current === 'closing' ? current : 'closing');
  }

  function finishCameraTransition(event) {
    if (event.target !== event.currentTarget || event.animationName !== 'cameraScreenApproach') return;
    setPhase((current) => current === 'opening' ? 'open' : current === 'closing' ? 'closed' : current);
  }

  useEffect(() => {
    if (phase === 'closed') return undefined;
    const onKey = (event) => { if (event.key === 'Escape') closeArchive(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  useEffect(() => {
    if (phase === 'open') closeButtonRef.current?.focus({ preventScroll: true });
    if (phase !== 'closed' || !restoreLauncherFocus.current) return undefined;
    restoreLauncherFocus.current = false;
    const frame = window.requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('tr-TR');
    const matches = videos.filter((video) => {
      if (term && !`${video.title || ''} ${video.videoId || ''}`.toLocaleLowerCase('tr-TR').includes(term)) return false;
      if (!matchesDuration(video.durationSeconds, duration)) return false;
      if (dateFrom && (!video.publishedAt || video.publishedAt < dateFrom)) return false;
      if (dateTo && (!video.publishedAt || video.publishedAt > dateTo)) return false;
      if (weekdays.size && !weekdays.has(weekday(video.publishedAt))) return false;
      if (!showShorts && video.isShort) return false;
      if (!showLive && video.isLive) return false;
      if (!showMembers && video.membersOnly) return false;
      return true;
    });
    return matches.map((video, index) => ({ video, index })).sort((left, right) => {
      let comparison = 0;
      if (sortKey === 'title') comparison = String(left.video.title || '').localeCompare(String(right.video.title || ''), 'tr-TR');
      else if (sortKey === 'duration') comparison = (Number(left.video.durationSeconds) || 0) - (Number(right.video.durationSeconds) || 0);
      else comparison = String(left.video.publishedAt || '').localeCompare(String(right.video.publishedAt || ''));
      if (comparison === 0) comparison = left.index - right.index;
      return sortDirection === 'asc' ? comparison : -comparison;
    }).map(({ video }) => video);
  }, [videos, query, duration, dateFrom, dateTo, weekdays, showShorts, showLive, showMembers, sortKey, sortDirection]);

  useEffect(() => { setPage(1); }, [query, duration, dateFrom, dateTo, weekdays, showShorts, showLive, showMembers, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const archiveVisible = phase !== 'closed';

  function toggleWeekday(day) {
    setWeekdays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }

  function clearFilters() {
    setQuery('');
    setDuration('all');
    setDateFrom('');
    setDateTo('');
    setWeekdays(new Set());
    setShowShorts(false);
    setShowLive(false);
    setShowMembers(false);
  }

  function changeSort(key) {
    if (sortKey === key) setSortDirection((value) => value === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDirection(key === 'title' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  const cameraUrl = `${import.meta.env.BASE_URL}scene/handheld-camcorder-v2.png`;
  return <>
    <button
      type="button"
      ref={launcherRef}
      className={`youtube-camera-launcher camera-${phase}`}
      onClick={openArchive}
      disabled={phase !== 'closed'}
      aria-label="Masadaki kameradan YouTube video arşivini aç"
      aria-expanded={archiveVisible}
      aria-controls="youtube-camera-console"
      title="Video kayıtlarını incele"
    >
      <img src={cameraUrl} alt="" draggable="false" />
    </button>

    {archiveVisible ? <div className={`youtube-camera-overlay camera-phase-${phase}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeArchive(); }}>
      <section
        id="youtube-camera-console"
        className="youtube-camera-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-camera-title"
        onAnimationEnd={finishCameraTransition}
      >
        <div className="youtube-camera-statusbar" aria-hidden="true">
          <span className="youtube-camera-rec"><i />REC</span>
          <span>CAM 01</span>
          <span>HD 1080</span>
          <span>SP</span>
          <span className="youtube-camera-record-count">{String(filtered.length).padStart(3, '0')} CLIP</span>
          <span className="youtube-camera-timecode">00:00:00:00</span>
          <span className="youtube-camera-battery"><i /></span>
        </div>
        <header className="youtube-camera-head">
          <div>
            <small>PLAYBACK / VİDEO KASETLERİ</small>
            <h2 id="youtube-camera-title">Kayıt Kontrolü</h2>
            <p>{meta ? `${meta.count} kayıt YouTube'dan alındı${meta.analyzedCount ? ` · ${meta.analyzedCount} çözümlemeli kayıt` : ''}${meta.complete ? '' : ' · halka açık hızlı katalog'}.` : 'Kanal kayıtları hazırlanıyor.'}</p>
          </div>
          <div className="youtube-camera-head-actions">
            <a href={meta?.channelUrl || 'https://www.youtube.com/@example-channel'} target="_blank" rel="noreferrer">Kanalı aç ↗</a>
            <button type="button" onClick={() => void load({ force: true })} disabled={loading}>{loading ? 'Yenileniyor…' : 'Yenile'}</button>
            <button ref={closeButtonRef} type="button" className="youtube-camera-close" onClick={closeArchive} aria-label="Video arşivini kapat">×</button>
          </div>
        </header>

        <div className={`youtube-camera-workspace${filtersVisible ? '' : ' filters-hidden'}`}>
          {filtersVisible ? <aside className="youtube-camera-filters">
            <div className="youtube-camera-filter-title"><small>FİLTRELER</small><strong>{filtered.length} sonuç</strong><button type="button" className="youtube-camera-filter-close" onClick={() => setFiltersVisible(false)} aria-label="Filtreleri kapat">×</button></div>
            <label><span>Başlıkta ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Video ara…" /></label>
            <label><span>Süre</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="all">Tüm süreler</option><option value="0-10">0–10 dk</option><option value="10-30">10–30 dk</option><option value="30-60">30–60 dk</option><option value="60+">60+ dk</option></select></label>
            <div className="youtube-camera-date"><span>Tarih aralığı</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
            <div className="youtube-camera-weekdays"><span>Haftanın günü</span><div>{DAY_LABELS.map((label, day) => <button type="button" key={day} className={weekdays.has(day) ? 'active' : ''} onClick={() => toggleWeekday(day)}>{label}</button>)}</div></div>
            <div className="youtube-camera-types"><span>Kapsam</span><label><input type="checkbox" checked={showShorts} onChange={(event) => setShowShorts(event.target.checked)} />Shorts göster</label><label><input type="checkbox" checked={showLive} onChange={(event) => setShowLive(event.target.checked)} />Canlı yayınları göster</label><label><input type="checkbox" checked={showMembers} onChange={(event) => setShowMembers(event.target.checked)} />Üyelere özel göster</label></div>
            <button type="button" className="youtube-camera-clear" onClick={clearFilters}>Filtreleri temizle</button>
          </aside> : null}

          <div className="youtube-camera-catalog">
            <div className="youtube-camera-toolbar">
              <button type="button" onClick={() => setFiltersVisible((value) => !value)}>{filtersVisible ? 'Filtreyi gizle' : 'Filtreyi göster'}</button>
              <div className="youtube-camera-sort" aria-label="Video sıralama">
                <span>Sırala</span>
                <button type="button" className={sortKey === 'date' ? 'active' : ''} onClick={() => changeSort('date')}>Tarih {sortKey === 'date' ? sortDirection === 'desc' ? '↓' : '↑' : '↕'}</button>
                <button type="button" className={sortKey === 'title' ? 'active' : ''} onClick={() => changeSort('title')}>Ad {sortKey === 'title' ? sortDirection === 'desc' ? '↓' : '↑' : '↕'}</button>
                <button type="button" className={sortKey === 'duration' ? 'active' : ''} onClick={() => changeSort('duration')}>Süre {sortKey === 'duration' ? sortDirection === 'desc' ? '↓' : '↑' : '↕'}</button>
              </div>
              <label className="youtube-camera-page-size"><span>Sayfada</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>10 kayıt</option><option value={25}>25 kayıt</option><option value={50}>50 kayıt</option></select></label>
              <div className="youtube-camera-pagination"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>←</button><span>{page} / {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>→</button></div>
            </div>

            <div className="youtube-camera-list" aria-live="polite">
              {loading && !loaded ? <div className="youtube-camera-state"><strong>Film makaraları hazırlanıyor…</strong><span>YouTube kanalından güncel kayıtlar okunuyor.</span></div> : null}
              {error ? <div className="youtube-camera-state error"><strong>Video kataloğu açılamadı.</strong><span>{error}</span><button type="button" onClick={() => void load({ force: true })}>Tekrar dene</button></div> : null}
              {!loading && !error && visible.map((video) => <article className="youtube-camera-row" key={video.videoId}>
                <a className="youtube-camera-thumb" href={video.url} target="_blank" rel="noreferrer" title="YouTube'da aç"><img src={video.thumbnailUrl} alt="" loading="lazy" /><span aria-hidden="true">▶</span></a>
                <div className="youtube-camera-copy">
                  <a href={video.url} target="_blank" rel="noreferrer">{video.title}</a>
                  {video.summary ? <p className="youtube-camera-summary" title={video.summary}>{video.summary}</p> : null}
                  <small>{video.videoId}</small>
                </div>
                <time>{formatDate(video.publishedAt, video.publishedText)}</time>
                <span className="youtube-camera-duration">{formatDuration(video.durationSeconds, video.durationText)}</span>
                <div className="youtube-camera-flags">{video.isShort ? <b>SHORTS</b> : null}{video.isLive ? <b>CANLI</b> : null}{video.membersOnly ? <b>ÜYE</b> : null}</div>
              </article>)}
              {!loading && !error && !visible.length ? <div className="youtube-camera-state"><strong>Bu filtrelerde kayıt yok.</strong><span>Filtreleri değiştir veya kanalı yenile.</span></div> : null}
            </div>
          </div>
        </div>
        <div className="youtube-camera-hardware-controls" aria-hidden="true">
          <span className="youtube-camera-zoom"><b>W</b><i /><b>T</b></span>
          <span><i />MENU</span>
          <span><i />DISPLAY</span>
          <span><i />MODE</span>
          <span className="youtube-camera-standby"><i />STANDBY</span>
        </div>
      </section>
    </div> : null}
  </>;
}
