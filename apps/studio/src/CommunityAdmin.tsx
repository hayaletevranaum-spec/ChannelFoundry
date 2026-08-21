import { FormEvent, useEffect, useMemo, useState } from "react";

type CommunityUserView = StudioCommunityUser & {
  email?: string | null;
  emailVerified?: boolean;
  specialAccess?: boolean;
};

type ComposerVisibility = "community" | "special";

type ForumAuthor = {
  username: string;
  displayName: string;
};

type ForumAttachment = {
  id: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

type ForumPost = {
  id: number;
  body: string;
  createdAt: string;
  editedAt: string | null;
  attachments: ForumAttachment[];
  author: ForumAuthor;
};

type ForumThreadSummary = {
  id: number;
  title: string;
  visibility: ComposerVisibility;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  postCount: number;
  author: ForumAuthor;
};

type ForumThreadDetail = Omit<ForumThreadSummary, "postCount"> & {
  posts: ForumPost[];
};

type CommunityCommandResult = Record<string, unknown>;
type CommunityCommand = (input: Record<string, unknown>) => Promise<CommunityCommandResult>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string | null) {
  if (!value) return "Henüz giriş yapmadı";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function specialAccess(user: CommunityUserView) {
  return Boolean(user.specialAccess ?? user.researchAccess);
}

export default function CommunityAdmin() {
  const bridge = window.birdesengorStudio;
  const command = bridge?.communitySetResearch as unknown as CommunityCommand | undefined;
  const [session, setSession] = useState<StudioCommunitySession | null>(null);
  const [users, setUsers] = useState<CommunityUserView[]>([]);
  const [threads, setThreads] = useState<ForumThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<ForumThreadDetail | null>(null);
  const [query, setQuery] = useState("");
  const [forumQuery, setForumQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [forumBusy, setForumBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postVisibility, setPostVisibility] = useState<ComposerVisibility>("community");
  const [postAttachment, setPostAttachment] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const loadUsers = async () => {
    if (!bridge) throw new Error("Community yönetim köprüsü bulunamadı.");
    const result = await bridge.communityUsers();
    setUsers(result.users as CommunityUserView[]);
  };

  const loadThread = async (threadId: number) => {
    if (!command) throw new Error("Forum yönetim komutu bulunamadı.");
    const result = await command({ action: "forumThread", threadId });
    const thread = result.thread as ForumThreadDetail | undefined;
    if (!thread) throw new Error("Forum konusu alınamadı.");
    setSelectedThread(thread);
    return thread;
  };

  const loadForum = async (preferredThreadId?: number | null) => {
    if (!command) throw new Error("Forum yönetim komutu bulunamadı.");
    const result = await command({ action: "forumThreads" });
    const nextThreads = (result.threads as ForumThreadSummary[] | undefined) ?? [];
    setThreads(nextThreads);
    const nextSelected = preferredThreadId && nextThreads.some((thread) => thread.id === preferredThreadId)
      ? preferredThreadId
      : selectedThreadId && nextThreads.some((thread) => thread.id === selectedThreadId)
        ? selectedThreadId
        : nextThreads[0]?.id ?? null;
    setSelectedThreadId(nextSelected);
    if (!nextSelected) setSelectedThread(null);
    return nextSelected;
  };

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (!bridge) return;
      try {
        const nextSession = await bridge.communityAdminConnect();
        if (cancelled) return;
        setSession(nextSession);
        if (nextSession.connected) {
          await Promise.all([loadUsers(), loadForum()]);
        }
      } catch (bootError) {
        if (!cancelled) setError(errorText(bootError));
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session?.connected || !selectedThreadId || !command) return;
    let cancelled = false;
    setForumBusy(true);
    void loadThread(selectedThreadId)
      .catch((loadError) => {
        if (!cancelled) {
          setSelectedThread(null);
          setError(errorText(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setForumBusy(false);
      });
    return () => { cancelled = true; };
  }, [selectedThreadId, session?.connected]);

  const metrics = useMemo(() => ({
    total: users.length,
    special: users.filter((user) => specialAccess(user) && user.status === "active").length,
    suspended: users.filter((user) => user.status === "suspended").length,
    threads: threads.length,
    posts: threads.reduce((sum, thread) => sum + thread.postCount, 0),
  }), [threads, users]);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    if (!term) return users;
    return users.filter((user) => `${user.displayName} ${user.username} ${user.email ?? ""}`.toLocaleLowerCase("tr-TR").includes(term));
  }, [query, users]);

  const filteredThreads = useMemo(() => {
    const term = forumQuery.trim().toLocaleLowerCase("tr-TR");
    if (!term) return threads;
    return threads.filter((thread) =>
      `${thread.title} ${thread.author.displayName} ${thread.author.username} ${thread.visibility}`
        .toLocaleLowerCase("tr-TR")
        .includes(term));
  }, [forumQuery, threads]);

  const changeSpecial = async (user: CommunityUserView) => {
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const enabled = !specialAccess(user);
      await bridge.communitySetResearch({ userId: user.id, enabled });
      setUsers((current) => current.map((candidate) => candidate.id === user.id
        ? { ...candidate, specialAccess: enabled, researchAccess: enabled }
        : candidate));
      setNotice(`${user.displayName} için özel paylaşım yetkisi ${enabled ? "açıldı" : "kapatıldı"}.`);
    } catch (changeError) {
      setError(errorText(changeError));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (user: CommunityUserView) => {
    if (!bridge) return;
    const nextStatus = user.status === "active" ? "suspended" : "active";
    const action = nextStatus === "suspended" ? "üyeliği iptal edilsin" : "üyeliği yeniden açılsın";
    if (!window.confirm(`“${user.displayName}” için ${action} mı? Forum geçmişi korunacaktır.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await bridge.communitySetStatus({ userId: user.id, status: nextStatus });
      setUsers((current) => current.map((candidate) => candidate.id === user.id
        ? { ...candidate, status: nextStatus, ...(nextStatus === "suspended" ? { specialAccess: false, researchAccess: false } : {}) }
        : candidate));
      setNotice(`${user.displayName} üyeliği ${nextStatus === "active" ? "yeniden açıldı" : "iptal edildi"}.`);
    } catch (changeError) {
      setError(errorText(changeError));
    } finally {
      setBusy(false);
    }
  };

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!command) return;
    if (postAttachment && postAttachment.size > 12 * 1024 * 1024) {
      setError("Forum eki 12 MB sınırını aşıyor.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const attachment = postAttachment ? {
        name: postAttachment.name,
        type: postAttachment.type || "application/octet-stream",
        data: new Uint8Array(await postAttachment.arrayBuffer()),
      } : null;
      const result = await command({
        action: "createThread",
        title: postTitle,
        body: postBody,
        visibility: postVisibility,
        attachment,
      });
      const createdThreadId = Number(result.threadId || 0) || null;
      setPostTitle("");
      setPostBody("");
      setPostAttachment(null);
      setFileKey((value) => value + 1);
      setNotice(postVisibility === "special"
        ? "Özel paylaşım yayınlandı. Yalnızca özel yetkili üyeler görebilir."
        : "Topluluk paylaşımı yayınlandı.");
      await Promise.all([loadUsers(), loadForum(createdThreadId)]);
      if (createdThreadId) setSelectedThreadId(createdThreadId);
    } catch (postError) {
      setError(errorText(postError));
    } finally {
      setBusy(false);
    }
  };

  const refreshForum = async () => {
    setForumBusy(true);
    setError(null);
    try {
      const nextSelected = await loadForum(selectedThreadId);
      if (nextSelected) await loadThread(nextSelected);
    } catch (refreshError) {
      setError(errorText(refreshError));
    } finally {
      setForumBusy(false);
    }
  };

  const updateThread = async (changes: Partial<Pick<ForumThreadDetail, "visibility" | "locked">>) => {
    if (!command || !selectedThread) return;
    const visibility = changes.visibility ?? selectedThread.visibility;
    const locked = changes.locked ?? selectedThread.locked;
    setForumBusy(true);
    setError(null);
    setNotice(null);
    try {
      await command({
        action: "updateThread",
        threadId: selectedThread.id,
        visibility,
        locked,
      });
      setSelectedThread((current) => current ? { ...current, visibility, locked } : current);
      setThreads((current) => current.map((thread) => thread.id === selectedThread.id
        ? { ...thread, visibility, locked }
        : thread));
      setNotice(`“${selectedThread.title}” konusu güncellendi.`);
    } catch (updateError) {
      setError(errorText(updateError));
    } finally {
      setForumBusy(false);
    }
  };

  const deleteThread = async () => {
    if (!command || !selectedThread) return;
    if (!window.confirm(`“${selectedThread.title}” konusu ve tüm mesajları kalıcı olarak silinsin mi?`)) return;
    setForumBusy(true);
    setError(null);
    setNotice(null);
    try {
      await command({ action: "deleteThread", threadId: selectedThread.id });
      setNotice(`“${selectedThread.title}” konusu silindi.`);
      setSelectedThread(null);
      setSelectedThreadId(null);
      await Promise.all([loadUsers(), loadForum(null)]);
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setForumBusy(false);
    }
  };

  const deletePost = async (post: ForumPost) => {
    if (!command || !selectedThread) return;
    if (!window.confirm(`${post.author.displayName} tarafından gönderilen bu mesaj silinsin mi?`)) return;
    setForumBusy(true);
    setError(null);
    setNotice(null);
    try {
      await command({ action: "deletePost", postId: post.id });
      setNotice("Forum mesajı silindi.");
      await Promise.all([loadThread(selectedThread.id), loadUsers(), loadForum(selectedThread.id)]);
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setForumBusy(false);
    }
  };

  if (!bridge) {
    return <section className="community-admin-empty panel">
      <small>COMMUNITY</small>
      <h2>Yönetim köprüsü bulunamadı.</h2>
      <p>Bu ekran yalnızca Electron Studio içinde çalışır.</p>
    </section>;
  }

  if (!session?.connected) {
    return <section className="community-admin-unavailable panel">
      <small>FORUM YÖNETİMİ</small>
      <h2>Yönetici bağlantısı gerekli.</h2>
      <p>{session?.lastError || "Forum yönetim işlemlerini kullanmak için Ayarlar sayfasında yönetici bağlantısını bir kez yapılandır."}</p>
      <button className="primary-button" onClick={() => void bridge.navigate("Ayarlar")}>Yönetici bağlantısını ayarla</button>
    </section>;
  }

  return <section className="community-admin-view">
    <div className="community-admin-heading">
      <span className={error ? "community-inline-status error" : notice ? "community-inline-status success" : "community-inline-status"} aria-live="polite">{error ?? notice ?? ""}</span>
      <div className="community-admin-session">
        <span className="local-dot" />
        <div><small>FORUM YÖNETİCİSİ</small><strong>{session.username}</strong></div>
        <button className="text-button" onClick={() => void bridge.navigate("Ayarlar")}>Bağlantı ayarları</button>
      </div>
    </div>

    <div className="community-admin-metrics">
      <article className="metric-card"><span>Üyeler</span><strong>{metrics.total}</strong><small>{metrics.suspended} üyelik erişime kapalı</small></article>
      <article className="metric-card"><span>Özel yetki</span><strong>{metrics.special}</strong><small>Özel paylaşımları görebilen</small></article>
      <article className="metric-card"><span>Konular</span><strong>{metrics.threads}</strong><small>Forumda kayıtlı başlık</small></article>
      <article className="metric-card"><span>Mesajlar</span><strong>{metrics.posts}</strong><small>Başlangıç + yanıtlar</small></article>
    </div>

    <section className="panel community-admin-compose-panel">
      <header>
        <div><small>YÖNETİCİ PAYLAŞIMI</small><h3>Forumda yeni başlık aç</h3><p>Topluluk paylaşımı tüm aktif üyelere; özel paylaşım yalnızca özel yetkili üyelere görünür.</p></div>
        <span className={postVisibility === "special" ? "community-visibility special" : "community-visibility"}>{postVisibility === "special" ? "ÖZEL" : "TOPLULUK"}</span>
      </header>
      <form onSubmit={submitPost}>
        <label><span>Başlık</span><input value={postTitle} onChange={(event) => setPostTitle(event.target.value)} minLength={4} maxLength={140} required /></label>
        <label className="community-compose-visibility"><span>Paylaşım alanı</span><select value={postVisibility} onChange={(event) => setPostVisibility(event.target.value as ComposerVisibility)}><option value="community">Topluluk</option><option value="special">Özel</option></select></label>
        <label className="community-compose-message"><span>Mesaj</span><textarea value={postBody} onChange={(event) => setPostBody(event.target.value)} minLength={2} maxLength={12000} rows={5} required /></label>
        <label className="community-compose-file"><span>Dosya · isteğe bağlı · en fazla 12 MB</span><input key={fileKey} type="file" accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.zip,.docx,.xlsx,.pptx" onChange={(event) => setPostAttachment(event.target.files?.[0] || null)} /></label>
        <div className="community-compose-actions"><span>{postAttachment ? `${postAttachment.name} · ${(postAttachment.size / 1024 / 1024).toFixed(1)} MB` : "Dosya eklenmedi"}</span><button className="primary-button" type="submit" disabled={busy}>{busy ? "Yayınlanıyor…" : "Foruma yayınla"}</button></div>
      </form>
    </section>

    <section className="panel community-forum-admin-panel">
      <div className="community-admin-toolbar">
        <div><small>FORUM İÇERİĞİ</small><h3>Gönderilen mesajlar</h3></div>
        <div className="community-admin-tools">
          <input value={forumQuery} onChange={(event) => setForumQuery(event.target.value)} placeholder="Başlık veya kullanıcı ara…" />
          <button className="secondary-button" onClick={() => void refreshForum()} disabled={forumBusy}>Yenile</button>
        </div>
      </div>

      <div className="community-forum-admin-layout">
        <div className="community-forum-thread-list">
          {filteredThreads.map((thread) => <button
            type="button"
            key={thread.id}
            className={thread.id === selectedThreadId ? "community-forum-thread active" : "community-forum-thread"}
            onClick={() => setSelectedThreadId(thread.id)}
          >
            <span className={thread.visibility === "special" ? "community-visibility special" : "community-visibility"}>{thread.visibility === "special" ? "ÖZEL" : "TOPLULUK"}</span>
            <strong>{thread.title}</strong>
            <small>@{thread.author.username} · {thread.postCount} mesaj</small>
            <small>{formatDate(thread.updatedAt)}{thread.locked ? " · kilitli" : ""}</small>
          </button>)}
          {!filteredThreads.length && <div className="community-forum-list-empty">Forum konusu bulunamadı.</div>}
        </div>

        <div className="community-forum-thread-detail">
          {!selectedThread && !forumBusy && <div className="community-forum-detail-empty"><small>FORUM</small><h3>Bir konu seç.</h3><p>Mesajları, görünürlük durumunu ve yanıtları buradan yönetebilirsin.</p></div>}
          {forumBusy && !selectedThread && <div className="community-forum-detail-empty">Forum yükleniyor…</div>}
          {selectedThread && <>
            <header className="community-forum-detail-header">
              <div>
                <small>@{selectedThread.author.username} · {formatDate(selectedThread.createdAt)}</small>
                <h3>{selectedThread.title}</h3>
              </div>
              <div className="community-forum-detail-actions">
                <label>
                  <span>Görünürlük</span>
                  <select
                    value={selectedThread.visibility}
                    onChange={(event) => void updateThread({ visibility: event.target.value as ComposerVisibility })}
                    disabled={forumBusy}
                  >
                    <option value="community">Topluluk</option>
                    <option value="special">Özel</option>
                  </select>
                </label>
                <button className="secondary-button" onClick={() => void updateThread({ locked: !selectedThread.locked })} disabled={forumBusy}>
                  {selectedThread.locked ? "Yanıtları aç" : "Yanıtları kilitle"}
                </button>
                <button className="community-danger-button" onClick={() => void deleteThread()} disabled={forumBusy}>Konuyu sil</button>
              </div>
            </header>

            <div className="community-forum-posts">
              {selectedThread.posts.map((post, index) => <article className="community-forum-post-card" key={post.id}>
                <div className="community-forum-post-meta">
                  <div><strong>{post.author.displayName}</strong><small>@{post.author.username} · {formatDate(post.createdAt)}</small></div>
                  <div>
                    {index === 0
                      ? <span className="community-forum-origin">Başlangıç mesajı</span>
                      : <button className="community-danger-link" onClick={() => void deletePost(post)} disabled={forumBusy}>Mesajı sil</button>}
                  </div>
                </div>
                <p>{post.body}</p>
                {!!post.attachments.length && <div className="community-forum-attachments">
                  {post.attachments.map((attachment) => <span key={attachment.id}>{attachment.name} · {formatBytes(attachment.sizeBytes)}</span>)}
                </div>}
              </article>)}
            </div>
          </>}
        </div>
      </div>
    </section>

    <section className="panel community-admin-list-panel">
      <div className="community-admin-toolbar">
        <div><small>ÜYE DİZİNİ</small><h3>Üyelik ve özel erişim</h3></div>
        <div className="community-admin-tools">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad, kullanıcı veya e-posta ara…" />
          <button className="secondary-button" onClick={() => void loadUsers()} disabled={busy}>Yenile</button>
        </div>
      </div>
      <div className="community-admin-users">
        {filteredUsers.map((user) => {
          const isCurrentAdmin = user.username === session.username;
          const hasSpecialAccess = specialAccess(user);
          return <article className={user.status === "suspended" ? "community-user-card suspended" : "community-user-card"} key={user.id}>
            <div className="community-user-identity">
              <span className={user.role === "admin" ? "community-role admin" : "community-role"}>{user.role === "admin" ? "AD" : "ÜY"}</span>
              <div>
                <strong>{user.displayName}</strong>
                <small>@{user.username} · {user.role === "admin" ? "Yönetici" : "Üye"}</small>
                <small>{user.email || "Eski üyelik · e-posta kaydı yok"}{user.email ? (user.emailVerified === false ? " · doğrulanmamış" : " · doğrulandı") : ""}</small>
              </div>
            </div>
            <div className="community-user-activity">
              <span>{user.threadCount} konu</span>
              <span>{user.postCount} mesaj</span>
              <small>Son giriş: {formatDate(user.lastLoginAt)}</small>
            </div>
            <div className="community-user-actions">
              <button
                className={hasSpecialAccess ? "research-toggle enabled" : "research-toggle"}
                onClick={() => void changeSpecial(user)}
                disabled={busy || user.status === "suspended" || user.role === "admin"}
                title={user.role === "admin" ? "Yöneticiler özel paylaşımları doğrudan görebilir." : undefined}
              >
                <span>{hasSpecialAccess || user.role === "admin" ? "●" : "○"}</span>
                Özel Yetki {hasSpecialAccess || user.role === "admin" ? "Açık" : "Kapalı"}
              </button>
              <button
                className={user.status === "suspended" ? "status-toggle suspended" : "status-toggle"}
                onClick={() => void changeStatus(user)}
                disabled={busy || isCurrentAdmin}
                title={isCurrentAdmin ? "Aktif yönetici kendi üyeliğini iptal edemez." : undefined}
              >
                {user.status === "active" ? "Üyeliği iptal et" : "Üyeliği yeniden aç"}
              </button>
            </div>
          </article>;
        })}
        {!filteredUsers.length && <div className="community-admin-empty"><small>ÜYE DİZİNİ</small><h3>Eşleşen kullanıcı yok.</h3></div>}
      </div>
    </section>
  </section>;
}
