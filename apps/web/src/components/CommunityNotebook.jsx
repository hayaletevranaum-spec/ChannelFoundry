import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BabylonBookViewport } from '../3d/BabylonBookViewport.jsx';
import { Page, PageTurnMarkers, quadTransform, useViewportMode, validLayout } from '../3d/BabylonBookShell.jsx';

const EMPTY_META = { title: 'Topluluk Defteri', subtitle: 'Üyelerin başlık, mesaj ve dosya paylaşım alanı' };
const EMPTY_CREDITS = { sponsors: [], contributors: [] };
const MAX_ATTACHMENT = 12 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.zip,.docx,.xlsx,.pptx';
const COMMUNITY_PAGE_SIZES = Object.freeze({ desktop: 4, mobile: 3 });
const SECTION_ORDER = Object.freeze(['community', 'sponsors', 'contributors']);

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value) {
  if (!value) return '';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatCreditDate(value) {
  if (!value) return 'Tarih belirtilmedi';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateAttachment(file) {
  if (!file) return null;
  if (file.size > MAX_ATTACHMENT) throw new Error('Dosya 12 MB sınırını aşıyor.');
  return file;
}

function creditVideoHref(video) {
  const direct = String(video?.url || '').trim();
  if (direct) {
    try {
      const url = new URL(direct, window.location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch {}
  }
  const id = String(video?.id || '').trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
}

function SupportLedger({ kind, entries }) {
  const sponsorMode = kind === 'sponsor';
  const title = sponsorMode ? 'Sponsor kayıtları' : 'Katkı kayıtları';
  const intro = sponsorMode
    ? 'Projeye veya belirli bir yayına destek veren sponsorlar; tarih ve varsa ilgili video bilgisiyle burada yer alır.'
    : 'İçerik, araştırma veya üretim sürecine katkı sağlayanlar; tarih ve varsa ilgili video bilgisiyle burada yer alır.';

  return <section className="community-credit-page">
    <header className="community-credit-intro">
      <div><small>{sponsorMode ? 'DESTEK KAYITLARI' : 'KATKI KAYITLARI'}</small><h3>{title}</h3></div>
      <p>{intro}</p>
    </header>
    {!entries.length ? <div className="community-empty-state community-credit-empty">
      <strong>{sponsorMode ? 'Henüz sponsor kaydı yok.' : 'Henüz katkı kaydı yok.'}</strong>
      <p>Yeni kayıtlar eklendiğinde tarih ve ilgili yayın bilgileri burada listelenecek.</p>
    </div> : <div className="community-credit-list">
      {entries.map((entry) => {
        const href = creditVideoHref(entry.video);
        const videoLabel = entry.video?.title || entry.video?.id || 'Genel destek / video belirtilmedi';
        return <article className="community-credit-entry" key={entry.id}>
          <div className="community-credit-person">
            <small>{sponsorMode ? 'SPONSOR' : 'KATKIDA BULUNAN'}</small>
            <strong>{entry.name}</strong>
            {entry.note ? <p>{entry.note}</p> : null}
          </div>
          <div className="community-credit-date">
            <small>TARİH</small>
            <span>{formatCreditDate(entry.date)}</span>
          </div>
          <div className="community-credit-video">
            <small>İLGİLİ VİDEO</small>
            {href ? <a href={href} target="_blank" rel="noreferrer">
              <span>{videoLabel}</span>
              {entry.video?.id ? <em>Video ID: {entry.video.id}</em> : null}
            </a> : <span>{videoLabel}</span>}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}

export function CommunityNotebook({ provider }) {
  const mode = useViewportMode();
  const engineRef = useRef(null);
  const [isOpen, setOpen] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [phase, setPhase] = useState('closed');
  const [contentVisible, setContentVisible] = useState(false);
  const [contentEntering, setContentEntering] = useState(false);
  const [turning, setTurning] = useState(false);
  const [layout, setLayout] = useState(null);
  const [section, setSection] = useState('community');
  const [meta, setMeta] = useState(EMPTY_META);
  const [credits, setCredits] = useState(EMPTY_CREDITS);
  const [session, setSession] = useState({ authenticated: false, user: null });
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [view, setView] = useState('threads');
  const [authMode, setAuthMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [canResend, setCanResend] = useState(false);
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [register, setRegister] = useState({ username: '', displayName: '', email: '', password: '' });
  const [draft, setDraft] = useState({ title: '', body: '', attachment: null });
  const [reply, setReply] = useState({ body: '', attachment: null });
  const [draftFileKey, setDraftFileKey] = useState(0);
  const [replyFileKey, setReplyFileKey] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  const loadThreads = async () => {
    const nextThreads = await provider.listThreads({ limit: 100 });
    setThreads(Array.isArray(nextThreads) ? nextThreads : []);
  };

  const refreshSession = async () => {
    const nextSession = await provider.getSession();
    setSession(nextSession);
    if (nextSession?.authenticated) await loadThreads();
    else setThreads([]);
    return nextSession;
  };

  const refreshForum = async () => {
    setBusy(true);
    setLoadError('');
    try {
      await refreshSession();
    } catch (refreshError) {
      setLoadError(errorText(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const handleReady = useCallback((api) => {
    engineRef.current = api;
    setEngineReady(Boolean(api));
  }, []);

  const handleLayout = useCallback((nextLayout) => {
    if (validLayout(nextLayout)) setLayout(nextLayout);
  }, []);

  function refreshLayout(engine = engineRef.current) {
    if (!engine?.getPresentationLayout) return;
    const nextLayout = engine.getPresentationLayout();
    if (validLayout(nextLayout)) setLayout(nextLayout);
  }

  useEffect(() => {
    const engine = engineRef.current;
    if (!isOpen || !engineReady || phase !== 'closed' || !engine) return;
    setPhase('opening');
    void engine.open().then(() => {
      if (engineRef.current !== engine) return;
      refreshLayout(engine);
      setPhase('open');
      setContentVisible(true);
      setContentEntering(true);
    });
  }, [engineReady, isOpen, phase]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const verification = url.searchParams.get('community');
    if (!verification) return;
    if (verification === 'verified') {
      setNotice('E-posta adresin doğrulandı. Şimdi giriş yapabilirsin.');
    } else if (verification === 'verification-error') {
      setLoadError('Doğrulama bağlantısı geçersiz veya süresi dolmuş. Giriş bilgilerinle yeni bir bağlantı isteyebilirsin.');
      setCanResend(true);
    }
    setSection('community');
    setOpen(true);
    url.searchParams.delete('community');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const creditsPromise = typeof provider.getCredits === 'function'
      ? provider.getCredits().catch(() => EMPTY_CREDITS)
      : Promise.resolve(EMPTY_CREDITS);
    Promise.all([provider.getNotebookMeta(), provider.getSession(), creditsPromise]).then(async ([nextMeta, nextSession, nextCredits]) => {
      if (cancelled) return;
      setMeta(nextMeta ?? EMPTY_META);
      setSession(nextSession);
      setCredits(nextCredits ?? EMPTY_CREDITS);
      if (nextSession?.authenticated) {
        const nextThreads = await provider.listThreads({ limit: 100 });
        if (!cancelled) setThreads(Array.isArray(nextThreads) ? nextThreads : []);
      } else if (!cancelled) {
        setThreads([]);
      }
    }).catch((error) => {
      if (!cancelled) setLoadError(errorText(error));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, provider]);

  async function closeBook() {
    const engine = engineRef.current;
    if (!engine || phase !== 'open' || turning) return;
    setOpen(false);
    setPhase('closing');
    setContentEntering(false);
    setContentVisible(false);
    await engine.close();
    setSelectedThread(null);
    setView('threads');
    setSection('community');
    setPageIndex(0);
    setPhase('closed');
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') void closeBook(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, phase, turning]);

  async function animateTurn(direction, action) {
    const engine = engineRef.current;
    if (!engine || phase !== 'open' || turning) return false;
    setTurning(true);
    try {
      await engine.turnPage(direction, action);
      refreshLayout(engine);
      return true;
    } finally {
      setTurning(false);
    }
  }

  const submitLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setLoadError('');
    setNotice('');
    setCanResend(false);
    try {
      const result = await provider.login(login);
      setSession(result);
      await loadThreads();
      setView('threads');
      setNotice(`Hoş geldin, ${result.user?.displayName || result.user?.username}.`);
    } catch (error) {
      setLoadError(errorText(error));
      setCanResend(error?.code === 'email_not_verified');
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setBusy(true);
    setLoadError('');
    setNotice('');
    try {
      await provider.register(register);
      setAuthMode('login');
      setLogin((current) => ({ ...current, identifier: register.email }));
      setNotice('Üyelik oluşturuldu. E-postana gönderilen doğrulama bağlantısını açtıktan sonra giriş yapabilirsin.');
      setCanResend(true);
    } catch (error) {
      setLoadError(errorText(error));
      if (error?.code === 'email_delivery_failed') {
        setAuthMode('login');
        setLogin((current) => ({ ...current, identifier: register.email, password: register.password }));
        setCanResend(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!login.identifier || !login.password) {
      setLoadError('Doğrulama e-postasını yeniden göndermek için kullanıcı adı/e-posta ve parolanı gir.');
      return;
    }
    setBusy(true);
    setLoadError('');
    setNotice('');
    try {
      const result = await provider.resendVerification(login);
      setNotice(result.alreadyVerified ? 'E-posta zaten doğrulanmış. Giriş yapabilirsin.' : 'Yeni doğrulama e-postası gönderildi.');
      setCanResend(false);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setLoadError('');
    try {
      await provider.logout();
      setSession({ authenticated: false, user: null });
      setThreads([]);
      setSelectedThread(null);
      setView('threads');
      setNotice('Oturum kapatıldı.');
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const openThread = async (threadId) => {
    setBusy(true);
    setLoadError('');
    try {
      const thread = await provider.getThread(threadId);
      await animateTurn('forward', () => {
        setSelectedThread(thread);
        setView('thread');
        setPageIndex(0);
      });
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const submitThread = async (event) => {
    event.preventDefault();
    setBusy(true);
    setLoadError('');
    setNotice('');
    try {
      const result = await provider.createThread(draft);
      setDraft({ title: '', body: '', attachment: null });
      setDraftFileKey((value) => value + 1);
      await loadThreads();
      await openThread(result.threadId);
      setNotice('Yeni başlık topluluk defterine eklendi.');
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (event) => {
    event.preventDefault();
    if (!selectedThread) return;
    setBusy(true);
    setLoadError('');
    setNotice('');
    try {
      await provider.reply({ threadId: selectedThread.id, ...reply });
      const thread = await provider.getThread(selectedThread.id);
      setSelectedThread(thread);
      setReply({ body: '', attachment: null });
      setReplyFileKey((value) => value + 1);
      await loadThreads();
      setNotice('Mesajın eklendi.');
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  function selectSection(nextSection) {
    if (nextSection === section || turning) return;
    const direction = SECTION_ORDER.indexOf(nextSection) > SECTION_ORDER.indexOf(section) ? 'forward' : 'backward';
    void animateTurn(direction, () => {
      setSection(nextSection);
      setSelectedThread(null);
      setView('threads');
      setPageIndex(0);
    });
  }

  function selectForumView(nextView) {
    if (nextView === view || turning) return;
    void animateTurn(nextView === 'threads' ? 'backward' : 'forward', () => {
      setView(nextView);
      if (nextView !== 'thread') setSelectedThread(null);
      setPageIndex(0);
    });
  }

  function selectAuthMode(nextMode) {
    if (nextMode === authMode || turning) return;
    void animateTurn(nextMode === 'register' ? 'forward' : 'backward', () => setAuthMode(nextMode));
  }

  function returnToThreads() {
    if (turning) return;
    void animateTurn('backward', () => {
      setView('threads');
      setSelectedThread(null);
      setPageIndex(0);
    });
  }

  const sectionMeta = section === 'sponsors'
    ? { eyebrow: 'DESTEK / SPONSORLAR', title: 'Sponsorlar', subtitle: 'Projeye ve yayınlara destek veren sponsorların kayıtları' }
    : section === 'contributors'
      ? { eyebrow: 'TOPLULUK / KATKI', title: 'Katkıda Bulunanlar', subtitle: 'İçerik ve üretim sürecine katkı sağlayanların kayıtları' }
      : { eyebrow: 'TOPLULUK / FORUM', title: meta.title, subtitle: meta.subtitle };

  const footerText = section === 'sponsors'
    ? 'Sponsor kayıtları tarih ve varsa ilgili yayın bilgisiyle tutulur.'
    : section === 'contributors'
      ? 'Katkı kayıtları tarih ve varsa ilgili yayın bilgisiyle tutulur.'
      : 'Topluluk alanı yayınlanan ana günlük içeriğinden bağımsızdır.';
  const pageSize = COMMUNITY_PAGE_SIZES[mode];
  const activeEntryCount = section === 'sponsors'
    ? (credits.sponsors || []).length
    : section === 'contributors'
      ? (credits.contributors || []).length
      : session?.authenticated && view === 'threads' ? threads.length : 0;
  const pageTotal = Math.max(1, Math.ceil(activeEntryCount / pageSize));
  const resolvedPageIndex = Math.min(pageIndex, pageTotal - 1);
  const pageStart = resolvedPageIndex * pageSize;
  const visibleThreads = useMemo(() => threads.slice(pageStart, pageStart + pageSize), [pageSize, pageStart, threads]);
  const visibleSponsors = useMemo(() => (credits.sponsors || []).slice(pageStart, pageStart + pageSize), [credits.sponsors, pageSize, pageStart]);
  const visibleContributors = useMemo(() => (credits.contributors || []).slice(pageStart, pageStart + pageSize), [credits.contributors, pageSize, pageStart]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageTotal - 1));
  }, [pageTotal]);

  function moveListPage(delta) {
    const next = Math.min(Math.max(resolvedPageIndex + delta, 0), pageTotal - 1);
    if (next === resolvedPageIndex || turning) return;
    void animateTurn(delta > 0 ? 'forward' : 'backward', () => setPageIndex(next));
  }

  const sectionTabs = (
    <nav className="community-section-tabs" aria-label="Topluluk defteri bölümleri">
      <button type="button" className={section === 'community' ? 'active' : ''} onClick={() => selectSection('community')} disabled={turning}><span>01</span>Topluluk Defteri</button>
      <button type="button" className={section === 'sponsors' ? 'active' : ''} onClick={() => selectSection('sponsors')} disabled={turning}><span>02</span>Sponsorlar</button>
      <button type="button" className={section === 'contributors' ? 'active' : ''} onClick={() => selectSection('contributors')} disabled={turning}><span>03</span>Katkıda Bulunanlar</button>
    </nav>
  );

  const pageHeader = (
    <header className="community-sheet-header">
      <div>
        <small>{sectionMeta.eyebrow}</small>
        <h2 id="community-notebook-title">{sectionMeta.title}</h2>
        <p>{sectionMeta.subtitle}</p>
      </div>
      {pageTotal > 1 ? <span className="community-page-counter">{resolvedPageIndex + 1} / {pageTotal}</span> : null}
    </header>
  );

  const communityBody = (
    <div className="community-thread-area">
      {loading ? <p className="community-state-note">Topluluk kayıtları hazırlanıyor…</p> : null}

      {!loading && section === 'sponsors' ? <SupportLedger kind="sponsor" entries={visibleSponsors} /> : null}
      {!loading && section === 'contributors' ? <SupportLedger kind="contributor" entries={visibleContributors} /> : null}

      {section === 'community' ? <>
        {loadError ? <div className="community-notice error" role="alert">{loadError}</div> : null}
        {notice ? <div className="community-notice success" aria-live="polite">{notice}</div> : null}

        {!loading && !session?.authenticated ? <div className="community-auth-shell">
          <div className="community-auth-tabs" role="tablist">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => selectAuthMode('login')} disabled={turning}>Giriş</button>
            <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => selectAuthMode('register')} disabled={turning}>Üyelik</button>
          </div>
          {authMode === 'login' ? <form className="community-form" onSubmit={submitLogin}>
            <label><span>Kullanıcı adı veya e-posta</span><input autoComplete="username" value={login.identifier} onChange={(event) => setLogin({ ...login, identifier: event.target.value })} required /></label>
            <label><span>Parola</span><input type="password" autoComplete="current-password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} required /></label>
            <div className="community-form-actions">
              {canResend ? <button type="button" className="community-link-button" onClick={resendVerification} disabled={busy}>Doğrulama e-postasını yeniden gönder</button> : <span />}
              <button type="submit" className="community-primary-button" disabled={busy}>{busy ? 'Kontrol ediliyor…' : 'Deftere giriş yap'}</button>
            </div>
          </form> : <form className="community-form community-register-form" onSubmit={submitRegister}>
            <label><span>Kullanıcı adı</span><input autoComplete="username" value={register.username} onChange={(event) => setRegister({ ...register, username: event.target.value })} minLength={3} maxLength={32} required /></label>
            <label><span>Görünen ad</span><input value={register.displayName} onChange={(event) => setRegister({ ...register, displayName: event.target.value })} maxLength={80} required /></label>
            <label><span>E-posta</span><input type="email" autoComplete="email" value={register.email} onChange={(event) => setRegister({ ...register, email: event.target.value })} required /></label>
            <label><span>Parola</span><input type="password" autoComplete="new-password" value={register.password} onChange={(event) => setRegister({ ...register, password: event.target.value })} minLength={8} required /></label>
            <div className="community-form-actions"><span className="community-form-hint">Üyelik e-posta bağlantısıyla etkinleşir.</span><button type="submit" className="community-primary-button" disabled={busy}>Üyelik oluştur</button></div>
          </form>}
        </div> : null}

        {!loading && session?.authenticated ? <div className="community-forum-shell">
          <nav className="community-forum-toolbar" aria-label="Forum işlemleri">
            <button type="button" className={view === 'threads' ? 'active' : ''} onClick={() => selectForumView('threads')} disabled={turning}>Başlıklar</button>
            <button type="button" className={view === 'create' ? 'active' : ''} onClick={() => selectForumView('create')} disabled={turning}>Yeni başlık</button>
            <span />
            <button type="button" onClick={() => void refreshForum()} disabled={busy}>Yenile</button>
            <button type="button" onClick={logout} disabled={busy}>Çıkış</button>
          </nav>

          {view === 'threads' ? <div className="community-thread-list">
            {threads.length === 0 ? <div className="community-empty-state"><strong>Henüz başlık yok.</strong><p>İlk topluluk başlığını açabilirsin.</p></div> : null}
            {visibleThreads.map((thread) => <button type="button" className="community-thread-preview" key={thread.threadId} onClick={() => void openThread(thread.threadId)} disabled={busy || turning}>
              <div><small>{thread.authorLabel ?? 'Topluluk'}</small>{thread.visibility === 'special' ? <span className="community-special-badge">ÖZEL</span> : null}</div>
              <h3>{thread.title}</h3>
              <p>{thread.excerpt ?? ''}{thread.locked ? ' · Yanıtlara kapalı' : ''}</p>
            </button>)}
          </div> : null}

          {view === 'create' ? <form className="community-form community-compose" onSubmit={submitThread}>
            <div><small>YENİ TOPLULUK BAŞLIĞI</small><h3>Deftere yeni bir sayfa ekle</h3></div>
            <label><span>Başlık</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} minLength={4} maxLength={140} required /></label>
            <label><span>Mesaj</span><textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} minLength={2} maxLength={12000} rows={6} required /></label>
            <label className="community-file-field"><span>Dosya (isteğe bağlı · en fazla 12 MB)</span><input key={draftFileKey} type="file" accept={ATTACHMENT_ACCEPT} onChange={(event) => {
              try { setDraft({ ...draft, attachment: validateAttachment(event.target.files?.[0] || null) }); setLoadError(''); }
              catch (error) { event.target.value = ''; setDraft({ ...draft, attachment: null }); setLoadError(errorText(error)); }
            }} /></label>
            <div className="community-form-actions"><button type="button" className="community-link-button" onClick={() => selectForumView('threads')}>Vazgeç</button><button type="submit" className="community-primary-button" disabled={busy}>Başlığı yayınla</button></div>
          </form> : null}

          {view === 'thread' && selectedThread ? <div className="community-thread-detail">
            <button type="button" className="community-back-button" onClick={returnToThreads} disabled={turning}>← Başlıklara dön</button>
            <header>
              <div><small>{selectedThread.author?.displayName || selectedThread.author?.username}</small>{selectedThread.visibility === 'special' ? <span className="community-special-badge">ÖZEL</span> : null}</div>
              <h3>{selectedThread.title}</h3>
              <p>{formatDate(selectedThread.createdAt)}</p>
            </header>
            <div className="community-post-list">
              {(selectedThread.posts || []).map((post) => <article className="community-post" key={post.id}>
                <div className="community-post-meta"><strong>{post.author?.displayName || post.author?.username}</strong><span>@{post.author?.username} · {formatDate(post.createdAt)}</span></div>
                <p>{post.body}</p>
                {post.attachments?.length ? <div className="community-attachments">{post.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} download>{attachment.name}<small>{formatBytes(attachment.sizeBytes)}</small></a>)}</div> : null}
              </article>)}
            </div>
            {!selectedThread.locked ? <form className="community-form community-reply-form" onSubmit={submitReply}>
              <label><span>Yanıtın</span><textarea value={reply.body} onChange={(event) => setReply({ ...reply, body: event.target.value })} minLength={2} maxLength={12000} rows={4} required /></label>
              <label className="community-file-field"><span>Dosya ekle (isteğe bağlı)</span><input key={replyFileKey} type="file" accept={ATTACHMENT_ACCEPT} onChange={(event) => {
                try { setReply({ ...reply, attachment: validateAttachment(event.target.files?.[0] || null) }); setLoadError(''); }
                catch (error) { event.target.value = ''; setReply({ ...reply, attachment: null }); setLoadError(errorText(error)); }
              }} /></label>
              <div className="community-form-actions"><span /><button type="submit" className="community-primary-button" disabled={busy}>Yanıtla</button></div>
            </form> : <p className="community-state-note">Bu başlık yeni yanıtlara kapalı.</p>}
          </div> : null}
        </div> : null}
      </> : null}
    </div>
  );

  const introPage = (
    <div className="community-notebook-intro">
      <span className="community-notebook-crest" aria-hidden="true">BDSG</span>
      <small>ORTAK KAYIT DEFTERİ</small>
      <h1>Channel Foundry<br />Topluluğu</h1>
      <p>Üyelerin bıraktığı notlar, açtığı başlıklar ve evrene katkı sunanların kayıtları.</p>
      {sectionTabs}
      {session?.authenticated ? <div className="community-member-chip">
        <small>DEFTER SAHİBİ</small>
        <strong>{session.user?.displayName || session.user?.username}</strong>
        <span>@{session.user?.username}{session.user?.specialAccess ? ' · Özel yetki' : ''}</span>
      </div> : <p className="community-intro-note">Kayıtları okumak ve not bırakmak için sağ sayfadan giriş yapabilirsin.</p>}
      <footer className="community-sheet-footer">{footerText}</footer>
    </div>
  );

  const stageStyle = layout ? {
    '--left-page-left': `${layout.leftPage.left}px`, '--left-page-top': `${layout.leftPage.top}px`, '--left-page-width': `${layout.leftPage.width}px`, '--left-page-height': `${layout.leftPage.height}px`, '--left-page-transform': quadTransform(layout.leftPage),
    '--right-page-left': `${layout.rightPage.left}px`, '--right-page-top': `${layout.rightPage.top}px`, '--right-page-width': `${layout.rightPage.width}px`, '--right-page-height': `${layout.rightPage.height}px`, '--right-page-transform': quadTransform(layout.rightPage),
    '--page-marker-back-x': `${layout.markers.back.x}px`, '--page-marker-back-y': `${layout.markers.back.y}px`, '--page-marker-forward-x': `${layout.markers.forward.x}px`, '--page-marker-forward-y': `${layout.markers.forward.y}px`,
    '--clasp-left': `${layout.clasp.left - 8}px`, '--clasp-top': `${layout.clasp.top - 8}px`, '--clasp-width': `${Math.max(54, layout.clasp.width + 16)}px`, '--clasp-height': `${Math.max(108, layout.clasp.height + 16)}px`,
  } : undefined;
  const bookOpen = phase === 'open';
  const showListMarkers = bookOpen && pageTotal > 1 && (section !== 'community' || (session?.authenticated && view === 'threads'));

  return <>
    <button
      type="button"
      className="community-notebook-launcher"
      aria-label="Masa üzerindeki Topluluk Not Defteri'ni aç"
      aria-expanded={isOpen}
      title="Topluluk Not Defteri"
      onClick={() => setOpen(true)}
      disabled={phase !== 'closed'}
    />
    <div className={`babylon-book-stage community-book-stage phase-${phase} mode-${mode}${turning ? ' is-turning' : ''}`} style={stageStyle}>
      <BabylonBookViewport bookVariant="community" onReady={handleReady} onLayout={handleLayout} mode={mode} />
      {contentVisible ? <div
        className={`babylon-book-content community-book-content${contentEntering ? ' is-content-entering' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-notebook-title"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'babylonContentReveal') setContentEntering(false);
        }}
      >
        {mode === 'desktop' ? <div className="spread babylon-spread community-book-spread">
          <Page side="left" className="community-book-page community-book-intro-page">{introPage}<span className="folio">I</span></Page>
          <Page side="right" scrollable className="community-book-page community-book-record-page">{pageHeader}{communityBody}<span className="folio">{resolvedPageIndex + 1}</span></Page>
        </div> : <Page scrollable className="community-book-page community-book-mobile-page">
          <div className="community-mobile-heading"><small>ORTAK KAYIT DEFTERİ</small>{sectionTabs}</div>
          {pageHeader}{communityBody}<span className="folio">{resolvedPageIndex + 1}</span>
        </Page>}
      </div> : null}
      {showListMarkers ? <PageTurnMarkers
        canGoBack={resolvedPageIndex > 0}
        canGoForward={resolvedPageIndex < pageTotal - 1}
        turning={turning}
        onBack={() => moveListPage(-1)}
        onForward={() => moveListPage(1)}
        ariaLabel="Topluluk defteri kayıt sayfaları"
        backLabel="Önceki kayıt sayfasına dön"
        forwardLabel="Sonraki kayıt sayfasına geç"
      /> : null}
      {bookOpen ? <button type="button" className="babylon-clasp-action community-book-clasp" onClick={closeBook} disabled={turning || busy} aria-label="Topluluk defterini kapat"><span className="book-clasp-emblem" aria-hidden="true" /></button> : null}
    </div>
  </>;
}
