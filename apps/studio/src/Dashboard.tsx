type DashboardTarget = "Video Arşivi" | "AI Atölyesi" | "Kayıt Dosyaları" | "Muhataplar" | "Yayınlama";
type DashboardItem = StudioPersistedItem & { relatedCount: number };
type ActionTone = "attention" | "active" | "review" | "ready" | "quiet";
type EditorialStats = StudioAiAnalysisStats & { editorialPending?: number; curated?: number; excluded?: number };
type MergeStatus = StudioUniverseMergeStatus & {
  ingest?: {
    pending?: number;
    processed?: number;
    newSources?: number;
    changedSources?: number;
    awaitingApplyRunId?: number | null;
    backlog?: { total?: number };
  };
};
type WorkspaceStatus = StudioUniverseWorkspaceStatus & {
  counts: StudioUniverseWorkspaceStatus["counts"] & { pendingRevisions?: number };
};

type Props = {
  items: DashboardItem[];
  relations: StudioPersistedRelation[];
  catalog: StudioYoutubeCatalogStats;
  catalogVideos: StudioYoutubeCatalogVideo[];
  aiStats: StudioAiAnalysisStats;
  mergeStatus: StudioUniverseMergeStatus | null;
  workspaceNodes: StudioUniverseWorkspaceNode[];
  workspaceStatus: StudioUniverseWorkspaceStatus | null;
  publicationInfo: StudioPublicationInfo | null;
  onNavigate: (section: DashboardTarget) => void;
};

type WorkAction = { label: string; note: string; value: number; target: DashboardTarget; tone: ActionTone };
type RecentWork = { key: string; title: string; meta: string; badge: string; state: string; stateClass: string; target: DashboardTarget };

const workspaceLabels: Record<StudioUniverseWorkspaceNode["kind"], string> = { story: "Hikâye", character: "Muhatap", event: "Olay", location: "Mekân", object: "Nesne" };
const workspaceShort: Record<StudioUniverseWorkspaceNode["kind"], string> = { story: "HK", character: "MH", event: "OL", location: "MK", object: "NS" };

