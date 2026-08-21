import { useEffect, useState, type ReactNode } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";

type UniverseTab = "stories" | "characters" | "events" | "locations" | "objects" | "relations";
const tabs: Array<{ key: UniverseTab; label: string }> = [
  { key: "stories", label: "Hikâyeler" },
  { key: "characters", label: "Karakterler" },
  { key: "events", label: "Olaylar" },
  { key: "locations", label: "Mekânlar" },
  { key: "objects", label: "Nesneler" },
  { key: "relations", label: "Bağlantılar" },
];
const emptyWorkspace: StudioUniverseWorkspaceStatus = {
  latestImport: null,
  counts: { total: 0, draft: 0, approved: 0, stories: 0, characters: 0, events: 0, locations: 0, objects: 0, relations: 0, approvedRelations: 0 },
};

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function number(value: number) { return new Intl.NumberFormat("tr-TR").format(value); }
function normalize(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " "); }
function workspaceKind(tab: UniverseTab): StudioUniverseWorkspaceNode["kind"] | null {
  if (tab === "stories") return "story";
  if (tab === "characters") return "character";
  if (tab === "events") return "event";
  if (tab === "locations") return "location";
  if (tab === "objects") return "object";
  return null;
}
function visualEmpty(visual: StudioVisualDefinition) {
  return !visual?.description && !visual?.prompt && !visual?.attributes?.length && !visual?.atmosphere;
}
function resultCoverage(result: StudioUniverseMergeResult) {
  if (result.sourceCoverage) return result.sourceCoverage;
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    if (Array.isArray(entry.sourceVideoIds)) entry.sourceVideoIds.forEach((id) => ids.add(String(id)));
    Object.values(entry).forEach(visit);
  };
  visit(result.universe);
  return { expected: result.analysisCount, actual: ids.size, missing: [] };
}
function resultIsComplete(result: StudioUniverseMergeResult) {
  const coverage = resultCoverage(result);
  return result.complete ?? coverage.actual === coverage.expected;
}

export default function UniverseWorkbench() {
  const bridge = window.birdesengorStudio;
  const notify = useAiWorkbenchNotice();
  const [status, setStatus] = useState<StudioUniverseMergeStatus>({ availableAnalyses: 0, run: null });
  const [result, setResult] = useState<StudioUniverseMergeResult | null>(null);
  const [incompleteResult, setIncompleteResult] = useState<StudioUniverseMergeResult | null>(null);
  const [workspace, setWorkspace] = useState<StudioUniverseWorkspaceStatus>(emptyWorkspace);
  const [workspaceNodes, setWorkspaceNodes] = useState<StudioUniverseWorkspaceNode[]>([]);
  const [tab, setTab] = useState<UniverseTab>("stories");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  const load = async () => {
    if (!bridge) return;
    const [next, workspaceNext, nodesNext] = await Promise.all([
      bridge.universeMergeStatus(),
      bridge.universeWorkspaceStatus(),
      bridge.universeWorkspaceList(),
    ]);
    setStatus(next);
    setWorkspace(workspaceNext);
    setWorkspaceNodes(nodesNext);
    const latestResult = await bridge.universeMergeResult(next.run?.state === "done" ? next.run.id : undefined);
    const importedRunId = workspaceNext.latestImport?.runId;
    const shouldShowImportedResult = Boolean(
      importedRunId
      && importedRunId !== latestResult?.id
      && (!latestResult || !resultIsComplete(latestResult)),
    );
    const visibleResult = shouldShowImportedResult
      ? await bridge.universeMergeResult(importedRunId)
      : latestResult;
    setIncompleteResult(latestResult && !resultIsComplete(latestResult) ? latestResult : null);
    setResult(visibleResult);
  };

  useEffect(() => {
    void load().catch((reason) => notify(errorText(reason), "error"));
    const stop = bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
    return stop;
  }, []);

  useEffect(() => {
    if (!bridge || !status.run || !["waiting", "running"].includes(status.run.state)) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 2200);
    return () => window.clearInterval(timer);
  }, [bridge, status.run?.id, status.run?.state]);

  useEffect(() => { setSelectedIndex(0); }, [tab, result?.id]);

  useEffect(() => {
    if (!incompleteResult) return;
    const coverage = resultCoverage(incompleteResult);
    const fallbackNote = result && result.id !== incompleteResult.id
      ? ` Editoryal incelemede son uygulanmış çalışma #${result.id} gösteriliyor.`
      : "";
    notify(`Son tamamlanan Evren Birleştirme sonucu eksik: ${number(coverage.actual)} / ${number(coverage.expected)} kaynak video korunmuş; sonuç çalışma alanına uygulanamaz.${fallbackNote}`, "error");
  }, [incompleteResult?.id, result?.id]);

  const start = async () => {
    if (!bridge || !status.availableAnalyses) return;
    if (!confirm(`${status.availableAnalyses} tamamlanmış video anlatı dosyasından yeni bir Evren Birleştirme çalışması oluşturulsun mu? İşlem yerel AI modelinde parça parça ilerler ve SQLite'ta korunur.`)) return;
    setBusy(true);
    try {
      const next = await bridge.universeMergeStart();
      setStatus(next);
      notify("Evren Birleştirme kuyruğu oluşturuldu. Hikâyeler ve karakter hafızası yerel modelde parça parça birleştiriliyor.", "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    if (!bridge || stopping || !status.run || !["waiting", "running"].includes(status.run.state)) return;
    setStopping(true);
    try {
      const canceled = await bridge.universeMergeCancel();
      setStatus({ availableAnalyses: canceled.availableAnalyses, run: canceled.run });
      await load();
      notify(canceled.canceled
        ? `Evren Birleştirme çalışması #${canceled.runId} durduruldu. Önceki tamamlanmış evren ve editoryal kararlar korundu.`
        : "Durdurulabilecek etkin bir Evren Birleştirme çalışması bulunamadı.", canceled.canceled ? "success" : "error");
    } catch (reason) {
      notify(`Evren Birleştirme durdurulamadı · ${errorText(reason)}`, "error");
    } finally {
      setStopping(false);
    }
  };

  const applyWorkspace = async () => {
    if (!bridge || !result) return;
    const complete = resultIsComplete(result);
    if (!complete) return;
    if (!confirm(`Çalışma #${result.id} içindeki ${result.universe.stories.length} hikâye ve diğer evren düğümleri editoryal çalışma alanına Taslak olarak aktarılsın mı? Bu işlem public webi değiştirmez ve daha önce onaylanmış kayıtların üzerine yazmaz.`)) return;
    setBusy(true);
    try {
      const applied = await bridge.universeWorkspaceApply(result.id);
      setWorkspace(applied);
      setWorkspaceNodes(await bridge.universeWorkspaceList());
      notify(`${applied.created} yeni düğüm oluşturuldu, ${applied.updated} taslak güncellendi${applied.approvedProtected ? `, ${applied.approvedProtected} onaylı kayıt korundu` : ""}. Public web değişmedi.`, "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const changeState = async (keys: string[], state: StudioUniverseWorkspaceState, confirmation?: string) => {
    if (!bridge || !keys.length) return;
    if (confirmation && !confirm(confirmation)) return;
    setBusy(true);
    try {
      const changed = await bridge.universeWorkspaceSetState({ keys, state });
      setWorkspace(changed);
      setWorkspaceNodes(await bridge.universeWorkspaceList());
      notify(`${changed.affected} evren düğümü ${state === "approved" ? "onaylandı" : "taslağa çekildi"}. Public web ancak Yayınlama adımında güncellenir.`, "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  if (!bridge) return <div className="universe-empty">Evren Birleştirme Electron Studio içinde kullanılabilir.</div>;

  const universe = result?.universe;
  const counts = {
    stories: universe?.stories.length ?? 0,
    characters: universe?.characters.length ?? 0,
    events: universe?.events.length ?? 0,
    locations: universe?.locations.length ?? 0,
    objects: universe?.objects.length ?? 0,
    relations: universe?.relations.length ?? 0,
  };
  const activeCollection: any[] = universe ? (universe[tab] as any[]) : [];
  const selected = activeCollection[selectedIndex] as StudioUniverseStory | StudioUniverseEntity | StudioUniverseEvent | StudioUniverseRelation | undefined;
  const appliedCurrentRun = Boolean(result && workspace.latestImport?.runId === result.id);
  const resultComplete = Boolean(result && resultIsComplete(result));
  const currentKind = workspaceKind(tab);
  const selectedWorkspaceNode = selected && currentKind
    ? workspaceNodes.find((node) => node.kind === currentKind && normalize(node.name) === normalize((selected as any).name))
    : undefined;
  const allDraftKeys = workspaceNodes.filter((node) => node.state === "draft").map((node) => node.key);
  const allApprovedKeys = workspaceNodes.filter((node) => node.state === "approved").map((node) => node.key);
  const mergeActive = Boolean(status.run && ["waiting", "running"].includes(status.run.state));
  const stopMode = mergeActive || stopping;

  return <div className="universe-workbench">
    <section className="universe-workspace-status panel">
      <div className="universe-workspace-copy"><strong>{number(workspace.counts.draft)} taslak · {number(workspace.counts.approved)} onaylı düğüm</strong><span>{workspace.latestImport ? `Son aktarma: çalışma #${workspace.latestImport.runId} · ${workspace.latestImport.analysisCount} video analizi` : "AI taslakları public yayından ayrı tutuluyor."}</span></div>
      <div className="universe-workspace-actions">
        <div className="universe-workspace-buttons">
          {result && <button className="universe-apply-button" disabled={busy || appliedCurrentRun || !resultComplete} onClick={() => void applyWorkspace()}>{!resultComplete ? "Eksik sonuç uygulanamaz" : appliedCurrentRun ? "Çalışma alanında" : "Çalışma alanına uygula"}</button>}
          <button disabled={busy || !allDraftKeys.length} onClick={() => void changeState(allDraftKeys, "approved", `${allDraftKeys.length} taslak evren düğümünün tamamı onaylansın mı? Onaylanan kayıtlar bir sonraki public web paketine girebilir.`)}>Tüm taslakları onayla</button>
          <button disabled={busy || !allApprovedKeys.length} onClick={() => void changeState(allApprovedKeys, "draft", `${allApprovedKeys.length} onaylı evren düğümünün tamamı yeniden taslağa çekilsin mi?`)}>Tümünü taslağa çek</button>
          <button className={`universe-update-button${stopMode ? " stop" : ""}`} disabled={stopMode ? stopping || busy : busy || !status.availableAnalyses} onClick={() => stopMode ? void stop() : void start()}>{stopMode ? stopping ? "Durduruluyor…" : "Durdur" : "Evreni güncelle"}</button>
        </div>
      </div>
    </section>

    {!result && !status.run && <section className="universe-empty panel"><span>EVREN TASLAĞI</span><h3>Önce video çözümlemelerinin bir kısmını tamamla.</h3><p>Evren Birleştirme yalnız tamamlanmış video analizlerini kullanır. Yeni videolar analiz edildikçe daha sonra yeni bir taslak üretilebilir.</p></section>}
    {!result && status.run && ["waiting", "running"].includes(status.run.state) && <section className="universe-empty panel"><span>İŞLEM DEVAM EDİYOR</span><h3>Sonuçlar hazır olduğunda burada hikâyeler ve karakter hafızası görünecek.</h3><p>Studio kapatılsa bile tamamlanan parçalar SQLite'ta kalır; yeniden açıldığında işlem kaldığı yerden devam eder.</p></section>}
    {status.run?.state === "error" && <section className="universe-run-error panel">
      <div><small>SON BAŞARISIZ BİRLEŞTİRME</small><strong>Çalışma #{status.run.id} · {status.run.model || "model bildirilmedi"}</strong><span>Tamamlanan video çözümlemeleri korunuyor; “Evreni güncelle” ile temiz bir çalışma başlatabilirsin.</span></div>
      <details><summary>Hata ayrıntısını göster</summary><pre>{status.run.error || "Hata ayrıntısı kaydedilmedi."}</pre></details>
    </section>}

    {result && universe && <>
      <nav className="universe-tabs">{tabs.map((entry) => <button key={entry.key} className={tab === entry.key ? "active" : ""} onClick={() => setTab(entry.key)}><span>{entry.label}</span><b>{counts[entry.key]}</b></button>)}</nav>
      <div className="universe-layout">
        <section className="universe-list panel">
          <div className="universe-list-head"><small>{tabs.find((entry) => entry.key === tab)?.label.toUpperCase()}</small><span>{activeCollection.length} kayıt</span></div>
          <div className="universe-list-rows">{activeCollection.map((entry: any, index: number) => {
            const node = currentKind ? workspaceNodes.find((candidate) => candidate.kind === currentKind && normalize(candidate.name) === normalize(entry.name)) : undefined;
            return <button key={`${tab}-${index}`} className={selectedIndex === index ? "active" : ""} onClick={() => setSelectedIndex(index)}><strong>{relationTitle(entry, tab)}</strong><small>{sourceIds(entry).length} kaynak video {node ? `· ${node.state === "approved" ? "Onaylı" : "Taslak"}` : ""}</small></button>;
          })}</div>
          {!activeCollection.length && <div className="universe-list-empty">Bu tür için birleşik kayıt oluşmadı.</div>}
        </section>
        <section className="universe-detail panel">{selected ? <UniverseDetail entry={selected as any} tab={tab} workspaceNode={selectedWorkspaceNode} busy={busy} onState={(state) => selectedWorkspaceNode && changeState([selectedWorkspaceNode.key], state)}/> : <div className="universe-detail-empty">İncelemek için soldan bir kayıt seç.</div>}</section>
      </div>
      <footer className="universe-footer">Çalışma #{result.id} · {result.analysisCount} video analizi · {result.model} · {result.finishedAt || "—"}</footer>
    </>}
  </div>;
}

function sourceIds(entry: any): string[] {
  return Array.isArray(entry?.sourceVideoIds) ? entry.sourceVideoIds : [];
}
function relationTitle(entry: any, tab: UniverseTab) {
  if (tab === "relations") return `${entry.fromName || "?"} → ${entry.toName || "?"}`;
  return entry.name || "Adsız kayıt";
}

function UniverseDetail({ entry, tab, workspaceNode, busy, onState }: { entry: any; tab: UniverseTab; workspaceNode?: StudioUniverseWorkspaceNode; busy: boolean; onState: (state: StudioUniverseWorkspaceState) => void }) {
  if (tab === "relations") return <div className="universe-detail-body"><small>EVREN BAĞLANTISI</small><h3>{entry.fromName} → {entry.toName}</h3><p className="universe-relation-label">{entry.label}</p><p className="universe-editorial-note">Bağlantı, iki ucundaki evren düğümü onaylandığında otomatik olarak public yayına uygun hale gelir.</p><SourceVideos ids={entry.sourceVideoIds}/></div>;
  return <div className="universe-detail-body">
    <div className="universe-editorial-control">
      <div><small>EDİTORYAL DURUM</small><strong className={workspaceNode?.state === "approved" ? "approved" : "draft"}>{workspaceNode ? (workspaceNode.state === "approved" ? "Onaylı" : "Taslak") : "Çalışma alanına alınmadı"}</strong></div>
      {workspaceNode && <button disabled={busy} className={workspaceNode.state === "approved" ? "draft-action" : "approve-action"} onClick={() => onState(workspaceNode.state === "approved" ? "draft" : "approved")}>{workspaceNode.state === "approved" ? "Taslağa çek" : "Onayla"}</button>}
    </div>
    <small>{tab === "stories" ? "HİKÂYE DOSYASI" : tab === "characters" ? "KARAKTER HAFIZASI" : "EVREN DÜĞÜMÜ"}</small>
    <h3>{entry.name}</h3>
    {entry.aliases?.length > 0 && <p className="universe-aliases">Diğer adlar: {entry.aliases.join(", ")}</p>}
    {entry.summary && <p className="universe-summary">{entry.summary}</p>}
    {entry.roles?.length > 0 && <Section title="ROLLER"><Chips values={entry.roles}/></Section>}
    {entry.storyNames?.length > 0 && <Section title="YER ALDIĞI HİKÂYELER"><Chips values={entry.storyNames}/></Section>}
    {entry.characterNames?.length > 0 && <Section title="KARAKTERLER"><Chips values={entry.characterNames}/></Section>}
    {entry.locationNames?.length > 0 && <Section title="MEKÂNLAR"><Chips values={entry.locationNames}/></Section>}
    {entry.objectNames?.length > 0 && <Section title="NESNELER"><Chips values={entry.objectNames}/></Section>}
    {entry.sequence?.length > 0 && <Section title="HİKÂYE AKIŞI"><ol className="universe-detail-list">{entry.sequence.map((detail: StudioUniverseDetail, index: number) => <li key={`${detail.text}-${index}`}><span>{detail.text}</span><small>{detail.sourceVideoIds.length} kaynak</small></li>)}</ol></Section>}
    {entry.details?.length > 0 && <Section title="VİDEOLAR BOYUNCA BİRİKEN DETAYLAR"><ul className="universe-detail-list">{entry.details.map((detail: StudioUniverseDetail, index: number) => <li key={`${detail.text}-${index}`}><span>{detail.text}</span><small>{detail.sourceVideoIds.length} kaynak</small></li>)}</ul></Section>}
    {entry.visual && !visualEmpty(entry.visual) && <Section title="GÖRSEL TANIM"><div className="universe-visual"><p>{entry.visual.description}</p>{entry.visual.attributes?.length > 0 && <Chips values={entry.visual.attributes}/>}<strong>Görsel üretim metni</strong><textarea readOnly value={entry.visual.prompt || ""}/></div></Section>}
    <SourceVideos ids={entry.sourceVideoIds}/>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="universe-detail-section"><small>{title}</small>{children}</section>; }
function Chips({ values }: { values: string[] }) { return <div className="universe-chips">{values.map((value) => <span key={value}>{value}</span>)}</div>; }
function SourceVideos({ ids }: { ids: string[] }) { return <section className="universe-detail-section"><small>KAYNAK VİDEOLAR · {ids?.length ?? 0}</small><div className="universe-source-ids">{(ids ?? []).slice(0, 40).map((id) => <code key={id}>{id}</code>)}{ids?.length > 40 && <span>+{ids.length - 40} video</span>}</div></section>; }