function formatNumber(value: number) { return new Intl.NumberFormat("tr-TR").format(Math.max(0, value)); }
function publishedRelationCount(items: DashboardItem[], relations: StudioPersistedRelation[]) {
  const keys = new Set(items.filter((item) => item.status === "published").map((item) => item.key));
  return relations.filter((relation) => keys.has(relation.fromKey) && keys.has(relation.toKey)).length;
}
function buildRecent(workspaceNodes: StudioUniverseWorkspaceNode[]): RecentWork[] {
  return [...workspaceNodes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map((node) => ({
      key: `workspace:${node.key}`,
      title: node.name,
      meta: `${workspaceLabels[node.kind]} · ${node.sourceVideoIds.length} kaynak video`,
      badge: workspaceShort[node.kind],
      state: node.state === "approved" ? "Onaylı" : "İncele",
      stateClass: node.state === "approved" ? "approved" : "draft",
      target: node.state === "approved" ? (node.kind === "character" ? "Muhataplar" : "Kayıt Dosyaları") as DashboardTarget : "AI Atölyesi" as DashboardTarget,
    }));
}

export default function Dashboard({ items, relations, catalog, catalogVideos, aiStats, mergeStatus, workspaceNodes, workspaceStatus, publicationInfo, onNavigate }: Props) {
  const editorialStats = aiStats as EditorialStats;
  const incremental = mergeStatus as MergeStatus | null;
  const editorialWorkspace = workspaceStatus as WorkspaceStatus | null;
  const archivedTranscriptCount = catalogVideos.filter((video) => video.hasTranscript).length;
  const archiveCandidates = catalogVideos.filter((video) => !video.hasTranscript && ["manual", "automatic"].includes(video.subtitleStatus));
  const missingTranscripts = archiveCandidates.length;
  const aiQueue = aiStats.waiting + aiStats.running;
  const readyForAnalysis = Math.max(0, aiStats.transcripts - aiStats.analyzed - aiStats.waiting - aiStats.running - aiStats.errors);
  const editorialPending = editorialStats.editorialPending ?? Math.max(0, aiStats.analyzed - (editorialStats.curated ?? 0) - (editorialStats.excluded ?? 0));
  const curated = editorialStats.curated ?? 0;
  const excluded = editorialStats.excluded ?? 0;
  const workspaceDrafts = editorialWorkspace?.counts.draft ?? 0;
  const pendingRevisions = editorialWorkspace?.counts.pendingRevisions ?? 0;
  const workspaceReview = workspaceDrafts + pendingRevisions;
  const workspaceApproved = editorialWorkspace?.counts.approved ?? 0;
  const approvedRelations = editorialWorkspace?.counts.approvedRelations ?? 0;
  const publishedLegacy = items.filter((item) => item.status === "published").length;
  const publicLegacyRelations = publishedRelationCount(items, relations);
  const readyToPublish = publishedLegacy + workspaceApproved;
  const readyRelations = publicLegacyRelations + approvedRelations;
  const mergeRun = incremental?.run ?? null;
  const pendingSources = incremental?.ingest?.pending ?? incremental?.availableAnalyses ?? 0;
  const processedSources = incremental?.ingest?.processed ?? 0;
  const awaitingApplyRunId = incremental?.ingest?.awaitingApplyRunId ?? (mergeRun?.state === "done" && editorialWorkspace?.latestImport?.runId !== mergeRun.id ? mergeRun.id : null);
  const editorialBacklog = incremental?.ingest?.backlog?.total ?? workspaceReview;
  const mergeActive = Boolean(mergeRun && ["waiting", "running"].includes(mergeRun.state));
  const packageChanged = readyToPublish > 0 && (!publicationInfo || publicationInfo.itemCount !== readyToPublish || publicationInfo.relationCount !== readyRelations);

  const actions: WorkAction[] = [];
  if (aiStats.errors > 0) actions.push({ label: "AI hatalarını incele", note: "Hata alan çözümlemeler kuyruğu durdurmadan yeniden ele alınabilir.", value: aiStats.errors, target: "AI Atölyesi", tone: "attention" });
  if (missingTranscripts > 0) actions.push({ label: "Katalog altyazılarını arşivle", note: "YouTube kaynağında bulunan altyazıları Video Arşivi'nden yerel arşive al.", value: missingTranscripts, target: "Video Arşivi", tone: "active" });
  if (aiQueue > 0) actions.push({ label: "AI kuyruğunu izle", note: `${aiStats.running} işlem çalışıyor, ${aiStats.waiting} işlem sırada.`, value: aiQueue, target: "AI Atölyesi", tone: "active" });
  if (readyForAnalysis > 0) actions.push({ label: "Video çözümlemesi başlat", note: "Transkripti hazır fakat henüz AI çözümlemesi olmayan videolar var.", value: readyForAnalysis, target: "AI Atölyesi", tone: "review" });
  if (editorialPending > 0) actions.push({ label: "Çözümlemeleri ayıkla", note: "AI ham çözümlemelerinden Evrene girecek malzemeyi editoryal olarak seç.", value: editorialPending, target: "AI Atölyesi", tone: "review" });
  if (awaitingApplyRunId) actions.push({ label: "Evrene İşleme sonucunu incelemeye al", note: `Çalışma #${awaitingApplyRunId} tamamlandı; 04 · İnceleme alanına aktarılmayı bekliyor.`, value: mergeRun?.analysisCount ?? 0, target: "AI Atölyesi", tone: "review" });
  else if (pendingSources > 0 && !editorialBacklog) actions.push({ label: "Yeni kaynakları Evrene işle", note: "Yalnız yeni ayıklanmış kaynaklar işlenecek; önceki kaynaklar tekrar AI'ya gönderilmeyecek.", value: pendingSources, target: "AI Atölyesi", tone: "review" });
  if (workspaceReview > 0) actions.push({ label: "Editoryal değişiklikleri incele", note: `${workspaceDrafts} yeni kayıt ve ${pendingRevisions} revizyon kullanıcı kararını bekliyor.`, value: workspaceReview, target: "AI Atölyesi", tone: "review" });
  if (packageChanged) actions.push({ label: "Public paketi güncelle", note: `${readyToPublish} içerik ve ${readyRelations} bağlantı mevcut paketten farklı.`, value: readyToPublish, target: "Yayınlama", tone: "ready" });
  if (!actions.length) actions.push({ label: "Üretim hattı güncel", note: "Şu anda zorunlu bir bekleyen işlem görünmüyor. Yeni kanal taramasıyla devam edebilirsin.", value: 0, target: "Video Arşivi", tone: "quiet" });

  const universeState = mergeRun?.state === "error" ? "error" : mergeActive || pendingSources || awaitingApplyRunId || editorialBacklog ? "waiting" : processedSources ? "done" : "quiet";
  const pipeline = [
    { index: "01", label: "Video", value: catalog.total, note: `${missingTranscripts} altyazı arşivlenebilir`, target: "Video Arşivi" as DashboardTarget, state: catalog.total ? "done" : "waiting" },
    { index: "02", label: "Altyazı", value: archivedTranscriptCount, note: `${missingTranscripts} arşivlenebilir`, target: "Video Arşivi" as DashboardTarget, state: missingTranscripts ? "waiting" : archivedTranscriptCount ? "done" : "quiet" },
    { index: "03", label: "Çözümleme", value: aiStats.analyzed, note: aiQueue ? `${aiQueue} kuyrukta` : `${readyForAnalysis} hazır`, target: "AI Atölyesi" as DashboardTarget, state: aiStats.errors ? "error" : aiQueue || readyForAnalysis ? "waiting" : aiStats.analyzed ? "done" : "quiet" },
    { index: "04", label: "Ayıklama", value: curated, note: editorialPending ? `${editorialPending} inceleme bekliyor` : excluded ? `${excluded} evren dışı` : "karar yok", target: "AI Atölyesi" as DashboardTarget, state: editorialPending ? "waiting" : curated || excluded ? "done" : "quiet" },
    { index: "05", label: "Evrene İşleme", value: processedSources, note: awaitingApplyRunId ? "sonuç aktarılacak" : pendingSources ? `${pendingSources} yeni kaynak` : mergeActive ? "işleniyor" : "yeni kaynak yok", target: "AI Atölyesi" as DashboardTarget, state: universeState },
    { index: "06", label: "İnceleme", value: workspaceApproved, note: workspaceReview ? `${workspaceReview} karar bekliyor` : `${workspaceApproved} onaylı`, target: "AI Atölyesi" as DashboardTarget, state: workspaceReview ? "waiting" : workspaceApproved ? "done" : "quiet" },
    { index: "07", label: "Yayın", value: readyToPublish, note: packageChanged ? "paket güncellenecek" : readyToPublish ? "paket güncel" : "içerik yok", target: "Yayınlama" as DashboardTarget, state: packageChanged ? "waiting" : readyToPublish ? "done" : "quiet" },
  ];

  const recent = buildRecent(workspaceNodes);
  return <div className="ops-dashboard">
    <section className="ops-metrics" aria-label="Üretim durumu">
      <Metric label="Kanal kataloğu" value={catalog.total} note={`${archivedTranscriptCount} altyazı arşivde`} target="Video Arşivi" onNavigate={onNavigate}/>
      <Metric label="Altyazı bekleyen" value={missingTranscripts} note={`${archivedTranscriptCount}/${catalog.total} video arşivde`} target="Video Arşivi" onNavigate={onNavigate}/>
      <Metric label="AI kuyruğu" value={aiQueue} note={`${aiStats.analyzed} çözümleme tamam`} target="AI Atölyesi" onNavigate={onNavigate}/>
      <Metric label="Karar bekleyen" value={editorialPending + workspaceReview} note={`${editorialPending} ayıklama · ${workspaceReview} Evren`} target="AI Atölyesi" onNavigate={onNavigate}/>
      <Metric label="Yayına hazır" value={readyToPublish} note={`${readyRelations} public bağlantı`} target="Yayınlama" onNavigate={onNavigate}/>
    </section>
    <section className="panel ops-flow-panel"><div className="ops-section-head"><div><small>ÜRETİM HATTI</small><h3>Katalog → Altyazı → Çözümleme → Ayıklama → Evrene İşleme → İnceleme → Yayın</h3></div><span>{aiStats.errors ? `${aiStats.errors} AI hatası` : `${catalog.total} katalog videosu`}</span></div><div className="ops-flow">{pipeline.map((step) => <button key={step.label} className={step.state} onClick={() => onNavigate(step.target)}><span className="ops-flow-index">{step.index}</span><div><small>{step.label}</small><strong>{formatNumber(step.value)}</strong><p>{step.note}</p></div><i aria-hidden="true"/></button>)}</div></section>
    <div className="ops-lower-grid">
      <section className="panel ops-tasks-panel"><div className="ops-section-head"><div><small>BEKLEYEN İŞLER</small><h3>Öncelik sırası</h3></div><span>{actions.length} durum</span></div><div className="ops-task-list">{actions.slice(0, 5).map((action, index) => <button key={`${action.label}:${index}`} className={action.tone} onClick={() => onNavigate(action.target)}><span className="ops-task-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{action.label}</strong><small>{action.note}</small></div><b>{action.value ? formatNumber(action.value) : "✓"}</b><em>→</em></button>)}</div></section>
      <section className="panel ops-recent-panel"><div className="ops-section-head"><div><small>SON ÇALIŞMALAR</small><h3>Evren kayıtları</h3></div><button onClick={() => onNavigate("Kayıt Dosyaları")}>Kayıtları aç →</button></div><div className="ops-recent-list">{recent.map((item) => <button key={item.key} onClick={() => onNavigate(item.target)}><span className="kind-badge">{item.badge}</span><div><strong>{item.title}</strong><small>{item.meta}</small></div><span className={`ops-state ${item.stateClass}`}>{item.state}</span></button>)}{!recent.length && <div className="ops-empty">Henüz Evren kaydı yok. İlk kayıtlar Çözümleme → Ayıklama → Evrene İşleme akışından sonra burada görünür.</div>}</div></section>
    </div>
    <section className="ops-footnote"><span className="local-dot"/><p>Video Arşivi kanal kataloğunu ve yerel altyazı arşivini birlikte yönetir; Evren üretimi yalnız editoryal olarak ayıklanmış kaynakları kullanır.</p></section>
  </div>;
}

function Metric({ label, value, note, target, onNavigate }: { label: string; value: number; note: string; target: DashboardTarget; onNavigate: (section: DashboardTarget) => void }) {
  return <button className="ops-metric" onClick={() => onNavigate(target)}><span>{label}</span><strong>{formatNumber(value)}</strong><small>{note}</small><em>→</em></button>;
}
